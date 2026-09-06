import { getDateRange } from "@/lib/period-buckets";
import { normalizeInvoices } from "@/lib/dashboard-live";
import type { KrosConnection } from "@/lib/kros-types";
import {
  getCachedInvoices,
  readSyncMeta,
  syncCompanyMetaKey,
  syncMonthMetaKey,
  upsertCachedInvoices,
  writeSyncMeta
} from "@/lib/invoice-cache";
import { formatMonthKeyLabel } from "@/lib/use-sync-progress";
import { getMaxLastModified, withLastModifiedOverlap } from "./last-modified";
import { buildMonthSyncRanges, getLiveDataRange, type MonthSyncRange } from "./month-ranges";
import type { PlanContext, RunContext, SyncEngine } from "./types";

/**
 * Jeden krok sťahovania — buď chýbajúci mesiac firmy, alebo faktúry zmenené od
 * posledného syncu.
 *
 * `range` nesie krok, nie engine: pôvodne sa počítal raz pre celý beh efektu
 * z aktuálnej granularity, ale engine dostáva krok samostatne. Keby si ho
 * domýšľal, zapísal by mesiac pod iný kľúč `syncMeta`, než pod akým sa hľadá —
 * a ten mesiac by sa sťahoval donekonečna.
 */
export type InvoiceSyncStep =
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

async function fetchInvoices(
  body: {
    companyIds: number[];
    deliveryDateFrom?: string;
    deliveryDateTo?: string;
    lastModifiedTimestamp?: string;
  },
  signal: AbortSignal
) {
  const response = await fetch("/api/kros/invoices", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(
      payload?.details
        ? `${payload?.error ?? "Nepodarilo sa načítať faktúry."} ${payload.details}`
        : payload?.error ?? "Nepodarilo sa načítať faktúry."
    );
  }
  if (Array.isArray(payload?.errors) && payload.errors.length > 0) {
    throw new Error(payload.errors[0]?.message ?? "Niektoré firmy sa nepodarilo načítať.");
  }
  return Array.isArray(payload?.data) ? (payload.data as unknown[]) : [];
}

/**
 * Plán sťahovania. Exportovaný zvlášť od enginu, aby sa dal otestovať bez siete —
 * je to jediné miesto, ktoré rozhoduje, či sa niečo stiahne druhýkrát.
 */
export async function planInvoiceSteps(ctx: PlanContext): Promise<InvoiceSyncStep[]> {
  const liveDataRange = getLiveDataRange(ctx.granularity);
  const fetchRange = getDateRange(liveDataRange === "history" ? "year" : "month");
  const monthRanges = buildMonthSyncRanges(fetchRange.fetchFrom, fetchRange.fetchTo);
  const steps: InvoiceSyncStep[] = [];

  for (const connection of ctx.connections) {
    const missingMonthRanges: MonthSyncRange[] = [];
    for (const monthRange of monthRanges) {
      const monthMeta = await readSyncMeta(
        syncMonthMetaKey(connection.companyId, liveDataRange, monthRange.monthKey)
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

    const companyMeta = await readSyncMeta(syncCompanyMetaKey(connection.companyId, liveDataRange));
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

export const invoiceEngine: SyncEngine<InvoiceSyncStep> = {
  key: "invoices",

  async hydrate(companyIds) {
    return { invoices: await getCachedInvoices(companyIds) };
  },

  plan: planInvoiceSteps,

  describe(step) {
    if (step.kind === "month") {
      return {
        key: `invoices:${step.connection.companyId}:${step.monthRange.monthKey}`,
        group: step.connection.companyName,
        // Doména je v popise zámerne: na Domove bežia faktúry aj výdavky za sebou
        // a bez nej by obrazovka sťahovania ukázala dvakrát ten istý riadok.
        label: `faktúry — ${formatMonthKeyLabel(step.monthRange.monthKey)}`
      };
    }
    return {
      key: `invoices:${step.connection.companyId}:changes`,
      group: step.connection.companyName,
      label: "zmenené faktúry"
    };
  },

  async run(step, ctx: RunContext) {
    const { connection } = step;
    const liveDataRange = step.range;

    const rawInvoices = await fetchInvoices(
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
      ctx.signal
    );

    const companyInvoices = normalizeInvoices(rawInvoices).filter(
      (invoice) =>
        invoice.companyId === connection.companyId || invoice.companyName === connection.companyName
    );
    const completedAt = new Date().toISOString();
    await upsertCachedInvoices(connection.companyId, companyInvoices);

    if (step.kind === "month") {
      await writeSyncMeta({
        key: syncMonthMetaKey(connection.companyId, liveDataRange, step.monthRange.monthKey),
        companyId: connection.companyId,
        range: liveDataRange,
        monthKey: step.monthRange.monthKey,
        completedAt
      });
    }

    const companyMetaKey = syncCompanyMetaKey(connection.companyId, liveDataRange);
    const previousCompanyMeta = await readSyncMeta(companyMetaKey);
    await writeSyncMeta({
      key: companyMetaKey,
      companyId: connection.companyId,
      range: liveDataRange,
      completedAt,
      lastModifiedTimestamp: getMaxLastModified(
        companyInvoices,
        previousCompanyMeta?.lastModifiedTimestamp
      )
    });
  }
};
