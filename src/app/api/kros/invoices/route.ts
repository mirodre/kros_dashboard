import { NextResponse } from "next/server";
import { appendKrosLog } from "@/lib/kros-logs";
import { resolveConnections } from "@/lib/kros-connection-handlers";
import { krosContext } from "../context";
import { toDateOnlyString } from "@/lib/document-date";

/** Prepojenie tak, ako ho server načíta z databázy. Z prehliadača token nikdy nechodí. */
type CompanyConnection = {
  companyId: number;
  companyName: string;
  token: string;
};

type InvoiceRequestBody = {
  /** Filter firiem. Prázdne = všetky firmy prepojené touto firmou. */
  companyIds?: number[];
  deliveryDateFrom?: string;
  deliveryDateTo?: string;
  lastModifiedTimestamp?: string;
};

const KROS_API_BASE = process.env.KROS_API_BASE_URL ?? "https://api-economy.kros.sk";

// KROS API očakáva čistý dátum. Berieme dátumovú zložku reťazca, aby časová
// zóna servera nevedela posunúť okno sťahovania o deň.
function toKrosDate(value: string) {
  const dateOnly = toDateOnlyString(value);
  if (!dateOnly) {
    throw new Error(`Neplatná hodnota dátumu: ${value}`);
  }
  return dateOnly;
}

async function fetchWithRetry(url: string, options: RequestInit, maxAttempts = 3) {
  let attempt = 0;

  while (attempt < maxAttempts) {
    attempt += 1;
    const response = await fetch(url, options);
    if (response.status !== 429) return response;
    await appendKrosLog({
      direction: "error",
      endpoint: "/api/invoices",
      method: "GET",
      status: response.status,
      message: "Limit API 429, opakujem požiadavku..."
    });

    const retryAfterHeader = response.headers.get("retry-after");
    const retryAfterMs = (Number(retryAfterHeader) || 1) * 1000;
    await new Promise((resolve) => setTimeout(resolve, retryAfterMs));
  }

  return fetch(url, options);
}

