import type { Granularity, KpiCard } from "./mock-data";
import type { AggregatedBreakdownPoint, AggregatedRevenuePoint, NormalizedInvoice } from "./kros-types";
import { getDocumentDateTime, isValidDocumentDate, parseDocumentDate } from "./document-date";
import {
  buildBuckets,
  classifyPeriod,
  formatPeriodLabel,
  getBucketRange,
  getDateRange,
  getWeekOfYear,
  toBucketKey,
  type PeriodWindow
} from "./period-buckets";

function toComparableBucketKey(date: Date, granularity: Granularity, _periodStart: Date) {
  if (granularity === "week") {
    return `w-${getWeekOfYear(date)}`;
  }

  return toBucketKey(date, granularity);
}

function normalizeTag(rawTag: unknown): string | null {
  if (typeof rawTag === "string" && rawTag.trim()) return rawTag.trim();
  if (rawTag && typeof rawTag === "object" && "name" in rawTag) {
    const name = (rawTag as { name?: unknown }).name;
    if (typeof name === "string" && name.trim()) return name.trim();
  }
  return null;
}

function readString(row: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number") return String(value);
  }
  return null;
}

function readPartnerName(row: Record<string, unknown>) {
  const direct = readString(row, ["partnerName", "customerName", "businessPartnerName"]);
  if (direct) return direct;

  const partner = row.partner ?? row.customer ?? row.businessPartner;
  if (partner && typeof partner === "object") {
    const partnerRow = partner as Record<string, unknown>;
    const partnerName = readString(partnerRow, ["name", "businessName", "companyName"]);
    if (partnerName) return partnerName;

    const address = partnerRow.address ?? partnerRow.postalAddress;
    if (address && typeof address === "object") {
      return readString(address as Record<string, unknown>, ["businessName", "contactName", "name"]) ?? undefined;
    }
  }

  return undefined;
}

/**
 * Dátum, podľa ktorého analytiky (graf, KPI, breakdowny) zaraďujú faktúru
 * do obdobia — dátum dodania (DUZP); faktúry bez neho padajú na dátum vystavenia.
 * Zoznam Posledné faktúry zámerne ostáva na dátume vystavenia.
 */
export function getInvoiceAnalyticsDate(invoice: NormalizedInvoice) {
  return invoice.deliveryDate ?? invoice.issueDate;
}

