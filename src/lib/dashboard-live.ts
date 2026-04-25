import type { Granularity, KpiCard } from "./mock-data";
import type { AggregatedBreakdownPoint, AggregatedRevenuePoint, NormalizedInvoice } from "./kros-types";

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

function getWeekOfYear(date: Date) {
  const start = new Date(date.getFullYear(), 0, 1);
  const dayOfYear = Math.floor((date.getTime() - start.getTime()) / (24 * 60 * 60 * 1000)) + 1;
  return Math.ceil(dayOfYear / 7);
}

type BucketDef = { key: string; label: string };

function buildBuckets(granularity: Granularity, now: Date): BucketDef[] {
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

function toBucketKey(date: Date, granularity: Granularity) {
  if (granularity === "month") return `m-${date.getMonth() + 1}`;
  if (granularity === "week") return `w-${getWeekOfYear(date)}`;
  return `y-${date.getFullYear()}`;
}

function normalizeTag(rawTag: unknown): string | null {
  if (typeof rawTag === "string" && rawTag.trim()) return rawTag.trim();
  if (rawTag && typeof rawTag === "object" && "name" in rawTag) {
    const name = (rawTag as { name?: unknown }).name;
    if (typeof name === "string" && name.trim()) return name.trim();
  }
  return null;
}

export function normalizeInvoices(rawInvoices: unknown[]): NormalizedInvoice[] {
  return rawInvoices
    .map((invoice) => {
      const row = invoice as Record<string, unknown>;
      const issueDate = typeof row.issueDate === "string" ? row.issueDate : null;
      const companyName = typeof row.__company === "string" ? row.__company : "Neznáma firma";
      const totalPrice =
        Number(
          (row.prices as Record<string, unknown> | undefined)?.legislativePrices &&
            ((row.prices as Record<string, unknown>).legislativePrices as Record<string, unknown>).totalPrice
        ) || 0;
      const tagsRaw = Array.isArray(row.tags) ? row.tags : [];
      const tags = tagsRaw.map(normalizeTag).filter((tag): tag is string => Boolean(tag));

      if (!issueDate || Number.isNaN(new Date(issueDate).getTime())) return null;

      return {
        companyName,
        issueDate,
        totalPrice,
        tags: tags.length > 0 ? tags : ["Nedefinované"]
      } satisfies NormalizedInvoice;
    })
    .filter((invoice): invoice is NormalizedInvoice => Boolean(invoice));
}

function toBucketLabel(date: Date, granularity: Granularity) {
  if (granularity === "year") return String(date.getFullYear());
  if (granularity === "week") {
    const week = Math.ceil((date.getDate() + new Date(date.getFullYear(), date.getMonth(), 1).getDay()) / 7);
    return `${date.toLocaleString("sk-SK", { month: "short" })} T${week}`;
  }
  return date.toLocaleString("sk-SK", { month: "short" });
}

type ComputeInput = {
  invoices: NormalizedInvoice[];
  granularity: Granularity;
  selectedTags: string[];
  selectedCompanies: string[];
};

export function computeRevenueSeries({
  invoices,
  granularity,
  selectedTags,
  selectedCompanies
}: ComputeInput): AggregatedRevenuePoint[] {
  const range = getDateRange(granularity);
  const selectedTagSet = new Set(selectedTags);
  const selectedCompanySet = new Set(selectedCompanies);
  const now = range.currentTo;
  const currentYear = now.getFullYear();
  const buckets = buildBuckets(granularity, now);
  const bucketMap = new Map<string, { label: string; current: number; previous: number }>(
    buckets.map((bucket) => [bucket.key, { label: bucket.label, current: 0, previous: 0 }])
  );

  const filtered = invoices.filter((invoice) => {
    const invoiceDate = new Date(invoice.issueDate);
    const inWindow = invoiceDate >= range.previousFrom && invoiceDate <= range.currentTo;
    const companyPass =
      selectedCompanySet.size === 0 || selectedCompanySet.has(invoice.companyName);
    const tagPass =
      selectedTagSet.size === 0 || invoice.tags.some((tag) => selectedTagSet.has(tag));
    return inWindow && companyPass && tagPass;
  });

  for (const invoice of filtered) {
    const date = new Date(invoice.issueDate);
    const key = toBucketKey(date, granularity);

    if (!bucketMap.has(key) && granularity !== "year") continue;

    if (granularity === "year") {
      const currentBucket = bucketMap.get(`y-${date.getFullYear()}`);
      const previousBucket = bucketMap.get(`y-${date.getFullYear() + 1}`);
      if (currentBucket) currentBucket.current += invoice.totalPrice;
      if (previousBucket) previousBucket.previous += invoice.totalPrice;
      continue;
    }

    const bucket = bucketMap.get(key);
    if (!bucket) continue;

    if (date.getFullYear() === currentYear && date <= range.currentTo) {
      bucket.current += invoice.totalPrice;
    }
    if (date.getFullYear() === currentYear - 1 && date <= range.previousTo) {
      bucket.previous += invoice.totalPrice;
    }
  }

  return Array.from(bucketMap.values()).map((values) => ({
    label: values.label,
    current: Math.round(values.current),
    previous: Math.round(values.previous)
  }));
}

export function computeKpis(
  points: AggregatedRevenuePoint[],
  ytdTotals?: { current: number; previous: number }
): KpiCard[] {
  const currentBucket = points.length > 0 ? points[points.length - 1] : null;
  const currentPeriodCurrent = currentBucket?.current ?? 0;
  const currentPeriodPrevious = currentBucket?.previous ?? 0;

  const currentTotal = points.reduce((sum, point) => sum + point.current, 0);
  const previousTotal = points.reduce((sum, point) => sum + point.previous, 0);
  const avgCurrent = points.length ? currentTotal / points.length : 0;
  const avgPrevious = points.length ? previousTotal / points.length : 0;

  const ytdCurrent = ytdTotals?.current ?? currentTotal;
  const ytdPrevious = ytdTotals?.previous ?? previousTotal;

  const delta = (current: number, previous: number) =>
    previous === 0 ? 100 : ((current - previous) / previous) * 100;

  return [
    {
      title: "Tržby v aktuálnom období",
      currentValue: Math.round(currentPeriodCurrent),
      previousValue: Math.round(currentPeriodPrevious),
      deltaPct: delta(currentPeriodCurrent, currentPeriodPrevious)
    },
    {
      title: "Kumulované tržby tento rok",
      currentValue: Math.round(ytdCurrent),
      previousValue: Math.round(ytdPrevious),
      deltaPct: delta(ytdCurrent, ytdPrevious)
    },
    {
      title: "Priemer na obdobie",
      currentValue: Math.round(avgCurrent),
      previousValue: Math.round(avgPrevious),
      deltaPct: delta(avgCurrent, avgPrevious)
    }
  ];
}

export function computeComparableYtdTotals({
  invoices,
  selectedTags,
  selectedCompanies
}: {
  invoices: NormalizedInvoice[];
  selectedTags: string[];
  selectedCompanies: string[];
}) {
  const range = getDateRange("month");
  const selectedTagSet = new Set(selectedTags);
  const selectedCompanySet = new Set(selectedCompanies);
  let current = 0;
  let previous = 0;

  for (const invoice of invoices) {
    const invoiceDate = new Date(invoice.issueDate);
    const companyPass = selectedCompanySet.size === 0 || selectedCompanySet.has(invoice.companyName);
    const tagPass = selectedTagSet.size === 0 || invoice.tags.some((tag) => selectedTagSet.has(tag));
    if (!companyPass || !tagPass) continue;

    if (invoiceDate >= range.currentFrom && invoiceDate <= range.currentTo) {
      current += invoice.totalPrice;
    } else if (invoiceDate >= range.previousFrom && invoiceDate <= range.previousTo) {
      previous += invoice.totalPrice;
    }
  }

  return {
    current: Math.round(current),
    previous: Math.round(previous)
  };
}

export function computeTagBreakdown(
  invoices: NormalizedInvoice[],
  selectedCompanies: string[]
): AggregatedBreakdownPoint[] {
  const companySet = new Set(selectedCompanies);
  const map = new Map<string, { current: number; previous: number }>();
  const range = getDateRange("month");

  for (const invoice of invoices) {
    if (companySet.size > 0 && !companySet.has(invoice.companyName)) continue;

    const invoiceDate = new Date(invoice.issueDate);
    let yearBucket: "current" | "previous" | null = null;

    if (invoiceDate >= range.currentFrom && invoiceDate <= range.currentTo) {
      yearBucket = "current";
    } else if (invoiceDate >= range.previousFrom && invoiceDate <= range.previousTo) {
      yearBucket = "previous";
    }

    if (!yearBucket) continue;

    for (const tag of invoice.tags) {
      const bucket = map.get(tag) ?? { current: 0, previous: 0 };
      bucket[yearBucket] += invoice.totalPrice;
      map.set(tag, bucket);
    }
  }

  return Array.from(map.entries()).map(([name, values]) => ({
    name,
    amount: Math.round(values.current),
    previousAmount: Math.round(values.previous)
  }));
}

export function computeCompanyBreakdown(
  invoices: NormalizedInvoice[],
  selectedTags: string[]
): AggregatedBreakdownPoint[] {
  const tagSet = new Set(selectedTags);
  const map = new Map<string, { current: number; previous: number }>();
  const range = getDateRange("month");

  for (const invoice of invoices) {
    const tagPass = tagSet.size === 0 || invoice.tags.some((tag) => tagSet.has(tag));
    if (!tagPass) continue;

    const invoiceDate = new Date(invoice.issueDate);
    let yearBucket: "current" | "previous" | null = null;

    if (invoiceDate >= range.currentFrom && invoiceDate <= range.currentTo) {
      yearBucket = "current";
    } else if (invoiceDate >= range.previousFrom && invoiceDate <= range.previousTo) {
      yearBucket = "previous";
    }

    if (!yearBucket) continue;

    const bucket = map.get(invoice.companyName) ?? { current: 0, previous: 0 };
    bucket[yearBucket] += invoice.totalPrice;
    map.set(invoice.companyName, bucket);
  }

  return Array.from(map.entries()).map(([name, values]) => ({
    name,
    amount: Math.round(values.current),
    previousAmount: Math.round(values.previous)
  }));
}
