import type { Granularity } from "./mock-data";

/**
 * Obdobia grafov na jednom mieste. Kým to bolo rozkopírované v `dashboard-live`
 * a `expenses-live`, hrozilo, že sa Príjmy a Výdavky rozídu v tom, čo je „ten istý
 * stĺpec" — a práve na tom stojí filtrovanie sekcií klikom do grafu.
 */

/** Okno „toto obdobie vs. to isté vlani" — tvar, v ktorom ho čítajú všetky breakdowny. */
export type PeriodWindow = {
  currentFrom: Date;
  currentTo: Date;
  previousFrom: Date;
  previousTo: Date;
};

function startOfDayIso(date: Date) {
  const local = new Date(date);
  local.setHours(0, 0, 0, 0);
  return local.toISOString();
}

function endOfDayIso(date: Date) {
  const local = new Date(date);
  local.setHours(23, 59, 59, 999);
  return local.toISOString();
}

export function getDateRange(granularity: Granularity) {
  const now = new Date();
  const currentFrom = new Date(now);
  const currentTo = new Date(now);
  currentFrom.setHours(0, 0, 0, 0);
  currentTo.setHours(23, 59, 59, 999);

  if (granularity === "week" || granularity === "month") {
    currentFrom.setMonth(0, 1);
  } else {
    currentFrom.setFullYear(now.getFullYear() - 4, 0, 1);
  }

  const previousFrom = new Date(currentFrom);
  previousFrom.setFullYear(previousFrom.getFullYear() - 1);
  const previousTo = new Date(currentTo);
  previousTo.setFullYear(previousTo.getFullYear() - 1);

  return {
    fetchFrom: startOfDayIso(previousFrom),
    fetchTo: endOfDayIso(currentTo),
    currentFrom,
    currentTo,
    previousFrom,
    previousTo
  };
}

export function getWeekOfYear(date: Date) {
  const normalized = new Date(date);
  normalized.setHours(0, 0, 0, 0);
  normalized.setDate(normalized.getDate() + 3 - ((normalized.getDay() + 6) % 7));
  const firstThursday = new Date(normalized.getFullYear(), 0, 4);
  firstThursday.setDate(firstThursday.getDate() + 3 - ((firstThursday.getDay() + 6) % 7));
  return (
    1 +
    Math.round((normalized.getTime() - firstThursday.getTime()) / (7 * 24 * 60 * 60 * 1000))
  );
}

export type BucketDef = { key: string; label: string };

export function buildBuckets(granularity: Granularity, now: Date): BucketDef[] {
  const currentYear = now.getFullYear();

  if (granularity === "month") {
    return Array.from({ length: now.getMonth() + 1 }, (_, idx) => ({
      key: `m-${idx + 1}`,
      label: new Date(currentYear, idx, 1).toLocaleString("sk-SK", { month: "short" })
    }));
  }

  if (granularity === "week") {
    const currentWeek = getWeekOfYear(now);
    return Array.from({ length: currentWeek }, (_, idx) => ({
      key: `w-${idx + 1}`,
      label: `T${idx + 1}`
    }));
  }

  return Array.from({ length: 5 }, (_, idx) => {
    const year = currentYear - 4 + idx;
    return { key: `y-${year}`, label: String(year) };
  });
}

export function toBucketKey(date: Date, granularity: Granularity) {
  if (granularity === "month") return `m-${date.getMonth() + 1}`;
  if (granularity === "week") return `w-${getWeekOfYear(date)}`;
  return `y-${date.getFullYear()}`;
}

export function getIsoWeekStart(year: number, week: number) {
  const simple = new Date(year, 0, 4 + (week - 1) * 7);
  const day = (simple.getDay() + 6) % 7;
  simple.setDate(simple.getDate() - day);
  simple.setHours(0, 0, 0, 0);
  return simple;
}

export function getBucketRange(key: string, granularity: Granularity, year: number, maxTo: Date) {
  if (granularity === "week") {
    const week = Number(key.replace("w-", ""));
    const from = getIsoWeekStart(year, week);
    const to = new Date(from);
    to.setDate(to.getDate() + 6);
    to.setHours(23, 59, 59, 999);
    return { from, to: to > maxTo ? maxTo : to };
  }

  if (granularity === "month") {
    const month = Number(key.replace("m-", "")) - 1;
    const from = new Date(year, month, 1);
    const to = new Date(year, month + 1, 0, 23, 59, 59, 999);
    return { from, to: to > maxTo ? maxTo : to };
  }

  const bucketYear = Number(key.replace("y-", ""));
  const from = new Date(bucketYear, 0, 1);
  const to = new Date(bucketYear, 11, 31, 23, 59, 59, 999);
  return { from, to: to > maxTo ? maxTo : to };
}

export function formatPeriodLabel(from: Date, to: Date) {
  const formatter = new Intl.DateTimeFormat("sk-SK", {
    day: "numeric",
    month: "numeric",
    year: "numeric"
  });
  return `${formatter.format(from)} - ${formatter.format(to)}`;
}

/**
 * Okno jedného stĺpca grafu: v tomto roku ten stĺpec, vlani to isté obdobie — presne tak,
 * ako stĺpec počíta `computeRevenueSeries`/`computeExpenseSeries`, aby sekcie po kliknutí
 * ukazovali tie isté čísla ako graf. Pri ročnej granularite je „vlani" predošlý rok.
 *
 * `null` znamená, že taký stĺpec pri danej granularite neexistuje (typicky po prepnutí
 * obdobia) — vtedy sa filter obdobia nemá čoho držať a patrí zahodiť.
 */
export function getBucketPeriodWindow(
  granularity: Granularity,
  bucketLabel: string
): PeriodWindow | null {
  const range = getDateRange(granularity);
  const bucket = buildBuckets(granularity, range.currentTo).find(
    (item) => item.label === bucketLabel
  );
  if (!bucket) return null;

  const currentYear = range.currentTo.getFullYear();
  const current = getBucketRange(bucket.key, granularity, currentYear, range.currentTo);
  const previous =
    granularity === "year"
      ? getBucketRange(
          `y-${Number(bucket.key.replace("y-", "")) - 1}`,
          granularity,
          currentYear - 1,
          range.previousTo
        )
      : getBucketRange(bucket.key, granularity, currentYear - 1, range.previousTo);

  return {
    currentFrom: current.from,
    currentTo: current.to,
    previousFrom: previous.from,
    previousTo: previous.to
  };
}

/** Do ktorej polovice okna dátum padá. `null` = mimo okna, teda sa nepočíta. */
export function classifyPeriod(date: Date, window: PeriodWindow): "current" | "previous" | null {
  if (date >= window.currentFrom && date <= window.currentTo) return "current";
  if (date >= window.previousFrom && date <= window.previousTo) return "previous";
  return null;
}

/**
 * Popis focusnutého obdobia do odznaku filtra. Štítok stĺpca sám (`sep`, `T5`) by na
 * odznaku vedľa štítkov a firiem nepovedal, že ide o obdobie tohto roka.
 */
export function formatPeriodFocusLabel(granularity: Granularity, bucketLabel: string) {
  if (granularity === "year") return bucketLabel;
  return `${bucketLabel} ${new Date().getFullYear()}`;
}
