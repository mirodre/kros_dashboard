import type { KrosConnection, NormalizedPaymentTransaction } from "@/lib/kros-types";
import {
  cashflowCompanyMetaKey,
  getCachedPaymentAccounts,
  getCachedPaymentTransactions,
  readCashflowSyncMeta,
  replaceCachedPaymentAccounts,
  upsertCachedPaymentTransactions,
  writeCashflowSyncMeta
} from "@/lib/cashflow-cache";
import { normalizePaymentAccounts, normalizePaymentTransactions } from "@/lib/cashflow-live";
import { readNdjsonStream } from "@/lib/ndjson-stream";
import { estimatePaymentSyncProgress, type PaymentSyncStats } from "@/lib/payment-sync-progress";
import { getMaxLastModified, withLastModifiedOverlap } from "./last-modified";
import type { PlanContext, RunContext, SyncEngine } from "./types";

/** Riadky priebehu z `/api/kros/payments` (NDJSON stream). */
type PaymentsStreamEvent =
  | ({ type: "progress"; phase: "payments"; companyName: string } & PaymentSyncStats)
  | PaymentsResultEvent;

type PaymentsResultEvent = { type: "result"; data?: unknown[]; errors?: { message?: string }[] };

/**
 * Sťahovanie firmy je jeden krok — zoznam účtov je proti pohybom krátky, takže
 * by ako vlastný krok zabral polovicu baru a ten by potom skočil na 50 % a
 * zvyšok sa vliekol. Účty preto dostanú len začiatok kroku.
 */
const ACCOUNTS_SHARE = 0.08;

export type CashflowSyncStep = {
  connection: KrosConnection;
  needsFullSync: boolean;
  lastModifiedTimestamp?: string;
};

export async function planCashflowSteps(ctx: PlanContext): Promise<CashflowSyncStep[]> {
  const steps: CashflowSyncStep[] = [];

  for (const connection of ctx.connections) {
    const meta = await readCashflowSyncMeta(cashflowCompanyMetaKey(connection.companyId));
    const needsFullSync = !meta?.completedAt;
    if (!needsFullSync && !ctx.isManualRefresh) continue;
    steps.push({
      connection,
      needsFullSync,
      lastModifiedTimestamp: meta?.lastModifiedTimestamp
    });
  }

  return steps;
}

async function fetchAccounts(connection: KrosConnection, signal: AbortSignal) {
  const response = await fetch("/api/kros/payments/accounts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ companyIds: [connection.companyId] }),
    signal
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error("Nepodarilo sa načítať payments dáta.");
  }
  if (Array.isArray(payload?.errors) && payload.errors.length > 0) {
    throw new Error(payload.errors[0]?.message ?? "Niektoré firmy sa nepodarilo načítať.");
  }
  return Array.isArray(payload?.data) ? (payload.data as unknown[]) : [];
}

async function fetchPayments(
  body: { companyIds: number[]; lastModifiedTimestamp?: string },
  ctx: RunContext
) {
  const response = await fetch("/api/kros/payments", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: ctx.signal
  });

  if (!response.ok || !response.body) {
    throw new Error("Nepodarilo sa načítať payments dáta.");
  }

  // Dáta prídu posledným riadkom streamu, dovtedy chodí priebeh sťahovania.
  const collected: { result: PaymentsResultEvent | null } = { result: null };
  let fraction = 0;
  await readNdjsonStream(response.body, (raw) => {
    const event = raw as PaymentsStreamEvent;
    if (event?.type === "result") {
      collected.result = event;
      return;
    }
    if (event?.type !== "progress") return;

    const estimate = estimatePaymentSyncProgress(event, { previousFraction: fraction });
    fraction = estimate.fraction;
    ctx.onProgress(
      ACCOUNTS_SHARE + (1 - ACCOUNTS_SHARE) * fraction,
      [`pohyby ${event.loaded}`, estimate.periodLabel].filter(Boolean).join(" · ")
    );
  });

  const payload = collected.result;
  if (!payload) {
    throw new Error("Nepodarilo sa načítať payments dáta — sťahovanie sa nedokončilo.");
  }
  if (Array.isArray(payload.errors) && payload.errors.length > 0) {
    throw new Error(payload.errors[0]?.message ?? "Niektoré firmy sa nepodarilo načítať.");
  }
  return Array.isArray(payload.data) ? payload.data : [];
}

export const cashflowEngine: SyncEngine<CashflowSyncStep> = {
  key: "cashflow",

  async hydrate(companyIds) {
    const [accounts, transactions] = await Promise.all([
      getCachedPaymentAccounts(companyIds),
      getCachedPaymentTransactions(companyIds)
    ]);
    return { accounts, transactions };
  },

  plan: planCashflowSteps,

  describe(step) {
    return {
      key: `${step.connection.companyId}:payments`,
      group: step.connection.companyName,
      label: "bankové účty a pohyby"
    };
  },

  async run(step, ctx) {
    const { connection, needsFullSync, lastModifiedTimestamp } = step;
    ctx.onProgress(ACCOUNTS_SHARE / 2, "bankové účty");

    // Zoznam účtov a zostatky sú malé a menia sa — sťahujú sa vždy celé.
    const rawAccounts = await fetchAccounts(connection, ctx.signal);
    const companyAccounts = normalizePaymentAccounts(rawAccounts).filter(
      (account) =>
        account.companyId === connection.companyId ||
        account.companyName === connection.companyName
    );
    await replaceCachedPaymentAccounts(connection.companyId, companyAccounts);

    if (ctx.signal.aborted) return;
    ctx.onProgress(ACCOUNTS_SHARE, "pohyby na účtoch");

    const accountById = new Map(companyAccounts.map((account) => [account.id, account]));
    const rawPayments = await fetchPayments(
      {
        companyIds: [connection.companyId],
        ...(!needsFullSync && lastModifiedTimestamp
          ? { lastModifiedTimestamp: withLastModifiedOverlap(lastModifiedTimestamp) }
          : {})
      },
      ctx
    );
    const companyTransactions: NormalizedPaymentTransaction[] = normalizePaymentTransactions(
      rawPayments,
      accountById
    ).filter(
      (transaction) =>
        transaction.companyId === connection.companyId ||
        transaction.companyName === connection.companyName
    );
    await upsertCachedPaymentTransactions(connection.companyId, companyTransactions);
    await writeCashflowSyncMeta({
      key: cashflowCompanyMetaKey(connection.companyId),
      companyId: connection.companyId,
      completedAt: new Date().toISOString(),
      lastModifiedTimestamp: getMaxLastModified(companyTransactions, lastModifiedTimestamp)
    });
  }
};
