import { NextResponse } from "next/server";
import { appendKrosLog } from "@/lib/kros-logs";
import { resolveConnections } from "@/lib/kros-connection-handlers";
import { krosContext } from "../context";

/** Prepojenie tak, ako ho server načíta z databázy. Z prehliadača token nikdy nechodí. */
type CompanyConnection = {
  companyId: number;
  companyName: string;
  token: string;
};

type PaymentsRequestBody = {
  /** Filter firiem. Prázdne = všetky firmy prepojené touto firmou. */
  companyIds?: number[];
  lastModifiedTimestamp?: string;
};

const KROS_API_BASE = process.env.KROS_API_BASE_URL ?? "https://api-economy.kros.sk";

async function fetchWithRetry(url: string, options: RequestInit, maxAttempts = 3) {
  let attempt = 0;
  while (attempt < maxAttempts) {
    attempt += 1;
    const response = await fetch(url, options);
    if (response.status !== 429) return response;
    await appendKrosLog({
      direction: "error",
      endpoint: "/api/payments",
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

async function fetchCompanyPayments(
  company: CompanyConnection,
  lastModifiedTimestamp?: string
) {
  const top = 100;
  let skip = 0;
  const aggregated: unknown[] = [];

  while (true) {
    const query = new URLSearchParams({ Top: String(top), Skip: String(skip) });
    if (lastModifiedTimestamp) {
      query.set("LastModifiedTimestamp", lastModifiedTimestamp);
    }

    await appendKrosLog({
      direction: "request",
      endpoint: "/api/payments",
      method: "GET",
      companyName: company.companyName,
      message: `Skip=${skip}, Top=${top}${lastModifiedTimestamp ? `, LastModifiedTimestamp=${lastModifiedTimestamp}` : ""}`
    });

    const response = await fetchWithRetry(`${KROS_API_BASE}/api/payments?${query.toString()}`, {
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
      endpoint: "/api/payments",
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
        `Načítanie pohybov zlyhalo pre firmu ${company.companyName} (${response.status}): ${
          typeof payload === "string" ? payload : JSON.stringify(payload)
        }`
      );
    }

    const items = Array.isArray(payload)
      ? payload
      : Array.isArray((payload as { data?: unknown[] })?.data)
        ? (payload as { data: unknown[] }).data
        : Array.isArray((payload as { items?: unknown[] })?.items)
          ? (payload as { items: unknown[] }).items
          : [];
    aggregated.push(...items);

    if (items.length < top) break;
    skip += top;
  }

  return aggregated.map((payment) => ({
    ...((payment as object) ?? {}),
    __company: company.companyName,
    __companyId: company.companyId
  }));
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as PaymentsRequestBody;
    const context = await krosContext();
    if (context instanceof NextResponse) return context;

    // Prepojenia sa načítajú zo servera podľa firmy zo session. `companyIds` z tela je len
    // filter — token, ktorý by prišiel z prehliadača, sa už nikde nečíta.
    const companies = await resolveConnections(context.connections, context.scope, body.companyIds);
    if (companies.length === 0) {
      return NextResponse.json({ error: "Žiadna firma nie je prepojená s KROS." }, { status: 400 });
    }

    const allPayments: unknown[] = [];
    const errors: { companyName: string; message: string }[] = [];

    for (const company of companies) {
      try {
        const companyPayments = await fetchCompanyPayments(company, body.lastModifiedTimestamp);
        allPayments.push(...companyPayments);
      } catch (error) {
        errors.push({
          companyName: company.companyName,
          message: error instanceof Error ? error.message : "Neznáma chyba pri načítaní pohybov"
        });
      }
    }

    return NextResponse.json({ data: allPayments, errors });
  } catch (error) {
    await appendKrosLog({
      direction: "error",
      endpoint: "/api/kros/payments",
      method: "POST",
      message: `Neočakávaná chyba načítania pohybov: ${error instanceof Error ? error.message : "Neznáma chyba"}`
    });
    return NextResponse.json({
      data: [],
      errors: [
        {
          companyName: "global",
          message: `Neočakávaná chyba načítania pohybov: ${error instanceof Error ? error.message : "Neznáma chyba"}`
        }
      ]
    });
  }
}
