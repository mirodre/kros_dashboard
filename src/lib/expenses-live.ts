import type { Granularity, KpiCard } from "./mock-data";
import type {
  AggregatedBreakdownPoint,
  AggregatedRevenuePoint,
  ExpensePaymentStatus,
  ExpenseTagAllocation,
  NormalizedExpense
} from "./kros-types";
import {
  buildBuckets,
  classifyPeriod,
  formatPeriodLabel,
  getBucketRange,
  getDateRange,
  toBucketKey,
  type PeriodWindow
} from "./period-buckets";
import { getDocumentDateTime, isValidDocumentDate, parseDocumentDate } from "./document-date";
import {
  EMPTY_TAG_CATEGORY_INDEX,
  UNCATEGORIZED_CATEGORY,
  tagFilterKey,
  type TagCategoryFilters,
  type TagCategoryIndex
} from "./tag-categories";

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
  const due = parseDocumentDate(expense.dueDate);
  if (!due) return false;
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

/** Prvá nenulová hodnota — KROS niektoré cenové skupiny nechá vynulované. */
function firstNonZeroNumber(...values: unknown[]) {
  for (const value of values) {
    const parsed = getNumber(value);
    if (parsed !== undefined && parsed !== 0) return parsed;
  }
  return 0;
}

/**
 * Suma z hlavičky dokladu — legislatívna cena bez DPH. Ak je legislatívna
 * skupina vynulovaná (KROS ju pri časti výdavkov neplní), berieme sumu bez DPH
 * z documentPrices.
 */
function readHeaderTotalPrice(row: Record<string, unknown>) {
  const prices = row.prices;
  if (!prices || typeof prices !== "object") return 0;
  const pricesRow = prices as Record<string, unknown>;

  const readGroup = (group: unknown) =>
    group && typeof group === "object" ? (group as Record<string, unknown>).totalPrice : undefined;

  return firstNonZeroNumber(
    readGroup(pricesRow.legislativePrices),
    readGroup(pricesRow.documentPrices)
  );
}

type JournalLine = { tags: string[]; amount: number };

/** Riadky zaúčtovania z detailu dokladu (/api/expenses/{id}). */
function readJournalLines(row: Record<string, unknown>): JournalLine[] {
  const rawItems = Array.isArray(row.journalItems) ? row.journalItems : [];

  return rawItems
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    .map((item) => ({
      tags: (Array.isArray(item.tags) ? item.tags : [])
        .map(normalizeTag)
        .filter((tag): tag is string => Boolean(tag)),
      amount: firstNonZeroNumber(item.legislativeTotalPrice, item.totalPrice)
    }));
}

/**
 * Rozúčtovanie výdavku na štítky. Riadky zaúčtovania majú prednosť pred
 * hlavičkou: riadok so štítkami si ich ponechá, netagovaný riadok zdedí štítky
 * z hlavičky. Rovnako pri sumách — súčet riadkov má prednosť pred hlavičkou.
 */
function readExpenseAmounts(row: Record<string, unknown>, headerTags: string[]) {
  const headerTotal = readHeaderTotalPrice(row);
  const lines = readJournalLines(row);
  const linesTotal = lines.reduce((sum, line) => sum + line.amount, 0);
  const totalPrice = lines.length > 0 && linesTotal !== 0 ? linesTotal : headerTotal;
  const fallbackTags = headerTags.length > 0 ? headerTags : [UNCATEGORIZED_CATEGORY];

  if (lines.length === 0) {
    const allocations: ExpenseTagAllocation[] = [{ tags: fallbackTags, amount: totalPrice }];
    return { totalPrice, allocations };
  }

  // Riadky bez súm (KROS ich vie nechať vynulované) — sumu hlavičky rozdelíme
  // rovným dielom, nech rozúčtovanie stále sedí na celok dokladu.
  const evenShare = linesTotal === 0 ? totalPrice / lines.length : null;
  const allocations: ExpenseTagAllocation[] = lines.map((line) => ({
    tags: line.tags.length > 0 ? line.tags : fallbackTags,
    amount: evenShare ?? line.amount
  }));

  return { totalPrice, allocations };
}

