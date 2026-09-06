import type { Granularity } from "@/lib/mock-data";
import { monthKeyFromDate } from "@/lib/invoice-cache";

/** Jeden mesiac sťahovania. `from`/`to` sú ISO okamihy, nie kalendárne mesiace. */
export type MonthSyncRange = { monthKey: string; from: string; to: string };

/** Roky potrebujú aj minulé roky; týždne a mesiace vystačia s aktuálnym rokom. */
export function getLiveDataRange(granularity: Granularity): "ytd" | "history" {
  return granularity === "year" ? "history" : "ytd";
}

function startOfDayIso(date: Date) {
  const value = new Date(date);
  value.setUTCHours(0, 0, 0, 0);
  return value.toISOString();
}

function endOfDayIso(date: Date) {
  const value = new Date(date);
  value.setUTCHours(23, 59, 59, 999);
  return value.toISOString();
}

/**
 * Okno sťahovania rozdelené na mesiace. Mesiac je jednotka, ktorú si cache
 * pamätá ako hotovú (`syncMeta`), preto je aj jednotkou plánu a jedným krokom
 * ukazovateľa priebehu.
 */
export function buildMonthSyncRanges(fetchFrom: string, fetchTo: string) {
  const start = new Date(fetchFrom);
  const end = new Date(fetchTo);
  const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
  const ranges: MonthSyncRange[] = [];

  while (cursor <= end) {
    const monthStart = new Date(cursor);
    const monthEnd = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
    const from = monthStart < start ? start : monthStart;
    const to = monthEnd > end ? end : monthEnd;

    ranges.push({
      monthKey: monthKeyFromDate(cursor),
      from: startOfDayIso(from),
      to: endOfDayIso(to)
    });

    cursor.setMonth(cursor.getMonth() + 1);
  }

  return ranges;
}
