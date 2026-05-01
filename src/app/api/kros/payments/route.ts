import { NextResponse } from "next/server";
import { appendKrosLog } from "@/lib/kros-logs";

type CompanyConnection = {
  companyId: number;
  companyName: string;
  token: string;
};

type PaymentsRequestBody = {
  companies: CompanyConnection[];
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
  company: CompanyConnection
) {
  const top = 100;
  let skip = 0;
  const aggregated: unknown[] = [];

  while (true) {
    const query = new URLSearchParams({ Top: String(top), Skip: String(skip) });

    await appendKrosLog({
      direction: "request",
      endpoint: "/api/payments",
      method: "GET",
      companyName: company.companyName,
      message: `Skip=${skip}, Top=${top}`
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

    if (skip === 0) {
      const firstArrayItem =
        Array.isArray(payload) && payload.length > 0 && typeof payload[0] === "object" && payload[0] !== null
          ? (payload[0] as Record<string, unknown>)
          : null;
      // #region agent log
      fetch("http://127.0.0.1:7292/ingest/2c760ae1-6116-4d9d-ad94-448f7b07322c", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "a548d4" },
        body: JSON.stringify({
          sessionId: "a548d4",
          runId: "pre-fix-payments-empty",
          hypothesisId: "H1",
          location: "src/app/api/kros/payments/route.ts:fetchCompanyPayments-payload-shape",
          message: "Payments payload shape",
          data: {
            companyName: company.companyName,
            payloadKeys:
              payload && typeof payload === "object" ? Object.keys(payload as Record<string, unknown>).slice(0, 8) : [],
            firstItemKeys: firstArrayItem ? Object.keys(firstArrayItem).slice(0, 20) : [],
            dataCount: Array.isArray((payload as { data?: unknown[] })?.data)
              ? (payload as { data: unknown[] }).data.length
              : -1,
            itemsCount: Array.isArray((payload as { items?: unknown[] })?.items)
              ? (payload as { items: unknown[] }).items.length
              : -1
          },
          timestamp: Date.now()
        })
      }).catch(() => {});
      // #endregion
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
    if (!Array.isArray(body.companies) || body.companies.length === 0) {
      return NextResponse.json({ error: "Neplatné telo požiadavky" }, { status: 400 });
    }

    const allPayments: unknown[] = [];
    const errors: { companyName: string; message: string }[] = [];

    for (const company of body.companies) {
      try {
        const companyPayments = await fetchCompanyPayments(company);
        allPayments.push(...companyPayments);
      } catch (error) {
        errors.push({
          companyName: company.companyName,
          message: error instanceof Error ? error.message : "Neznáma chyba pri načítaní pohybov"
        });
      }
    }

    // #region agent log
    fetch("http://127.0.0.1:7292/ingest/2c760ae1-6116-4d9d-ad94-448f7b07322c", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "a548d4" },
      body: JSON.stringify({
        sessionId: "a548d4",
        runId: "pre-fix-payments-empty",
        hypothesisId: "H5",
        location: "src/app/api/kros/payments/route.ts:POST-summary",
        message: "Payments route summary",
        data: { companiesCount: body.companies.length, paymentsCount: allPayments.length, errorsCount: errors.length },
        timestamp: Date.now()
      })
    }).catch(() => {});
    // #endregion

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
