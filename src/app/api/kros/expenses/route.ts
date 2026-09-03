import { NextResponse } from "next/server";
import { appendKrosLog } from "@/lib/kros-logs";
import { toDateOnlyString } from "@/lib/document-date";

type CompanyConnection = {
  companyId: number;
  companyName: string;
  token: string;
};

type ExpenseRequestBody = {
  companies: CompanyConnection[];
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

/**
 * Rozúčtovanie na štítky a sumy riadkov sú len v detaile dokladu — hlavičkový
 * zoznam journalItems nenesie. Ku každej hlavičke preto doťahujeme detail;
 * súbežne ich beží len pár naraz, nech nenarazíme na limity API.
 */
const DETAIL_CONCURRENCY = 4;

async function fetchExpenseDetail(company: CompanyConnection, expenseId: string) {
  const response = await fetchWithRetry(
    `${KROS_API_BASE}/api/expenses/${encodeURIComponent(expenseId)}`,
    {
      headers: {
        Authorization: `Bearer ${company.token}`,
        Accept: "application/json"
      },
      cache: "no-store"
    }
  );

  if (!response.ok) return null;

  try {
    const payload = (await response.json()) as { data?: unknown };
    return payload?.data && typeof payload.data === "object"
      ? (payload.data as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** Doplní hlavičky o journalItems z detailu; doklad bez detailu ostáva ako je. */
async function attachJournalItems(
  company: CompanyConnection,
  expenses: Record<string, unknown>[]
) {
  let failed = 0;
  let nextIndex = 0;

  const worker = async () => {
    while (nextIndex < expenses.length) {
      const index = nextIndex;
      nextIndex += 1;
      const expense = expenses[index];
      const id = typeof expense.id === "string" ? expense.id : null;
      if (!id) continue;

      try {
        const detail = await fetchExpenseDetail(company, id);
        if (detail) {
          expenses[index] = { ...expense, journalItems: detail.journalItems ?? [] };
        } else {
          failed += 1;
        }
      } catch {
        failed += 1;
      }
    }
  };

  await appendKrosLog({
    direction: "request",
    endpoint: "/api/expenses/{id}",
    method: "GET",
    companyName: company.companyName,
    message: `Doťahujem detaily (rozúčtovanie) pre ${expenses.length} dokladov`
  });

  await Promise.all(
    Array.from({ length: Math.min(DETAIL_CONCURRENCY, expenses.length) }, worker)
  );

  await appendKrosLog({
    direction: failed > 0 ? "error" : "response",
    endpoint: "/api/expenses/{id}",
    method: "GET",
    companyName: company.companyName,
    message:
      failed > 0
        ? `Detaily načítané s chybami: ${expenses.length - failed}/${expenses.length} OK, ${failed} zlyhalo (použije sa rozúčtovanie z hlavičky)`
        : `Detaily načítané: ${expenses.length}/${expenses.length}`
  });

  return expenses;
}

async function fetchCompanyExpenses(
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
      endpoint: "/api/expenses",
      method: "GET",
      companyName: company.companyName,
      message: `Skip=${skip}, Top=${top}${deliveryFrom ? `, DeliveryDateFrom=${deliveryFrom}` : ""}${deliveryTo ? `, DeliveryDateTo=${deliveryTo}` : ""}${lastModifiedTimestamp ? `, LastModifiedTimestamp=${lastModifiedTimestamp}` : ""}`
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

  const withDetails = await attachJournalItems(
    company,
    aggregated.map((expense) => ({ ...((expense as Record<string, unknown>) ?? {}) }))
  );

  return withDetails.map((expense) => ({
    ...expense,
    __company: company.companyName,
    __companyId: company.companyId
  }));
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as ExpenseRequestBody;
    if (!Array.isArray(body.companies) || (!body.lastModifiedTimestamp && (!body.deliveryDateFrom || !body.deliveryDateTo))) {
      return NextResponse.json({ error: "Neplatné telo požiadavky" }, { status: 400 });
    }

    await appendKrosLog({
      direction: "request",
      endpoint: "/api/kros/expenses",
      method: "POST",
      message: `firmy=${body.companies.length}${body.deliveryDateFrom ? `, deliveryDateFrom=${body.deliveryDateFrom}` : ""}${body.deliveryDateTo ? `, deliveryDateTo=${body.deliveryDateTo}` : ""}${body.lastModifiedTimestamp ? `, lastModifiedTimestamp=${body.lastModifiedTimestamp}` : ""}`,
      payload: {
        companies: body.companies.map((company) => ({
          companyId: company.companyId,
          companyName: company.companyName
        })),
        deliveryDateFrom: body.deliveryDateFrom,
        deliveryDateTo: body.deliveryDateTo,
        lastModifiedTimestamp: body.lastModifiedTimestamp
      }
    });

    const allExpenses = [];
    const errors: { companyName: string; message: string }[] = [];

    for (const company of body.companies) {
      try {
        const companyExpenses = await fetchCompanyExpenses(
          company,
          body.deliveryDateFrom,
          body.deliveryDateTo,
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
