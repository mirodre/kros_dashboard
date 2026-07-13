import { NextResponse } from "next/server";
import { appendKrosLog } from "@/lib/kros-logs";

type CompanyConnection = {
  companyId: number;
  companyName: string;
  token: string;
};

type ExpenseRequestBody = {
  companies: CompanyConnection[];
  issueDateFrom?: string;
  issueDateTo?: string;
  lastModifiedTimestamp?: string;
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
      endpoint: "/api/expenses",
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

async function fetchCompanyExpenses(
  company: CompanyConnection,
  issueDateFrom?: string,
  issueDateTo?: string,
  lastModifiedTimestamp?: string
) {
  const issueFrom = issueDateFrom ? toKrosDate(issueDateFrom) : null;
  const issueTo = issueDateTo ? toKrosDate(issueDateTo) : null;
  const top = 100;
  let skip = 0;
  const aggregated: unknown[] = [];

  while (true) {
    const query = new URLSearchParams({
      Top: String(top),
      Skip: String(skip)
    });
    if (issueFrom) query.set("IssueDateFrom", issueFrom);
    if (issueTo) query.set("IssueDateTo", issueTo);
    if (lastModifiedTimestamp) {
      query.set("LastModifiedTimestamp", lastModifiedTimestamp);
    }

    await appendKrosLog({
      direction: "request",
      endpoint: "/api/expenses",
      method: "GET",
      companyName: company.companyName,
      message: `Skip=${skip}, Top=${top}${issueFrom ? `, IssueDateFrom=${issueFrom}` : ""}${issueTo ? `, IssueDateTo=${issueTo}` : ""}${lastModifiedTimestamp ? `, LastModifiedTimestamp=${lastModifiedTimestamp}` : ""}`
    });

    const response = await fetchWithRetry(`${KROS_API_BASE}/api/expenses?${query.toString()}`, {
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
      endpoint: "/api/expenses",
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
        `Načítanie výdavkov zlyhalo pre firmu ${company.companyName} (${response.status}): ${
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
      endpoint: "/api/expenses",
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

  return aggregated.map((expense) => ({
    ...((expense as object) ?? {}),
    __company: company.companyName,
    __companyId: company.companyId
  }));
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as ExpenseRequestBody;
    if (!Array.isArray(body.companies) || (!body.lastModifiedTimestamp && (!body.issueDateFrom || !body.issueDateTo))) {
      return NextResponse.json({ error: "Neplatné telo požiadavky" }, { status: 400 });
    }

    await appendKrosLog({
      direction: "request",
      endpoint: "/api/kros/expenses",
      method: "POST",
      message: `firmy=${body.companies.length}${body.issueDateFrom ? `, issueDateFrom=${body.issueDateFrom}` : ""}${body.issueDateTo ? `, issueDateTo=${body.issueDateTo}` : ""}${body.lastModifiedTimestamp ? `, lastModifiedTimestamp=${body.lastModifiedTimestamp}` : ""}`,
      payload: {
        companies: body.companies.map((company) => ({
          companyId: company.companyId,
          companyName: company.companyName
        })),
        issueDateFrom: body.issueDateFrom,
        issueDateTo: body.issueDateTo,
        lastModifiedTimestamp: body.lastModifiedTimestamp
      }
    });

    const allExpenses = [];
    const errors: { companyName: string; message: string }[] = [];

    for (const company of body.companies) {
      try {
        const companyExpenses = await fetchCompanyExpenses(
          company,
          body.issueDateFrom,
          body.issueDateTo,
          body.lastModifiedTimestamp
        );
        allExpenses.push(...companyExpenses);
      } catch (error) {
        errors.push({
          companyName: company.companyName,
          message: error instanceof Error ? error.message : "Neznáma chyba pri načítaní firmy"
        });
      }
    }

    await appendKrosLog({
      direction: "response",
      endpoint: "/api/kros/expenses",
      method: "POST",
      status: 200,
      message: `Načítané výdavky=${allExpenses.length}, chyby=${errors.length}, firmy=${body.companies.length}`,
      payload: errors.length > 0 ? { errors } : undefined
    });
    return NextResponse.json({ data: allExpenses, errors });
  } catch (error) {
    await appendKrosLog({
      direction: "error",
      endpoint: "/api/kros/expenses",
      method: "POST",
      message: `Neočakávaná chyba načítania výdavkov: ${error instanceof Error ? error.message : "Neznáma chyba"}`
    });
    return NextResponse.json({
      data: [],
      errors: [
        {
          companyName: "global",
          message: `Neočakávaná chyba načítania výdavkov: ${error instanceof Error ? error.message : "Neznáma chyba"}`
        }
      ]
    });
  }
}
