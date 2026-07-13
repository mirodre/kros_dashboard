import type { Granularity, KpiCard } from "./mock-data";
import type {
  AggregatedBreakdownPoint,
  AggregatedRevenuePoint,
  ExpensePaymentStatus,
  NormalizedExpense
} from "./kros-types";
import { getDateRange } from "./dashboard-live";

/** Podiel štítku na výdavkoch v aktuálnom období — podklad pre donut Štruktúra výdavkov. */
export type ExpenseTagSlice = {
  name: string;
  amount: number;
  previousAmount: number;
  share: number;
  documentCount: number;
};

export type ExpenseVendorPoint = {
  name: string;
  amount: number;
  previousAmount: number;
  share: number;
  documentCount: number;
};

export type ExpenseDueWatchlist = {
  overdue: NormalizedExpense[];
  overdueTotal: number;
  upcoming: NormalizedExpense[];
  upcomingTotal: number;
};

const EXPENSE_PAYMENT_STATUS_BY_CODE: Record<number, ExpensePaymentStatus> = {
  0: "notPaid",
  1: "fullyPaid",
  2: "overPaid",
  3: "partiallyPaid",
  [-1]: "undefined"
};

const EXPENSE_DOCUMENT_TYPE_LABELS: Record<number, string> = {
  10: "Došlá faktúra",
  11: "Bloček",
  13: "Interný doklad",
  14: "Bankové oznámenie",
  15: "Zálohová faktúra",
  17: "Dobropis",
  19: "Ťarchopis"
};

const RECEIVED_CREDIT_NOTE = 17;
const RECEIVED_PROFORMA_INVOICE = 15;

export function getExpenseDocumentTypeLabel(documentType: number) {
  return EXPENSE_DOCUMENT_TYPE_LABELS[documentType] ?? "Doklad";
}

export function isExpenseUnpaid(expense: NormalizedExpense) {
  return expense.paymentStatus === "notPaid" || expense.paymentStatus === "partiallyPaid";
}

export function isExpenseOverdue(expense: NormalizedExpense, referenceDate: Date = new Date()) {
  if (!isExpenseUnpaid(expense) || !expense.dueDate) return false;
  const due = new Date(expense.dueDate);
  if (Number.isNaN(due.getTime())) return false;
  const startOfToday = new Date(referenceDate);
  startOfToday.setHours(0, 0, 0, 0);
  return due.getTime() < startOfToday.getTime();
}

/**
 * Zálohové faktúry nechávame mimo súčtov, aby sa výdavok nepočítal dvakrát
 * (záloha + finálna faktúra). V zoznamoch dokladov ich ale zobrazujeme.
 */
export function countsTowardsSpend(expense: NormalizedExpense) {
  return expense.documentType !== RECEIVED_PROFORMA_INVOICE;
}

function getString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function getNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const normalized = value.replace(/\s/g, "").replace(",", ".");
    const parsed = Number(normalized);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function pickString(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = getString(record[key]);
    if (value) return value;
  }
  return undefined;
}

function readPartnerName(row: Record<string, unknown>) {
  const direct = pickString(row, ["partnerName", "supplierName", "businessPartnerName"]);
  if (direct) return direct;

  const partner = row.partner ?? row.supplier ?? row.businessPartner;
  if (partner && typeof partner === "object") {
    const partnerRow = partner as Record<string, unknown>;
    const partnerName = pickString(partnerRow, ["name", "businessName", "companyName"]);
    if (partnerName) return partnerName;

    const address = partnerRow.address ?? partnerRow.postalAddress;
    if (address && typeof address === "object") {
      return pickString(address as Record<string, unknown>, ["businessName", "contactName", "name"]);
    }
  }

  return undefined;
}

function normalizeTag(rawTag: unknown): string | null {
  if (typeof rawTag === "string" && rawTag.trim()) return rawTag.trim();
  if (rawTag && typeof rawTag === "object" && "name" in rawTag) {
    const name = (rawTag as { name?: unknown }).name;
    if (typeof name === "string" && name.trim()) return name.trim();
  }
  return null;
}