export function normalizeInvoices(rawInvoices: unknown[]): NormalizedInvoice[] {
  return rawInvoices
    .map((invoice): NormalizedInvoice | null => {
      const row = invoice as Record<string, unknown>;
      const id = readString(row, ["id", "invoiceId", "documentId", "number"]);
      const issueDate = typeof row.issueDate === "string" ? row.issueDate : null;
      const deliveryDateRaw = readString(row, ["deliveryDate"]);
      const deliveryDate = deliveryDateRaw && isValidDocumentDate(deliveryDateRaw) ? deliveryDateRaw : undefined;
      const companyName = typeof row.__company === "string" ? row.__company : "Neznáma firma";
      const companyId = typeof row.__companyId === "number" ? row.__companyId : undefined;
      const invoiceNumber = readString(row, ["invoiceNumber", "number", "documentNumber", "variableSymbol"]);
      const partnerName = readPartnerName(row);
      const lastModifiedTimestamp =
        readString(row, ["lastModifiedTimestamp", "lastModified", "modifiedAt", "updatedAt"]) ?? undefined;
      const totalPrice =
        Number(
          (row.prices as Record<string, unknown> | undefined)?.legislativePrices &&
            ((row.prices as Record<string, unknown>).legislativePrices as Record<string, unknown>).totalPrice
        ) || 0;
      const tagsRaw = Array.isArray(row.tags) ? row.tags : [];
      const tags = tagsRaw.map(normalizeTag).filter((tag): tag is string => Boolean(tag));

      if (!id || !issueDate || !isValidDocumentDate(issueDate)) return null;

      return {
        id,
        companyId,
        companyName,
        invoiceNumber: invoiceNumber ?? undefined,
        partnerName,
        issueDate,
        deliveryDate,
        lastModifiedTimestamp,
        totalPrice,
        tags: tags.length > 0 ? tags : ["Nedefinované"]
      } satisfies NormalizedInvoice;
    })
    .filter((invoice): invoice is NormalizedInvoice => Boolean(invoice));
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
    const invoiceDate = parseDocumentDate(getInvoiceAnalyticsDate(invoice));
    if (!invoiceDate) return false;
    const inWindow = invoiceDate >= range.previousFrom && invoiceDate <= range.currentTo;
    const companyPass =
      selectedCompanySet.size === 0 || selectedCompanySet.has(invoice.companyName);
    const tagPass =
      selectedTagSet.size === 0 || invoice.tags.some((tag) => selectedTagSet.has(tag));
    return inWindow && companyPass && tagPass;
  });

  for (const invoice of filtered) {
    const date = parseDocumentDate(getInvoiceAnalyticsDate(invoice));
    if (!date) continue;

    if (granularity === "year") {
      const currentBucket = bucketMap.get(`y-${date.getFullYear()}`);
      const previousBucket = bucketMap.get(`y-${date.getFullYear() + 1}`);
      if (currentBucket) currentBucket.current += invoice.totalPrice;
      if (previousBucket) previousBucket.previous += invoice.totalPrice;
      continue;
    }

    if (date.getFullYear() === currentYear && date <= range.currentTo) {
      const key = toComparableBucketKey(date, granularity, range.currentFrom);
      const bucket = bucketMap.get(key);
      if (!bucket) continue;
      bucket.current += invoice.totalPrice;
    }
    if (date.getFullYear() === currentYear - 1 && date <= range.previousTo) {
      const key = toComparableBucketKey(date, granularity, range.previousFrom);
      const bucket = bucketMap.get(key);
      if (!bucket) continue;
      bucket.previous += invoice.totalPrice;
    }
  }

  return Array.from(bucketMap.values()).map((values) => ({
    label: values.label,
    current: Math.round(values.current),
    previous: Math.round(values.previous)
  }));
}

