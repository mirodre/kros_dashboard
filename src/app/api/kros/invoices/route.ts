import { NextResponse } from "next/server";
import { appendKrosLog } from "@/lib/kros-logs";

type CompanyConnection = {
  companyId: number;
  companyName: string;
  token: string;
};

type InvoiceRequestBody = {
  companies: CompanyConnection[];
  issueDateFrom: string;
  issueDateTo: string;
};

const KROS_API_BASE = process.env.KROS_API_BASE_URL ?? "https://api-economy.kros.sk";

function toKrosDate(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Neplatná hodnota dátumu: ${value}`);
  }

  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, "0");
  const day = String(parsed.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
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
  issueDateFrom: string,
  issueDateTo: string
) {
  const issueFrom = toKrosDate(issueDateFrom);
  const issueTo = toKrosDate(issueDateTo);
  const top = 100;
  let skip = 0;
  const aggregated: unknown[] = [];

  while (true) {
    const query = new URLSearchParams({
      IssueDateFrom: issueFrom,
      IssueDateTo: issueTo,
      Top: String(top),
      Skip: String(skip)
    });

    await appendKrosLog({
      direction: "request",
      endpoint: "/api/invoices",
      method: "GET",
      companyName: company.companyName,
      message: `Skip=${skip}, Top=${top}, IssueDateFrom=${issueFrom}, IssueDateTo=${issueTo}`
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
      payload: typeof payload === "string" ? payload : payload
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

  return aggregated.map((invoice) => ({ ...((invoice as object) ?? {}), __company: company.companyName }));
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as InvoiceRequestBody;
    if (!body.issueDateFrom || !body.issueDateTo || !Array.isArray(body.companies)) {
      return NextResponse.json({ error: "Neplatné telo požiadavky" }, { status: 400 });
    }

    await appendKrosLog({
      direction: "request",
      endpoint: "/api/kros/invoices",
      method: "POST",
      message: `firmy=${body.companies.length}, issueDateFrom=${body.issueDateFrom}, issueDateTo=${body.issueDateTo}`,
      payload: {
        companies: body.companies.map((company) => ({
          companyId: company.companyId,
          companyName: company.companyName
        })),
        issueDateFrom: body.issueDateFrom,
        issueDateTo: body.issueDateTo
      }
    });

    const allInvoices = [];
    const errors: { companyName: string; message: string }[] = [];

    for (const company of body.companies) {
      try {
        const companyInvoices = await fetchCompanyInvoices(company, body.issueDateFrom, body.issueDateTo);
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
      message: `Načítané faktúry=${allInvoices.length}, chyby=${errors.length}, firmy=${body.companies.length}`,
      payload: { errors, data: allInvoices }
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