function readPrices(row: Record<string, unknown>) {
  const prices = row.prices;
  if (!prices || typeof prices !== "object") return { totalInclVat: 0, vat: 0 };
  const pricesRow = prices as Record<string, unknown>;

  const readPriceGroup = (group: unknown) => {
    if (!group || typeof group !== "object") return null;
    const groupRow = group as Record<string, unknown>;
    const totalInclVat = getNumber(groupRow.totalPriceInclVat);
    if (totalInclVat === undefined) return null;
    return { totalInclVat, vat: getNumber(groupRow.vatTotalPrice) ?? 0 };
  };

  const legislative = readPriceGroup(pricesRow.legislativePrices);
  const documentGroup = readPriceGroup(pricesRow.documentPrices);

  // KROS pri výdavkoch bežne vracia legislativePrices vynulované a reálnu sumu
  // nesie documentPrices — preferujeme skupinu s nenulovou sumou.
  if (legislative && legislative.totalInclVat !== 0) return legislative;
  if (documentGroup && documentGroup.totalInclVat !== 0) return documentGroup;
  return legislative ?? documentGroup ?? { totalInclVat: 0, vat: 0 };
}

export function normalizeExpenses(rawExpenses: unknown[]): NormalizedExpense[] {
  return rawExpenses
    .map((expense): NormalizedExpense | null => {
      const row = expense as Record<string, unknown>;
      const id = pickString(row, ["id", "documentId"]);
      const issueDate = typeof row.issueDate === "string" ? row.issueDate : null;
      if (!id || !issueDate || Number.isNaN(new Date(issueDate).getTime())) return null;

      const companyName = typeof row.__company === "string" ? row.__company : "Neznáma firma";
      const companyId = typeof row.__companyId === "number" ? row.__companyId : undefined;
      const documentType = getNumber(row.documentType) ?? 0;
      const prices = readPrices(row);
      // Dobropis znižuje výdavky — ak API vráti kladnú sumu, otočíme znamienko.
      const sign = documentType === RECEIVED_CREDIT_NOTE ? -1 : 1;
      const totalPriceInclVat =
        sign < 0 ? -Math.abs(prices.totalInclVat) : prices.totalInclVat;
      const vatTotalPrice = sign < 0 ? -Math.abs(prices.vat) : prices.vat;

      const paymentStatusCode = getNumber(row.paymentStatus);
      const tagsRaw = Array.isArray(row.tags) ? row.tags : [];
      const tags = tagsRaw.map(normalizeTag).filter((tag): tag is string => Boolean(tag));

      return {
        id,
        companyId,
        companyName,
        documentNumber: pickString(row, ["documentNumber"]),
        documentType,
        partnerName: readPartnerName(row),
        issueDate,
        dueDate: pickString(row, ["dueDate"]),
        receivedDate: pickString(row, ["receivedDate"]),
        lastModifiedTimestamp: pickString(row, ["lastModifiedTimestamp"]),
        totalPriceInclVat,
        vatTotalPrice,
        paymentStatus:
          paymentStatusCode !== undefined
            ? EXPENSE_PAYMENT_STATUS_BY_CODE[paymentStatusCode] ?? "undefined"
            : "undefined",
        paymentType: pickString(row, ["paymentType"]),
        hasAttachments: row.hasAttachments === true,
        tags: tags.length > 0 ? tags : ["Nedefinované"]
      } satisfies NormalizedExpense;
    })
    .filter((expense): expense is NormalizedExpense => Boolean(expense));
}

type FilterInput = {
  selectedTags: string[];
  selectedCompanies: string[];
};

function buildExpenseFilter({ selectedTags, selectedCompanies }: FilterInput) {
  const tagSet = new Set(selectedTags);
  const companySet = new Set(selectedCompanies);
  return (expense: NormalizedExpense) => {
    const companyPass = companySet.size === 0 || companySet.has(expense.companyName);
    const tagPass = tagSet.size === 0 || expense.tags.some((tag) => tagSet.has(tag));
    return companyPass && tagPass;
  };
}