/** Zjednotenie štítkov naprieč rozúčtovaniami, v poradí prvého výskytu. */
function collectAllocationTags(allocations: ExpenseTagAllocation[]) {
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const allocation of allocations) {
    for (const tag of allocation.tags) {
      const key = tag.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      tags.push(tag);
    }
  }
  return tags.length > 0 ? tags : [UNCATEGORIZED_CATEGORY];
}

export function normalizeExpenses(rawExpenses: unknown[]): NormalizedExpense[] {
  return rawExpenses
    .map((expense): NormalizedExpense | null => {
      const row = expense as Record<string, unknown>;
      const id = pickString(row, ["id", "documentId"]);
      const issueDate = typeof row.issueDate === "string" ? row.issueDate : null;
      if (!id || !issueDate || !isValidDocumentDate(issueDate)) return null;

      const companyName = typeof row.__company === "string" ? row.__company : "Neznáma firma";
      const companyId = typeof row.__companyId === "number" ? row.__companyId : undefined;
      const documentType = getNumber(row.documentType) ?? 0;

      const headerTags = (Array.isArray(row.tags) ? row.tags : [])
        .map(normalizeTag)
        .filter((tag): tag is string => Boolean(tag));
      const amounts = readExpenseAmounts(row, headerTags);

      // Dobropis znižuje výdavky — ak API vráti kladnú sumu, otočíme znamienko.
      const sign = documentType === RECEIVED_CREDIT_NOTE ? -1 : 1;
      const applySign = (value: number) => (sign < 0 ? -Math.abs(value) : value);
      const allocations = amounts.allocations.map((allocation) => ({
        tags: allocation.tags,
        amount: applySign(allocation.amount)
      }));

      const deliveryDateRaw = pickString(row, ["deliveryDate"]);
      const deliveryDate = deliveryDateRaw && isValidDocumentDate(deliveryDateRaw) ? deliveryDateRaw : undefined;

      const paymentStatusCode = getNumber(row.paymentStatus);

      return {
        id,
        companyId,
        companyName,
        documentNumber: pickString(row, ["documentNumber"]),
        documentType,
        partnerName: readPartnerName(row),
        issueDate,
        deliveryDate,
        dueDate: pickString(row, ["dueDate"]),
        receivedDate: pickString(row, ["receivedDate"]),
        lastModifiedTimestamp: pickString(row, ["lastModifiedTimestamp"]),
        totalPrice: applySign(amounts.totalPrice),
        paymentStatus:
          paymentStatusCode !== undefined
            ? EXPENSE_PAYMENT_STATUS_BY_CODE[paymentStatusCode] ?? "undefined"
            : "undefined",
        paymentType: pickString(row, ["paymentType"]),
        hasAttachments: row.hasAttachments === true,
        tags: collectAllocationTags(allocations),
        allocations
      } satisfies NormalizedExpense;
    })
    .filter((expense): expense is NormalizedExpense => Boolean(expense));
}

/** Jedna podmienka na riadok rozúčtovania — povolené štítky v rámci jednej kategórie. */
type AllocationConstraint = { category: string; tags: Set<string> };

function lowerTag(tag: string) {
  return tag.trim().toLowerCase();
}

/**
 * Podmienky pre riadky rozúčtovania: každá kategória s aktívnym filtrom a každá
 * kategória s rozkliknutým štítkom je vlastná podmienka. V rámci kategórie stačí
 * jeden zo štítkov (OR), kategórie sa spájajú cez AND — rovnako ako pri dokladoch.
 */
function buildAllocationConstraints(
  filters: TagCategoryFilters,
  focusedTags: string[],
  index: TagCategoryIndex
): AllocationConstraint[] {
  const constraints: AllocationConstraint[] = [];

  for (const [category, tags] of Object.entries(filters)) {
    if (tags.length === 0) continue;
    constraints.push({ category, tags: new Set(tags.map(lowerTag)) });
  }

  // Focus je samostatná podmienka nad filtrom — rozkliknutý štítok teda zúži riadky
  // aj vtedy, keď je filter kategórie širší.
  const focusByCategory = new Map<string, string[]>();
  for (const tag of focusedTags) {
    const category = tagFilterKey(index, tag);
    focusByCategory.set(category, [...(focusByCategory.get(category) ?? []), tag]);
  }
  for (const [category, tags] of focusByCategory) {
    constraints.push({ category, tags: new Set(tags.map(lowerTag)) });
  }

  return constraints;
}

