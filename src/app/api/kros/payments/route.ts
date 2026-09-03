import { NextResponse } from "next/server";
import { appendKrosLog } from "@/lib/kros-logs";
import {
  readTotalCount,
  trackPaymentDateSpan,
  type PaymentDateSpan
} from "@/lib/payment-sync-progress";

type CompanyConnection = {
  companyId: number;
  companyName: string;
  token: string;
};

type PaymentsRequestBody = {
  companies: CompanyConnection[];
  lastModifiedTimestamp?: string;
};

/**
 * Priebeh sťahovania pohybov jednej firmy. Pohyby idú jedným Top/Skip
 * prechodom, takže celok dopredu nepoznáme — klientovi preto posielame, koľko
 * ich už je a kam sa posunuli dátumy. Odhad z toho robí
 * `estimatePaymentSyncProgress()`.
 */
type PaymentsProgressEvent = {
  type: "progress";
  phase: "payments";
  companyName: string;
  loaded: number;
  /** Celkový počet, ak ho API v odpovedi uvádza. */
  total?: number;
  oldest?: string;
  newest?: string;
  frontier?: string;
};

type ProgressReporter = (event: PaymentsProgressEvent) => void;

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
  onProgress: ProgressReporter,
  signal: AbortSignal,
  lastModifiedTimestamp?: string
) {
  const top = 100;
  let skip = 0;
  const aggregated: unknown[] = [];
  let span: PaymentDateSpan = {};
  let total: number | undefined;

  while (true) {
    if (signal.aborted) return [];

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
    total = total ?? readTotalCount(payload);
    span = trackPaymentDateSpan(span, items);

    onProgress({
      type: "progress",
      phase: "payments",
      companyName: company.companyName,
      loaded: aggregated.length,
      total,
      ...span
    });

    if (items.length < top) break;
    skip += top;
  }

  return aggregated.map((payment) => ({
    ...((payment as object) ?? {}),
    __company: company.companyName,
    __companyId: company.companyId
  }));
}

/**
 * Odpoveď je NDJSON stream: riadky `progress` idú klientovi počas sťahovania a
 * dáta prídu posledným riadkom `result`. Pohybov býva veľa a bez priebehu bola
 * obrazovka dlho zamrznutá a potom skočila na hotovo.
 */
export async function POST(request: Request) {
  let body: PaymentsRequestBody;
  try {
    body = (await request.json()) as PaymentsRequestBody;
  } catch {
    return NextResponse.json({ error: "Neplatné telo požiadavky" }, { status: 400 });
  }

  if (!Array.isArray(body.companies) || body.companies.length === 0) {
    return NextResponse.json({ error: "Neplatné telo požiadavky" }, { status: 400 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let isClosed = false;
      const send = (event: unknown) => {
        if (isClosed) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          // Klient odišiel — ďalšie riadky už nemá kto prečítať.
          isClosed = true;
        }
      };

      try {
        await runPaymentsSync(body, request.signal, send);
      } catch (error) {
        await appendKrosLog({
          direction: "error",
          endpoint: "/api/kros/payments",
          method: "POST",
          message: `Neočakávaná chyba načítania pohybov: ${error instanceof Error ? error.message : "Neznáma chyba"}`
        });
        send({
          type: "result",
          data: [],
          errors: [
            {
              companyName: "global",
              message: `Neočakávaná chyba načítania pohybov: ${error instanceof Error ? error.message : "Neznáma chyba"}`
            }
          ]
        });
      } finally {
        isClosed = true;
        controller.close();
      }
    }
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no"
    }
  });
}

async function runPaymentsSync(
  body: PaymentsRequestBody,
  signal: AbortSignal,
  send: (event: unknown) => void
) {
  const allPayments: unknown[] = [];
  const errors: { companyName: string; message: string }[] = [];

  for (const company of body.companies) {
    try {
      const companyPayments = await fetchCompanyPayments(
        company,
        send,
        signal,
        body.lastModifiedTimestamp
      );
      allPayments.push(...companyPayments);
    } catch (error) {
      errors.push({
        companyName: company.companyName,
        message: error instanceof Error ? error.message : "Neznáma chyba pri načítaní pohybov"
      });
    }
  }

  send({ type: "result", data: allPayments, errors });
}