export function getRevenueBucketInvoices({
  invoices,
  granularity,
  bucketLabel,
  selectedTags,
  selectedCompanies
}: ComputeInput & { bucketLabel: string }) {
  const range = getDateRange(granularity);
  const selectedTagSet = new Set(selectedTags);
  const selectedCompanySet = new Set(selectedCompanies);
  const now = range.currentTo;
  const currentYear = now.getFullYear();
  const bucket = buildBuckets(granularity, now).find((item) => item.label === bucketLabel);

  if (!bucket) {
    return {
      current: [],
      previous: [],
      currentPeriodLabel: "",
      previousPeriodLabel: ""
    };
  }

  const currentRange = getBucketRange(bucket.key, granularity, currentYear, range.currentTo);
  const previousRange =
    granularity === "year"
      ? getBucketRange(`y-${Number(bucket.key.replace("y-", "")) - 1}`, granularity, currentYear - 1, range.previousTo)
      : getBucketRange(bucket.key, granularity, currentYear - 1, range.previousTo);

  const filterInvoices = ({ from, to }: { from: Date; to: Date }) =>
    invoices
      .filter((invoice) => {
        const invoiceDate = parseDocumentDate(getInvoiceAnalyticsDate(invoice));
        if (!invoiceDate) return false;
        const companyPass =
          selectedCompanySet.size === 0 || selectedCompanySet.has(invoice.companyName);
        const tagPass =
          selectedTagSet.size === 0 || invoice.tags.some((tag) => selectedTagSet.has(tag));
        return invoiceDate >= from && invoiceDate <= to && companyPass && tagPass;
      })
      .sort(
        (a, b) =>
          (getDocumentDateTime(getInvoiceAnalyticsDate(b)) ?? 0) -
          (getDocumentDateTime(getInvoiceAnalyticsDate(a)) ?? 0)
      );

  return {
    current: filterInvoices(currentRange),
    previous: filterInvoices(previousRange),
    currentPeriodLabel: formatPeriodLabel(currentRange.from, currentRange.to),
    previousPeriodLabel: formatPeriodLabel(previousRange.from, previousRange.to)
  };
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
    const invoiceDate = parseDocumentDate(getInvoiceAnalyticsDate(invoice));
    const companyPass = selectedCompanySet.size === 0 || selectedCompanySet.has(invoice.companyName);
    const tagPass = selectedTagSet.size === 0 || invoice.tags.some((tag) => selectedTagSet.has(tag));
    if (!invoiceDate || !companyPass || !tagPass) continue;

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
  selectedCompanies: string[],
  period?: PeriodWindow
): AggregatedBreakdownPoint[] {
  const companySet = new Set(selectedCompanies);
  const map = new Map<string, { current: number; previous: number }>();
  const range = period ?? getDateRange("month");

  for (const invoice of invoices) {
    if (companySet.size > 0 && !companySet.has(invoice.companyName)) continue;

    const invoiceDate = parseDocumentDate(getInvoiceAnalyticsDate(invoice));
    if (!invoiceDate) continue;
    const yearBucket = classifyPeriod(invoiceDate, range);
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
  selectedTags: string[],
  selectedCompanies: string[] = [],
  period?: PeriodWindow
): AggregatedBreakdownPoint[] {
  const tagSet = new Set(selectedTags);
  const companySet = new Set(selectedCompanies);
  const map = new Map<string, { current: number; previous: number }>();
  const range = period ?? getDateRange("month");

  for (const invoice of invoices) {
    if (companySet.size > 0 && !companySet.has(invoice.companyName)) continue;

    const tagPass = tagSet.size === 0 || invoice.tags.some((tag) => tagSet.has(tag));
    if (!tagPass) continue;

    const invoiceDate = parseDocumentDate(getInvoiceAnalyticsDate(invoice));
    if (!invoiceDate) continue;
    const yearBucket = classifyPeriod(invoiceDate, range);
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

/** Latest invoices for the home dashboard, respecting the same tag/company/date window as revenue charts. */
export function getFilteredRecentInvoices(
  invoices: NormalizedInvoice[],
  options: {
    granularity: Granularity;
    selectedTags: string[];
    selectedCompanies: string[];
    limit?: number;
    /** Focus stĺpca grafu: zoznam sa zúži na doklady z toho obdobia (nie aj vlaňajšie). */
    period?: PeriodWindow;
  }
): NormalizedInvoice[] {
  const range = getDateRange(options.granularity);
  const selectedTagSet = new Set(options.selectedTags);
  const selectedCompanySet = new Set(options.selectedCompanies);
  const limit = options.limit ?? 10;

  const filtered = invoices.filter((invoice) => {
    const invoiceDate = parseDocumentDate(invoice.issueDate);
    if (!invoiceDate) return false;
    const inWindow = invoiceDate >= range.previousFrom && invoiceDate <= range.currentTo;
    // Obdobie sa meria dátumom, ktorým doklad padá do stĺpca grafu (DUZP), aby v zozname
    // boli tie isté doklady, aké sa v stĺpci sčítali — zoradenie ostáva podľa vystavenia.
    const analyticsDate = parseDocumentDate(getInvoiceAnalyticsDate(invoice));
    const periodPass =
      !options.period ||
      Boolean(
        analyticsDate &&
          analyticsDate >= options.period.currentFrom &&
          analyticsDate <= options.period.currentTo
      );
    const companyPass =
      selectedCompanySet.size === 0 || selectedCompanySet.has(invoice.companyName);
    const tagPass =
      selectedTagSet.size === 0 || invoice.tags.some((tag) => selectedTagSet.has(tag));
    return inWindow && periodPass && companyPass && tagPass;
  });

  return filtered
    .slice()
    .sort((a, b) => {
      const da = getDocumentDateTime(a.issueDate) ?? 0;
      const db = getDocumentDateTime(b.issueDate) ?? 0;
      if (db !== da) return db - da;
      const ma = a.lastModifiedTimestamp ? new Date(a.lastModifiedTimestamp).getTime() : 0;
      const mb = b.lastModifiedTimestamp ? new Date(b.lastModifiedTimestamp).getTime() : 0;
      return mb - ma;
    })
    .slice(0, limit);
}
