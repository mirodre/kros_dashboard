import { getDateRange } from "@/lib/period-buckets";
import { normalizeExpenses } from "@/lib/expenses-live";
import type { KrosConnection } from "@/lib/kros-types";
import {
  expenseCompanyMetaKey,
  expenseMonthMetaKey,
  getCachedExpenses,
  readExpenseSyncMeta,
  upsertCachedExpenses,
  writeExpenseSyncMeta
} from "@/lib/expense-cache";
import { readNdjsonStream } from "@/lib/ndjson-stream";
import { formatMonthKeyLabel } from "@/lib/use-sync-progress";
import { getMaxLastModified, withLastModifiedOverlap } from "./last-modified";
import { buildMonthSyncRanges, getLiveDataRange, type MonthSyncRange } from "./month-ranges";
import type { PlanContext, RunContext, SyncEngine } from "./types";

/** Riadky priebehu z `/api/kros/expenses` (NDJSON stream). */
type ExpenseStreamEvent =
  | { type: "progress"; phase: "list"; loaded?: number }
  | { type: "progress"; phase: "details"; done?: number; total?: number }
  | ExpenseResultEvent;

type ExpenseResultEvent = { type: "result"; data?: unknown[]; errors?: { message?: string }[] };

// Stránkovanie hlavičiek je proti doťahovaniu rozúčtovania krátke, ale nie
// zanedbateľné — kus baru mu preto necháme.
const LIST_PHASE_SHARE = 0.12;

/** Podiel hotového v rámci jedného kroku + jeho popis pre progress bar. */
function readStepProgress(event: ExpenseStreamEvent) {
  if (event.type !== "progress") return null;

  if (event.phase === "list") {
    const loaded = event.loaded ?? 0;
    return { fraction: LIST_PHASE_SHARE / 2, detail: `hľadám doklady (${loaded})` };
  }

  const total = event.total ?? 0;
  const done = event.done ?? 0;
  if (total === 0) return { fraction: 1, detail: "žiadne doklady" };
  return {
    fraction: LIST_PHASE_SHARE + (1 - LIST_PHASE_SHARE) * (done / total),
    detail: `doklady ${done}/${total}`
  };
}

/**
 * Krok sťahovania výdavkov. `range` nesie krok, nie engine — pod týmto kľúčom sa
 * mesiac zapisuje do `syncMeta` aj hľadá, takže domýšľať ho v `run` by znamenalo
 * mesiac, ktorý sa nikdy neoznačí za hotový.
 */
export type ExpenseSyncStep =
  | {
      kind: "month";
      range: "ytd" | "history";
      connection: KrosConnection;
      monthRange: MonthSyncRange;
    }
  | {
      kind: "changes";
      range: "ytd" | "history";
      connection: KrosConnection;
      lastModifiedTimestamp: string;
    };

export async function planExpenseSteps(ctx: PlanContext): Promise<ExpenseSyncStep[]> {
  const liveDataRange = getLiveDataRange(ctx.granularity);
  const fetchRange = getDateRange(liveDataRange === "history" ? "year" : "month");
  const monthRanges = buildMonthSyncRanges(fetchRange.fetchFrom, fetchRange.fetchTo);
  const steps: ExpenseSyncStep[] = [];

  for (const connection of ctx.connections) {
    const missingMonthRanges: MonthSyncRange[] = [];
    for (const monthRange of monthRanges) {
      const monthMeta = await readExpenseSyncMeta(
        expenseMonthMetaKey(connection.companyId, liveDataRange, monthRange.monthKey)
      );
      if (!monthMeta?.completedAt) {
        missingMonthRanges.push(monthRange);
      }
    }

    if (missingMonthRanges.length > 0) {
      for (const monthRange of missingMonthRanges) {
        steps.push({ kind: "month", range: liveDataRange, connection, monthRange });
      }
      continue;
    }

    if (!ctx.isManualRefresh) continue;

    const companyMeta = await readExpenseSyncMeta(
      expenseCompanyMetaKey(connection.companyId, liveDataRange)
    );
    if (!companyMeta?.lastModifiedTimestamp) continue;
    steps.push({
      kind: "changes",
      range: liveDataRange,
      connection,
      lastModifiedTimestamp: companyMeta.lastModifiedTimestamp
    });
  }

  return steps;
}