async function fetchCompanyInvoices(
  company: CompanyConnection,
  deliveryDateFrom?: string,
  deliveryDateTo?: string,
  lastModifiedTimestamp?: string
) {
  // Analytiky bucketujú podľa dátumu dodania, preto sa aj sync okná dopytujú
  // cez DeliveryDateFrom/To — používateľ potvrdil, že dodanie je vyplnené všade.
  const deliveryFrom = deliveryDateFrom ? toKrosDate(deliveryDateFrom) : null;
  const deliveryTo = deliveryDateTo ? toKrosDate(deliveryDateTo) : null;
  const top = 100;
  let skip = 0;
  const aggregated: unknown[] = [];

  while (true) {
    const query = new URLSearchParams({
      Top: String(top),
      Skip: String(skip)
    });
    if (deliveryFrom) query.set("DeliveryDateFrom", deliveryFrom);
    if (deliveryTo) query.set("DeliveryDateTo", deliveryTo);
    if (lastModifiedTimestamp) {
      query.set("LastModifiedTimestamp", lastModifiedTimestamp);
    }

    await appendKrosLog({
      direction: "request",
      endpoint: "/api/invoices",
      method: "GET",
      companyName: company.companyName,
      message: `Skip=${skip}, Top=${top}${deliveryFrom ? `, DeliveryDateFrom=${deliveryFrom}` : ""}${deliveryTo ? `, DeliveryDateTo=${deliveryTo}` : ""}${lastModifiedTimestamp ? `, LastModifiedTimestamp=${lastModifiedTimestamp}` : ""}`
    });

    const response = await fetchWithRetry(`${KROS_API_BASE}/api/invoices?${query.toString()}`, {
      headers: {
        Authorization: `Bearer ${company.token}`,
        Accept: "application/json"
      },
      cache: "no-store"
    });

    const payloadText = await response.text();
    let payload: unknown = {};
    try {
      payload = payloadText ? JSON.parse(payloadText) : {};
    } catch {
      payload = payloadText;
    }

    await appendKrosLog({
      direction: response.ok ? "response" : "error",
      endpoint: "/api/invoices",
      method: "GET",
      companyName: company.companyName,
      status: response.status,
      message: response.ok
        ? "OK"
        : `Zlyhalo: ${typeof payload === "string" ? payload : JSON.stringify(payload)}`,
      payload: response.ok ? undefined : typeof payload === "string" ? payload : payload
    });

    if (!response.ok) {
      throw new Error(
        `Načítanie faktúr zlyhalo pre firmu ${company.companyName} (${response.status}): ${
          typeof payload === "string" ? payload : JSON.stringify(payload)
        }`
      );
    }

    const items = Array.isArray((payload as { data?: unknown[] })?.data)
      ? (payload as { data: unknown[] }).data
      : [];
    aggregated.push(...items);

    await appendKrosLog({
      direction: "response",
      endpoint: "/api/invoices",
      method: "GET",
      companyName: company.companyName,
      status: response.status,
      message: `Stránka načítaná: položky=${items.length}, skip=${skip}`
    });

    if (items.length < top) {
      break;
    }

    skip += top;
  }

  return aggregated.map((invoice) => ({
    ...((invoice as object) ?? {}),
    __company: company.companyName,
    __companyId: company.companyId
  }));
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as InvoiceRequestBody;
    if (!body.lastModifiedTimestamp && (!body.deliveryDateFrom || !body.deliveryDateTo)) {
      return NextResponse.json({ error: "Neplatné telo požiadavky" }, { status: 400 });
    }

    const context = await krosContext();
    if (context instanceof NextResponse) return context;

    // Prepojenia sa načítajú zo servera podľa firmy zo session. `companyIds` z tela je len
    // filter — token, ktorý by prišiel z prehliadača, sa už nikde nečíta.
    const companies = await resolveConnections(context.connections, context.scope, body.companyIds);
    if (companies.length === 0) {
      return NextResponse.json({ error: "Žiadna firma nie je prepojená s KROS." }, { status: 400 });
    }

    await appendKrosLog({
      direction: "request",
      endpoint: "/api/kros/invoices",
      method: "POST",
      message: `firmy=${companies.length}${body.deliveryDateFrom ? `, deliveryDateFrom=${body.deliveryDateFrom}` : ""}${body.deliveryDateTo ? `, deliveryDateTo=${body.deliveryDateTo}` : ""}${body.lastModifiedTimestamp ? `, lastModifiedTimestamp=${body.lastModifiedTimestamp}` : ""}`,
      payload: {
        companies: companies.map((company) => ({
          companyId: company.companyId,
          companyName: company.companyName
        })),
        deliveryDateFrom: body.deliveryDateFrom,
        deliveryDateTo: body.deliveryDateTo,
        lastModifiedTimestamp: body.lastModifiedTimestamp
      }
    });

    const allInvoices = [];
    const errors: { companyName: string; message: string }[] = [];

    for (const company of companies) {
      try {
        const companyInvoices = await fetchCompanyInvoices(
          company,
          body.deliveryDateFrom,
          body.deliveryDateTo,
          body.lastModifiedTimestamp
        );
        allInvoices.push(...companyInvoices);
      } catch (error) {
        errors.push({
          companyName: company.companyName,
          message: error instanceof Error ? error.message : "Neznáma chyba pri načítaní firmy"
        });
      }
    }

    await appendKrosLog({
      direction: "response",
      endpoint: "/api/kros/invoices",
      method: "POST",
      status: 200,
      message: `Načítané faktúry=${allInvoices.length}, chyby=${errors.length}, firmy=${companies.length}`,
      payload: errors.length > 0 ? { errors } : undefined
    });
    return NextResponse.json({ data: allInvoices, errors });
  } catch (error) {
    await appendKrosLog({
      direction: "error",
      endpoint: "/api/kros/invoices",
      method: "POST",
      message: `Neočakávaná chyba načítania faktúr: ${error instanceof Error ? error.message : "Neznáma chyba"}`
    });
    return NextResponse.json({
      data: [],
      errors: [
        {
          companyName: "global",
          message: `Neočakávaná chyba načítania faktúr: ${error instanceof Error ? error.message : "Neznáma chyba"}`
        }
      ]
    });
  }
}