/**
 * Riadok prejde podmienkou, keď nesie niektorý z jej štítkov — alebo keď v tejto
 * kategórii nemá štítok žiadny. Nerozlíšený riadok totiž patrí celému dokladu
 * (KROS ho v tejto dimenzii nerozúčtoval), takže ho filter kategórie nesmie zahodiť.
 */
function allocationPassesConstraint(
  allocation: ExpenseTagAllocation,
  constraint: AllocationConstraint,
  index: TagCategoryIndex
) {
  let touchesCategory = false;

  for (const tag of allocation.tags) {
    if (constraint.tags.has(lowerTag(tag))) return true;
    if (tagFilterKey(index, tag) === constraint.category) touchesCategory = true;
  }

  return !touchesCategory;
}

/**
 * Zúži sumy dokladov na riadky rozúčtovania (journalItems), ktoré prejdú aktívnym
 * filtrom štítkov a rozkliknutými štítkami. Graf, KPI, dodávatelia aj zoznamy dokladov
 * tak ukazujú rovnaké číslo — len tú časť dokladu, ktorá patrí do výberu. Pôvodná suma
 * celého dokladu ostáva v `documentTotalPrice`, nech sa dá v zozname ukázať kontext.
 * Bez aktívneho filtra aj bez focusu ostávajú doklady nezmenené.
 */
export function scopeExpenseAmountsToTagFilters(
  expenses: NormalizedExpense[],
  filters: TagCategoryFilters,
  focusedTags: string[],
  index: TagCategoryIndex = EMPTY_TAG_CATEGORY_INDEX
): NormalizedExpense[] {
  const constraints = buildAllocationConstraints(filters, focusedTags, index);
  if (constraints.length === 0) return expenses;

  return expenses.map((expense) => {
    const matching = expense.allocations.filter((allocation) =>
      constraints.every((constraint) => allocationPassesConstraint(allocation, constraint, index))
    );
    // Žiadny riadok nesedí (doklad prešiel len zjednotením štítkov naprieč riadkami)
    // alebo sedia všetky — v oboch prípadoch niet čo zužovať.
    if (matching.length === 0 || matching.length === expense.allocations.length) return expense;

    return {
      ...expense,
      totalPrice: matching.reduce((sum, allocation) => sum + allocation.amount, 0),
      documentTotalPrice: expense.documentTotalPrice ?? expense.totalPrice,
      tags: collectAllocationTags(matching),
      allocations: matching
    };
  });
}

type FilterInput = {
  selectedTags: string[];
  selectedCompanies: string[];
};

/**
 * Dátum, podľa ktorého analytiky (graf, KPI, donut, breakdowny) zaraďujú doklad
 * do obdobia — dátum dodania (DUZP); doklady bez neho padajú na dátum vystavenia.
 * Zoznamy Posledné výdavky a splatnosti zámerne ostávajú na vystavení/splatnosti.
 */
export function getExpenseAnalyticsDate(expense: NormalizedExpense) {
  return expense.deliveryDate ?? expense.issueDate;
}

