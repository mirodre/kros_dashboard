import { NextResponse } from "next/server";
import { appendKrosLog } from "@/lib/kros-logs";

type CompanyConnection = {
  companyId: number;
  companyName: string;
  token: string;
};

type PaymentAccountsRequestBody = {
  companies: CompanyConnection[];
};

const KROS_API_BASE = process.env.KROS_API_BASE_URL ?? "https://api-economy.kros.sk";

async function fetchCompanyAccounts(company: CompanyConnection) {
  await appendKrosLog({
    direction: "request",
    endpoint: "/api/payments/accounts",
    method: "GET",
    companyName: company.companyName,
    message: "Načítavam účty"
  });

  const response = await fetch(`${KROS_API_BASE}/api/payments/accounts`, {
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
    endpoint: "/api/payments/accounts",
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
      `Načítanie účtov zlyhalo pre firmu ${company.companyName} (${response.status}): ${
        typeof payload === "string" ? payload : JSON.stringify(payload)
      }`
    );
  }

  const items = Array.isArray((payload as { data?: unknown[] })?.data)
    ? (payload as { data: unknown[] }).data
    : [];

  const firstItem =
    items.length > 0 && typeof items[0] === "object" && items[0] !== null
      ? (items[0] as Record<string, unknown>)
      : null;
  // #region agent log
  fetch("http://127.0.0.1:7292/ingest/2c760ae1-6116-4d9d-ad94-448f7b07322c", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "a548d4" },
    body: JSON.stringify({
      sessionId: "a548d4",
      runId: "pre-fix-payments-empty",
      hypothesisId: "H2",
      location: "src/app/api/kros/payments/accounts/route.ts:fetchCompanyAccounts-shape",
      message: "Accounts payload shape",
      data: {
        companyName: company.companyName,
        itemsCount: items.length,
        firstItemKeys: firstItem ? Object.keys(firstItem).slice(0, 20) : []
      },
      timestamp: Date.now()
    })
  }).catch(() => {});
  // #endregion

  return items.map((account) => ({
    ...((account as object) ?? {}),
    __company: company.companyName,
    __companyId: company.companyId
  }));
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as PaymentAccountsRequestBody;
    if (!Array.isArray(body.companies) || body.companies.length === 0) {
      return NextResponse.json({ error: "Neplatné telo požiadavky" }, { status: 400 });
    }

    const allAccounts: unknown[] = [];
    const errors: { companyName: string; message: string }[] = [];

    for (const company of body.companies) {
      try {
        const companyAccounts = await fetchCompanyAccounts(company);
        allAccounts.push(...companyAccounts);
      } catch (error) {
        errors.push({
          companyName: company.companyName,
          message: error instanceof Error ? error.message : "Neznáma chyba pri načítaní účtov"
        });
      }
    }

    return NextResponse.json({ data: allAccounts, errors });
  } catch (error) {
    await appendKrosLog({
      direction: "error",
      endpoint: "/api/kros/payments/accounts",
      method: "POST",
      message: `Neočakávaná chyba načítania účtov: ${error instanceof Error ? error.message : "Neznáma chyba"}`
    });
    return NextResponse.json({
      data: [],
      errors: [
        {
          companyName: "global",
          message: `Neočakávaná chyba načítania účtov: ${error instanceof Error ? error.message : "Neznáma chyba"}`
        }
      ]
    });
  }
}