function getWeekOfYear(date: Date) {
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

function getIsoWeekStart(year: number, week: number) {
  const simple = new Date(year, 0, 4 + (week - 1) * 7);
  const day = (simple.getDay() + 6) % 7;
  simple.setDate(simple.getDate() - day);
  simple.setHours(0, 0, 0, 0);
  return simple;
}

function getBucketRange(key: string, granularity: Granularity, year: number, maxTo: Date) {
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

function formatPeriodLabel(from: Date, to: Date) {
  const formatter = new Intl.DateTimeFormat("sk-SK", {
    day: "numeric",
    month: "numeric",
    year: "numeric"
  });
  return `${formatter.format(from)} - ${formatter.format(to)}`;
}

type ComputeInput = FilterInput & {
  expenses: NormalizedExpense[];
  granularity: Granularity;
};

export function computeExpenseSeries({
  expenses,
  granularity,
  selectedTags,
  selectedCompanies
}: ComputeInput): AggregatedRevenuePoint[] {
  const range = getDateRange(granularity);
  const filterPass = buildExpenseFilter({ selectedTags, selectedCompanies });
  const now = range.currentTo;
  const currentYear = now.getFullYear();
  const buckets = buildBuckets(granularity, now);
  const bucketMap = new Map<string, { label: string; current: number; previous: number }>(
    buckets.map((bucket) => [bucket.key, { label: bucket.label, current: 0, previous: 0 }])
  );

  const filtered = expenses.filter((expense) => {
    if (!countsTowardsSpend(expense)) return false;
    const expenseDate = new Date(expense.issueDate);
    const inWindow = expenseDate >= range.previousFrom && expenseDate <= range.currentTo;
    return inWindow && filterPass(expense);
  });

  for (const expense of filtered) {
    const date = new Date(expense.issueDate);

    if (granularity === "year") {
      const currentBucket = bucketMap.get(`y-${date.getFullYear()}`);
      const previousBucket = bucketMap.get(`y-${date.getFullYear() + 1}`);
      if (currentBucket) currentBucket.current += expense.totalPriceInclVat;
      if (previousBucket) previousBucket.previous += expense.totalPriceInclVat;
      continue;
    }

    if (date.getFullYear() === currentYear && date <= range.currentTo) {
      const bucket = bucketMap.get(toBucketKey(date, granularity));
      if (bucket) bucket.current += expense.totalPriceInclVat;
    }
    if (date.getFullYear() === currentYear - 1 && date <= range.previousTo) {
      const bucket = bucketMap.get(toBucketKey(date, granularity));
      if (bucket) bucket.previous += expense.totalPriceInclVat;
    }
  }

  return Array.from(bucketMap.values()).map((values) => ({
    label: values.label,
    current: Math.round(values.current),
    previous: Math.round(values.previous)
  }));
}

export function getExpenseBucketDocs({
  expenses,
  granularity,
  bucketLabel,
  selectedTags,
  selectedCompanies
}: ComputeInput & { bucketLabel: string }) {
  const range = getDateRange(granularity);
  const filterPass = buildExpenseFilter({ selectedTags, selectedCompanies });
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

  const filterExpenses = ({ from, to }: { from: Date; to: Date }) =>
    expenses
      .filter((expense) => {
        const expenseDate = new Date(expense.issueDate);
        return expenseDate >= from && expenseDate <= to && filterPass(expense);
      })
      .sort((a, b) => new Date(b.issueDate).getTime() - new Date(a.issueDate).getTime());

  return {
    current: filterExpenses(currentRange),
    previous: filterExpenses(previousRange),
    currentPeriodLabel: formatPeriodLabel(currentRange.from, currentRange.to),
    previousPeriodLabel: formatPeriodLabel(previousRange.from, previousRange.to)
  };
}

export function computeComparableExpenseYtdTotals({
  expenses,
  selectedTags,
  selectedCompanies
}: FilterInput & { expenses: NormalizedExpense[] }) {
  const range = getDateRange("month");
  const filterPass = buildExpenseFilter({ selectedTags, selectedCompanies });
  let current = 0;
  let previous = 0;

  for (const expense of expenses) {
    if (!countsTowardsSpend(expense) || !filterPass(expense)) continue;

    const expenseDate = new Date(expense.issueDate);
    if (expenseDate >= range.currentFrom && expenseDate <= range.currentTo) {
      current += expense.totalPriceInclVat;
    } else if (expenseDate >= range.previousFrom && expenseDate <= range.previousTo) {
      previous += expense.totalPriceInclVat;
    }
  }

  return {
    current: Math.round(current),
    previous: Math.round(previous)
  };
}

export function computeExpenseKpis(
  points: AggregatedRevenuePoint[],
  ytdTotals: { current: number; previous: number },
  dueWatchlist: ExpenseDueWatchlist
): KpiCard[] {
  const currentBucket = points.length > 0 ? points[points.length - 1] : null;
  const currentPeriodCurrent = currentBucket?.current ?? 0;
  const currentPeriodPrevious = currentBucket?.previous ?? 0;

  const currentTotal = points.reduce((sum, point) => sum + point.current, 0);
  const previousTotal = points.reduce((sum, point) => sum + point.previous, 0);
  const avgCurrent = points.length ? currentTotal / points.length : 0;
  const avgPrevious = points.length ? previousTotal / points.length : 0;

  const delta = (current: number, previous: number) =>
    previous === 0 ? (current === 0 ? 0 : 100) : ((current - previous) / Math.abs(previous)) * 100;

  return [
    {
      title: "Výdavky v aktuálnom období",
      currentValue: Math.round(currentPeriodCurrent),
      previousValue: Math.round(currentPeriodPrevious),
      deltaPct: delta(currentPeriodCurrent, currentPeriodPrevious)
    },
    {
      title: "Kumulované výdavky tento rok",
      currentValue: Math.round(ytdTotals.current),
      previousValue: Math.round(ytdTotals.previous),
      deltaPct: delta(ytdTotals.current, ytdTotals.previous)
    },
    {
      title: "Priemer na obdobie",
      currentValue: Math.round(avgCurrent),
      previousValue: Math.round(avgPrevious),
      deltaPct: delta(avgCurrent, avgPrevious)
    },
    {
      title: "Neuhradené záväzky",
      currentValue: Math.round(dueWatchlist.overdueTotal + dueWatchlist.upcomingTotal),
      previousValue: Math.round(dueWatchlist.overdueTotal),
      previousLabel: "z toho po splatnosti",
      hideDelta: true,
      deltaPct: 0
    }
  ];
}

/**
 * Donut Štruktúra výdavkov: podiel štítkov na výdavkoch v tomto roku (YTD)
 * plus medziročný trend, počítané rovnakým oknom ako Biznis breakdowny.
 */
export function computeExpenseTagStructure(
  expenses: NormalizedExpense[],
  selectedTags: string[],
  selectedCompanies: string[]
): ExpenseTagSlice[] {
  const tagSet = new Set(selectedTags);
  const companySet = new Set(selectedCompanies);
  const range = getDateRange("month");
  const map = new Map<string, { current: number; previous: number; documentCount: number }>();

  for (const expense of expenses) {
    if (!countsTowardsSpend(expense)) continue;
    if (companySet.size > 0 && !companySet.has(expense.companyName)) continue;

    const expenseDate = new Date(expense.issueDate);
    let yearBucket: "current" | "previous" | null = null;
    if (expenseDate >= range.currentFrom && expenseDate <= range.currentTo) {
      yearBucket = "current";
    } else if (expenseDate >= range.previousFrom && expenseDate <= range.previousTo) {
      yearBucket = "previous";
    }
    if (!yearBucket) continue;

    for (const tag of expense.tags) {
      if (tagSet.size > 0 && !tagSet.has(tag)) continue;
      const bucket = map.get(tag) ?? { current: 0, previous: 0, documentCount: 0 };
      bucket[yearBucket] += expense.totalPriceInclVat;
      if (yearBucket === "current") bucket.documentCount += 1;
      map.set(tag, bucket);
    }
  }

  const total = Array.from(map.values()).reduce((sum, item) => sum + Math.max(item.current, 0), 0);

  return Array.from(map.entries())
    .map(([name, values]) => ({
      name,
      amount: Math.round(values.current),
      previousAmount: Math.round(values.previous),
      share: total === 0 ? 0 : Math.max(values.current, 0) / total,
      documentCount: values.documentCount
    }))
    .sort((a, b) => b.amount - a.amount);
}

export function computeExpenseTagBreakdown(
  expenses: NormalizedExpense[],
  selectedCompanies: string[]
): AggregatedBreakdownPoint[] {
  // Zoznam vo Filtri štítkov musí ukazovať všetky štítky, preto sem filter neposielame.
  return computeExpenseTagStructure(expenses, [], selectedCompanies).map((slice) => ({
    name: slice.name,
    amount: slice.amount,
    previousAmount: slice.previousAmount
  }));
}

export function computeExpenseCompanyBreakdown(
  expenses: NormalizedExpense[],
  selectedTags: string[],
  selectedCompanies: string[] = []
): AggregatedBreakdownPoint[] {
  const filterPass = buildExpenseFilter({ selectedTags, selectedCompanies });
  const map = new Map<string, { current: number; previous: number }>();
  const range = getDateRange("month");

  for (const expense of expenses) {
    if (!countsTowardsSpend(expense) || !filterPass(expense)) continue;

    const expenseDate = new Date(expense.issueDate);
    let yearBucket: "current" | "previous" | null = null;
    if (expenseDate >= range.currentFrom && expenseDate <= range.currentTo) {
      yearBucket = "current";
    } else if (expenseDate >= range.previousFrom && expenseDate <= range.previousTo) {
      yearBucket = "previous";
    }
    if (!yearBucket) continue;

    const bucket = map.get(expense.companyName) ?? { current: 0, previous: 0 };
    bucket[yearBucket] += expense.totalPriceInclVat;
    map.set(expense.companyName, bucket);
  }

  return Array.from(map.entries()).map(([name, values]) => ({
    name,
    amount: Math.round(values.current),
    previousAmount: Math.round(values.previous)
  }));
}

/** Top dodávatelia podľa výdavkov v tomto roku (YTD) vrátane podielu na celku. */
export function computeExpenseVendorBreakdown(
  expenses: NormalizedExpense[],
  selectedTags: string[],
  selectedCompanies: string[],
  limit = 8
): ExpenseVendorPoint[] {
  const filterPass = buildExpenseFilter({ selectedTags, selectedCompanies });
  const range = getDateRange("month");
  const map = new Map<string, { current: number; previous: number; documentCount: number }>();

  for (const expense of expenses) {
    if (!countsTowardsSpend(expense) || !filterPass(expense)) continue;

    const expenseDate = new Date(expense.issueDate);
    let yearBucket: "current" | "previous" | null = null;
    if (expenseDate >= range.currentFrom && expenseDate <= range.currentTo) {
      yearBucket = "current";
    } else if (expenseDate >= range.previousFrom && expenseDate <= range.previousTo) {
      yearBucket = "previous";
    }
    if (!yearBucket) continue;

    const vendor = expense.partnerName ?? "Neznámy dodávateľ";
    const bucket = map.get(vendor) ?? { current: 0, previous: 0, documentCount: 0 };
    bucket[yearBucket] += expense.totalPriceInclVat;
    if (yearBucket === "current") bucket.documentCount += 1;
    map.set(vendor, bucket);
  }

  const total = Array.from(map.values()).reduce((sum, item) => sum + Math.max(item.current, 0), 0);

  return Array.from(map.entries())
    .map(([name, values]) => ({
      name,
      amount: Math.round(values.current),
      previousAmount: Math.round(values.previous),
      share: total === 0 ? 0 : Math.max(values.current, 0) / total,
      documentCount: values.documentCount
    }))
    .filter((vendor) => vendor.amount !== 0 || vendor.previousAmount !== 0)
    .sort((a, b) => b.amount - a.amount)
    .slice(0, limit);
}

/** Stráženie splatností: doklady po splatnosti + neuhradené čakajúce na úhradu. */
export function computeExpenseDueWatchlist(
  expenses: NormalizedExpense[],
  selectedTags: string[],
  selectedCompanies: string[],
  referenceDate: Date = new Date()
): ExpenseDueWatchlist {
  const filterPass = buildExpenseFilter({ selectedTags, selectedCompanies });
  const unpaid = expenses.filter(
    (expense) => countsTowardsSpend(expense) && isExpenseUnpaid(expense) && filterPass(expense)
  );

  const overdue = unpaid
    .filter((expense) => isExpenseOverdue(expense, referenceDate))
    .sort((a, b) => new Date(a.dueDate ?? a.issueDate).getTime() - new Date(b.dueDate ?? b.issueDate).getTime());
  const upcoming = unpaid
    .filter((expense) => !isExpenseOverdue(expense, referenceDate))
    .sort((a, b) => {
      const dueA = a.dueDate ? new Date(a.dueDate).getTime() : Number.MAX_SAFE_INTEGER;
      const dueB = b.dueDate ? new Date(b.dueDate).getTime() : Number.MAX_SAFE_INTEGER;
      return dueA - dueB;
    });

  return {
    overdue,
    overdueTotal: overdue.reduce((sum, expense) => sum + expense.totalPriceInclVat, 0),
    upcoming,
    upcomingTotal: upcoming.reduce((sum, expense) => sum + expense.totalPriceInclVat, 0)
  };
}

/** Posledné výdavky v rovnakom okne ako grafy, zoradené od najnovších. */
export function getFilteredRecentExpenses(
  expenses: NormalizedExpense[],
  options: {
    granularity: Granularity;
    selectedTags: string[];
    selectedCompanies: string[];
    limit?: number;
  }
): NormalizedExpense[] {
  const range = getDateRange(options.granularity);
  const filterPass = buildExpenseFilter(options);
  const limit = options.limit ?? 10;

  return expenses
    .filter((expense) => {
      const expenseDate = new Date(expense.issueDate);
      if (Number.isNaN(expenseDate.getTime())) return false;
      const inWindow = expenseDate >= range.previousFrom && expenseDate <= range.currentTo;
      return inWindow && filterPass(expense);
    })
    .slice()
    .sort((a, b) => {
      const da = new Date(a.issueDate).getTime();
      const db = new Date(b.issueDate).getTime();
      if (db !== da) return db - da;
      const ma = a.lastModifiedTimestamp ? new Date(a.lastModifiedTimestamp).getTime() : 0;
      const mb = b.lastModifiedTimestamp ? new Date(b.lastModifiedTimestamp).getTime() : 0;
      return mb - ma;
    })
    .slice(0, limit);
}