function buildExpenseFilter({ selectedTags, selectedCompanies }: FilterInput) {
  const tagSet = new Set(selectedTags);
  const companySet = new Set(selectedCompanies);
  return (expense: NormalizedExpense) => {
    const companyPass = companySet.size === 0 || companySet.has(expense.companyName);
    const tagPass = tagSet.size === 0 || expense.tags.some((tag) => tagSet.has(tag));
    return companyPass && tagPass;
  };
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
    const expenseDate = parseDocumentDate(getExpenseAnalyticsDate(expense));
    if (!expenseDate) return false;
    const inWindow = expenseDate >= range.previousFrom && expenseDate <= range.currentTo;
    return inWindow && filterPass(expense);
  });

  for (const expense of filtered) {
    const date = parseDocumentDate(getExpenseAnalyticsDate(expense));
    if (!date) continue;

    if (granularity === "year") {
      const currentBucket = bucketMap.get(`y-${date.getFullYear()}`);
      const previousBucket = bucketMap.get(`y-${date.getFullYear() + 1}`);
      if (currentBucket) currentBucket.current += expense.totalPrice;
      if (previousBucket) previousBucket.previous += expense.totalPrice;
      continue;
    }

    if (date.getFullYear() === currentYear && date <= range.currentTo) {
      const bucket = bucketMap.get(toBucketKey(date, granularity));
      if (bucket) bucket.current += expense.totalPrice;
    }
    if (date.getFullYear() === currentYear - 1 && date <= range.previousTo) {
      const bucket = bucketMap.get(toBucketKey(date, granularity));
      if (bucket) bucket.previous += expense.totalPrice;
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
        const expenseDate = parseDocumentDate(getExpenseAnalyticsDate(expense));
        if (!expenseDate) return false;
        return expenseDate >= from && expenseDate <= to && filterPass(expense);
      })
      .sort(
        (a, b) =>
          (getDocumentDateTime(getExpenseAnalyticsDate(b)) ?? 0) -
          (getDocumentDateTime(getExpenseAnalyticsDate(a)) ?? 0)
      );

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

    const expenseDate = parseDocumentDate(getExpenseAnalyticsDate(expense));
    if (!expenseDate) continue;
    if (expenseDate >= range.currentFrom && expenseDate <= range.currentTo) {
      current += expense.totalPrice;
    } else if (expenseDate >= range.previousFrom && expenseDate <= range.previousTo) {
      previous += expense.totalPrice;
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
  selectedCompanies: string[],
  period?: PeriodWindow
): ExpenseTagSlice[] {
  const tagSet = new Set(selectedTags);
  const companySet = new Set(selectedCompanies);
  const range = period ?? getDateRange("month");
  const map = new Map<string, { current: number; previous: number; documentCount: number }>();

  for (const expense of expenses) {
    if (!countsTowardsSpend(expense)) continue;
    if (companySet.size > 0 && !companySet.has(expense.companyName)) continue;

    const expenseDate = parseDocumentDate(getExpenseAnalyticsDate(expense));
    if (!expenseDate) continue;
    const yearBucket = classifyPeriod(expenseDate, range);
    if (!yearBucket) continue;

    // Sumy berieme z rozúčtovania — na štítok padá len jeho časť dokladu,
    // nie celá suma. Doklad sa do počtu dokladov započíta raz za štítok.
    const amountByTag = new Map<string, number>();
    for (const allocation of expense.allocations) {
      for (const tag of allocation.tags) {
        if (tagSet.size > 0 && !tagSet.has(tag)) continue;
        amountByTag.set(tag, (amountByTag.get(tag) ?? 0) + allocation.amount);
      }
    }

    for (const [tag, amount] of amountByTag) {
      const bucket = map.get(tag) ?? { current: 0, previous: 0, documentCount: 0 };
      bucket[yearBucket] += amount;
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

/**
 * Podiely prepočítané na súčet výsekov, ktoré v grafe naozaj sú. `computeExpenseTagStructure`
 * počíta `share` z celku pred odfiltrovaním štítkov mimo Filtra štítkov, takže po ňom by
 * podiely nedávali 100 %. Záporné sumy (dobropisy) do celku nejdú.
 */
export function withNormalizedTagShares(slices: ExpenseTagSlice[]): ExpenseTagSlice[] {
  const total = slices.reduce((sum, slice) => sum + Math.max(slice.amount, 0), 0);

  return slices.map((slice) => ({
    ...slice,
    share: total === 0 ? 0 : Math.max(slice.amount, 0) / total
  }));
}

export function computeExpenseTagBreakdown(
  expenses: NormalizedExpense[],
  selectedCompanies: string[],
  period?: PeriodWindow
): AggregatedBreakdownPoint[] {
  // Zoznam vo Filtri štítkov musí ukazovať všetky štítky, preto sem filter neposielame.
  return computeExpenseTagStructure(expenses, [], selectedCompanies, period).map((slice) => ({
    name: slice.name,
    amount: slice.amount,
    previousAmount: slice.previousAmount
  }));
}

export function computeExpenseCompanyBreakdown(
  expenses: NormalizedExpense[],
  selectedTags: string[],
  selectedCompanies: string[] = [],
  period?: PeriodWindow
): AggregatedBreakdownPoint[] {
  const filterPass = buildExpenseFilter({ selectedTags, selectedCompanies });
  const map = new Map<string, { current: number; previous: number }>();
  const range = period ?? getDateRange("month");

  for (const expense of expenses) {
    if (!countsTowardsSpend(expense) || !filterPass(expense)) continue;

    const expenseDate = parseDocumentDate(getExpenseAnalyticsDate(expense));
    if (!expenseDate) continue;
    const yearBucket = classifyPeriod(expenseDate, range);
    if (!yearBucket) continue;

    const bucket = map.get(expense.companyName) ?? { current: 0, previous: 0 };
    bucket[yearBucket] += expense.totalPrice;
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
  limit = 8,
  period?: PeriodWindow
): ExpenseVendorPoint[] {
  const filterPass = buildExpenseFilter({ selectedTags, selectedCompanies });
  const range = period ?? getDateRange("month");
  const map = new Map<string, { current: number; previous: number; documentCount: number }>();

  for (const expense of expenses) {
    if (!countsTowardsSpend(expense) || !filterPass(expense)) continue;

    const expenseDate = parseDocumentDate(getExpenseAnalyticsDate(expense));
    if (!expenseDate) continue;
    const yearBucket = classifyPeriod(expenseDate, range);
    if (!yearBucket) continue;

    const vendor = expense.partnerName ?? "Neznámy dodávateľ";
    const bucket = map.get(vendor) ?? { current: 0, previous: 0, documentCount: 0 };
    bucket[yearBucket] += expense.totalPrice;
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
    .sort(
      (a, b) =>
        (getDocumentDateTime(a.dueDate ?? a.issueDate) ?? 0) -
        (getDocumentDateTime(b.dueDate ?? b.issueDate) ?? 0)
    );
  const upcoming = unpaid
    .filter((expense) => !isExpenseOverdue(expense, referenceDate))
    .sort((a, b) => {
      const dueA = getDocumentDateTime(a.dueDate) ?? Number.MAX_SAFE_INTEGER;
      const dueB = getDocumentDateTime(b.dueDate) ?? Number.MAX_SAFE_INTEGER;
      return dueA - dueB;
    });

  return {
    overdue,
    overdueTotal: overdue.reduce((sum, expense) => sum + expense.totalPrice, 0),
    upcoming,
    upcomingTotal: upcoming.reduce((sum, expense) => sum + expense.totalPrice, 0)
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
    /** Focus stĺpca grafu: zoznam sa zúži na doklady z toho obdobia (nie aj vlaňajšie). */
    period?: PeriodWindow;
  }
): NormalizedExpense[] {
  const range = getDateRange(options.granularity);
  const filterPass = buildExpenseFilter(options);
  const limit = options.limit ?? 10;

  return expenses
    .filter((expense) => {
      const expenseDate = parseDocumentDate(expense.issueDate);
      if (!expenseDate) return false;
      const inWindow = expenseDate >= range.previousFrom && expenseDate <= range.currentTo;
      // Obdobie sa meria dátumom, ktorým doklad padá do stĺpca grafu (DUZP), aby v zozname
      // boli tie isté doklady, aké sa v stĺpci sčítali — zoradenie ostáva podľa vystavenia.
      const analyticsDate = parseDocumentDate(getExpenseAnalyticsDate(expense));
      const periodPass =
        !options.period ||
        Boolean(
          analyticsDate &&
            analyticsDate >= options.period.currentFrom &&
            analyticsDate <= options.period.currentTo
        );
      return inWindow && periodPass && filterPass(expense);
    })
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