async function fetchExpenses(
  body: {
    companyIds: number[];
    deliveryDateFrom?: string;
    deliveryDateTo?: string;
    lastModifiedTimestamp?: string;
  },
  ctx: RunContext
) {
  const response = await fetch("/api/kros/expenses", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: ctx.signal
  });

  if (!response.ok || !response.body) {
    const payload = await response.json().catch(() => null);
    throw new Error(
      payload?.details
        ? `${payload?.error ?? "Nepodarilo sa načítať výdavky."} ${payload.details}`
        : payload?.error ?? "Nepodarilo sa načítať výdavky."
    );
  }

  // Dáta prídu posledným riadkom streamu, dovtedy chodí priebeh sťahovania.
  const collected: { result: ExpenseResultEvent | null } = { result: null };
  await readNdjsonStream(response.body, (raw) => {
    const event = raw as ExpenseStreamEvent;
    if (event?.type === "result") {
      collected.result = event;
      return;
    }

    const stepProgress = readStepProgress(event);
    if (stepProgress) {
      ctx.onProgress(stepProgress.fraction, stepProgress.detail);
    }
  });

  const payload = collected.result;
  if (!payload) {
    throw new Error("Nepodarilo sa načítať výdavky — sťahovanie sa nedokončilo.");
  }
  if (Array.isArray(payload.errors) && payload.errors.length > 0) {
    throw new Error(payload.errors[0]?.message ?? "Niektoré firmy sa nepodarilo načítať.");
  }
  return Array.isArray(payload.data) ? payload.data : [];
}

export const expenseEngine: SyncEngine<ExpenseSyncStep> = {
  key: "expenses",

  async hydrate(companyIds) {
    return { expenses: await getCachedExpenses(companyIds) };
  },

  plan: planExpenseSteps,

  describe(step) {
    if (step.kind === "month") {
      return {
        key: `expenses:${step.connection.companyId}:${step.monthRange.monthKey}`,
        group: step.connection.companyName,
        // Doména je v popise zámerne: na Domove bežia faktúry aj výdavky za sebou
        // a bez nej by obrazovka sťahovania ukázala dvakrát ten istý riadok.
        label: `výdavky — ${formatMonthKeyLabel(step.monthRange.monthKey)}`
      };
    }
    return {
      key: `expenses:${step.connection.companyId}:changes`,
      group: step.connection.companyName,
      label: "zmenené výdavky"
    };
  },

  async run(step, ctx) {
    const { connection } = step;
    const liveDataRange = step.range;

    const rawExpenses = await fetchExpenses(
      step.kind === "month"
        ? {
            companyIds: [connection.companyId],
            deliveryDateFrom: step.monthRange.from,
            deliveryDateTo: step.monthRange.to
          }
        : {
            companyIds: [connection.companyId],
            lastModifiedTimestamp: withLastModifiedOverlap(step.lastModifiedTimestamp)
          },
      ctx
    );

    const companyExpenses = normalizeExpenses(rawExpenses).filter(
      (expense) =>
        expense.companyId === connection.companyId || expense.companyName === connection.companyName
    );
    const completedAt = new Date().toISOString();
    await upsertCachedExpenses(connection.companyId, companyExpenses);

    if (step.kind === "month") {
      await writeExpenseSyncMeta({
        key: expenseMonthMetaKey(connection.companyId, liveDataRange, step.monthRange.monthKey),
        companyId: connection.companyId,
        range: liveDataRange,
        monthKey: step.monthRange.monthKey,
        completedAt
      });
    }

    const companyMetaKey = expenseCompanyMetaKey(connection.companyId, liveDataRange);
    const previousCompanyMeta = await readExpenseSyncMeta(companyMetaKey);
    await writeExpenseSyncMeta({
      key: companyMetaKey,
      companyId: connection.companyId,
      range: liveDataRange,
      completedAt,
      lastModifiedTimestamp: getMaxLastModified(
        companyExpenses,
        previousCompanyMeta?.lastModifiedTimestamp
      )
    });
  }
};
