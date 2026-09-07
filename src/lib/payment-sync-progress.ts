import { parseDocumentDate } from "./document-date";

/**
 * Kľúče, pod ktorými KROS vracia dátum zaúčtovania platby. Jedno miesto pravdy
 * pre normalizáciu (`cashflow-live.ts`) aj pre odhad priebehu sťahovania.
 */
export const PAYMENT_BOOKED_AT_KEYS = [
  "bookedAt",
  "BookedAt",
  "bookedDate",
  "BookedDate",
  "date",
  "Date",
  "dateOfPayment"
] as const;

export function readPaymentBookedAt(row: unknown): string | undefined {
  if (!row || typeof row !== "object") return undefined;
  const record = row as Record<string, unknown>;

  for (const key of PAYMENT_BOOKED_AT_KEYS) {
    const value = record[key];
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
  }

  return undefined;
}

/** Čo o sťahovaní pohybov vieme po načítaní ďalšej stránky. */
export type PaymentSyncStats = {
  /** Počet doteraz načítaných pohybov. */
  loaded: number;
  /** Celkový počet, ak ho API v odpovedi uvádza. */
  total?: number;
  /** Najstarší dátum spomedzi načítaných pohybov. */
  oldest?: string;
  /** Najnovší dátum spomedzi načítaných pohybov. */
  newest?: string;
  /** Dátum, kde sa sťahovanie práve nachádza (posledná položka poslednej stránky). */
  frontier?: string;
};

export type PaymentSyncEstimate = {
  /** Podiel hotového v rámci kroku (0–1). */
  fraction: number;
  /** Obdobie, v ktorom sa sťahovanie nachádza, napr. `marec 2024`. */
  periodLabel?: string;
};

/**
 * 100 % dostane až dokončený krok — kým beží, odhad zámerne nedosiahne celok,
 * aby sa bar nezasekol na stovke a nevyzeral zamrznuto.
 */
const MAX_FRACTION = 0.97;

/**
 * Prehľady kreslia najviac 5 rokov dozadu, takže rovnaké okno berieme za
 * horizont aj tu — slúži ako menovateľ, keď skutočný celok nepoznáme.
 */
const HORIZON_MS = 5 * 365 * 24 * 60 * 60 * 1000;

const PERIOD_FORMAT = new Intl.DateTimeFormat("sk-SK", { month: "long", year: "numeric" });

function toMs(value: string | undefined) {
  return parseDocumentDate(value)?.getTime();
}

/**
 * Odhad priebehu sťahovania pohybov. Pohyby sa ťahajú jedným Top/Skip prechodom
 * bez dátumového filtra, takže celok dopredu nepoznáme — ale každý pohyb nesie
 * dátum, a z toho, kam sa dátumy posunuli, sa dá odvodiť približný podiel.
 *
 * Poradie, v ktorom KROS pohyby vracia, nie je zdokumentované, preto ho
 * rozlišujeme z dát: pri vzostupnom poradí je hranica zároveň najnovším
 * dátumom (a menovateľom je vzdialenosť od najstaršieho do dneška), pri
 * zostupnom je hranica najstarším dátumom (a menovateľom horizont prehľadov).
 * Nezoradené dáta padnú na pokryté rozpätie oproti horizontu.
 *
 * Odhad nikdy neklesne — `previousFraction` drží bar monotónny aj vtedy, keď
 * dátumy v dátach preskakujú.
 */
export function estimatePaymentSyncProgress(
  stats: PaymentSyncStats,
  options: { now?: Date; previousFraction?: number } = {}
): PaymentSyncEstimate {
  const previous = options.previousFraction ?? 0;
  const nowMs = (options.now ?? new Date()).getTime();
  const periodLabel = formatPaymentPeriodLabel(stats.frontier);

  const settle = (value: number): PaymentSyncEstimate => ({
    fraction: Math.min(MAX_FRACTION, Math.max(previous, Math.max(value, 0))),
    periodLabel
  });

  if (stats.total !== undefined && stats.total > 0) {
    return settle(stats.loaded / stats.total);
  }

  const oldest = toMs(stats.oldest);
  const newest = toMs(stats.newest);
  const frontier = toMs(stats.frontier);
  if (oldest === undefined || newest === undefined || frontier === undefined) {
    return settle(0);
  }

  // Vzostupné poradie: hranica je najnovší dátum, cieľom je dnešok.
  if (frontier === newest && frontier !== oldest) {
    const span = nowMs - oldest;
    return settle(span > 0 ? (frontier - oldest) / span : 0);
  }

  // Zostupné poradie: hranica je najstarší dátum, cieľom je horizont prehľadov.
  if (frontier === oldest && frontier !== newest) {
    return settle((newest - frontier) / HORIZON_MS);
  }

  return settle((newest - oldest) / HORIZON_MS);
}

/** `2024-03-14` → `marec 2024`. */
export function formatPaymentPeriodLabel(value: string | undefined) {
  const date = parseDocumentDate(value);
  return date ? PERIOD_FORMAT.format(date) : undefined;
}

/**
 * Celkový počet z odpovede API, ak ho nesie — názov poľa nie je zdokumentovaný,
 * preto skúšame bežné varianty aj vnorený `paging`. Keď ho odpoveď má, odhad
 * priebehu nemusí hádať z dátumov.
 */
export function readTotalCount(payload: unknown): number | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const record = payload as Record<string, unknown>;

  for (const key of [
    "totalCount",
    "TotalCount",
    "total",
    "Total",
    "count",
    "Count",
    "@odata.count"
  ]) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
  }

  const paging = record.paging ?? record.Paging;
  return paging && typeof paging === "object" ? readTotalCount(paging) : undefined;
}

/** Rozpätie dátumov načítaných pohybov vrátane hranice, kde sťahovanie je. */
export type PaymentDateSpan = Pick<PaymentSyncStats, "oldest" | "newest" | "frontier">;

/**
 * Doplní rozpätie o ďalšiu stránku pohybov. `frontier` je dátum poslednej
 * položky stránky — teda tam, kam sa sťahovanie dostalo; `oldest`/`newest` sú
 * krajné dátumy všetkého načítaného. Pohyby bez čitateľného dátumu preskočíme.
 */
export function trackPaymentDateSpan(span: PaymentDateSpan, items: unknown[]): PaymentDateSpan {
  let { oldest, newest, frontier } = span;

  for (const item of items) {
    const bookedAt = readPaymentBookedAt(item);
    const time = toMs(bookedAt);
    if (!bookedAt || time === undefined) continue;

    frontier = bookedAt;
    const oldestTime = toMs(oldest);
    const newestTime = toMs(newest);
    if (oldestTime === undefined || time < oldestTime) oldest = bookedAt;
    if (newestTime === undefined || time > newestTime) newest = bookedAt;
  }

  return { oldest, newest, frontier };
}
