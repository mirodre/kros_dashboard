import { computeRevenueSeries } from "./dashboard-live";
import { computeExpenseSeries, countsTowardsSpend, isExpenseUnpaid } from "./expenses-live";
import { parseDocumentDate } from "./document-date";
import { getDeltaPct } from "./format";
import type { Granularity } from "./mock-data";
import type { NormalizedExpense, NormalizedInvoice } from "./kros-types";

/**
 * Jeden stĺpec grafu Domova. Na rozdiel od modulov nenesie „tento rok vs. vlani",
 * ale príjmy a výdavky toho istého obdobia — porovnanie s vlaňajškom sa presunulo
 * do KPI a do tooltipu.
 */
export type ProfitPoint = {
  label: string;
  income: number;
  expense: number;
  profit: number;
  previousIncome: number;
  previousExpense: number;
  previousProfit: number;
};

type ProfitSeriesInput = {
  invoices: NormalizedInvoice[];
  expenses: NormalizedExpense[];
  granularity: Granularity;
  selectedTags: string[];
  selectedCompanies: string[];
};

/**
 * Príjmy aj výdavky bucketujú tie isté `buildBuckets`, takže sa dajú spojiť podľa
 * názvu stĺpca. Spájame podľa názvu, nie podľa indexu — index by tichým rozdielom
 * v jednej z dvoch sérií posunul celý graf o obdobie.
 */
export function computeProfitSeries({
  invoices,
  expenses,
  granularity,
  selectedTags,
  selectedCompanies
}: ProfitSeriesInput): ProfitPoint[] {
  const incomePoints = computeRevenueSeries({
    invoices,
    granularity,
    selectedTags,
    selectedCompanies
  });
  const expensePoints = computeExpenseSeries({
    expenses,
    granularity,
    selectedTags,
    selectedCompanies
  });
  const expenseByLabel = new Map(expensePoints.map((point) => [point.label, point]));

  return incomePoints.map((point) => {
    const spend = expenseByLabel.get(point.label);
    const expense = spend?.current ?? 0;
    const previousExpense = spend?.previous ?? 0;
    return {
      label: point.label,
      income: point.current,
      expense,
      profit: point.current - expense,
      previousIncome: point.previous,
      previousExpense,
      previousProfit: point.previous - previousExpense
    };
  });
}

export type ProfitKpiValue = {
  current: number;
  previous: number;
  /** `null` = vlani bola nula, percento by nedávalo zmysel. */
  deltaPct: number | null;
};

export type ProfitKpis = {
  /** Stĺpec, z ktorého sú čísla; `null` pri prázdnej sérii. */
  periodLabel: string | null;
  profit: ProfitKpiValue;
  income: ProfitKpiValue;
  expense: ProfitKpiValue;
};

function kpiValue(current: number, previous: number): ProfitKpiValue {
  return { current, previous, deltaPct: getDeltaPct(current, previous) };
}

/**
 * Hlavné čísla nad grafom. Klik do grafu ich prepne na vybraný stĺpec — inak by
 * číslo ukazovalo posledné obdobie, kým graf aj sekcie pod ním to focusnuté.
 */
export function computeProfitKpis(
  points: ProfitPoint[],
  focusedPeriod?: string | null
): ProfitKpis {
  const focused = focusedPeriod
    ? points.find((point) => point.label === focusedPeriod) ?? null
    : null;
  const point = focused ?? (points.length > 0 ? points[points.length - 1] : null);

  if (!point) {
    const empty = kpiValue(0, 0);
    return { periodLabel: null, profit: empty, income: empty, expense: empty };
  }

  return {
    periodLabel: point.label,
    profit: kpiValue(point.profit, point.previousProfit),
    income: kpiValue(point.income, point.previousIncome),
    expense: kpiValue(point.expense, point.previousExpense)
  };
}

const OVERDUE_60_DAYS_MS = 60 * 24 * 60 * 60 * 1000;

export type DueBand = {
  key: "due" | "overdue" | "overdue60";
  label: string;
  total: number;
  count: number;
};

export type DuePosition = {
  total: number;
  count: number;
  bands: DueBand[];
};

export type DuePositions = {
  /** Dostať mínus zaplatiť — „čiastka po vyrovnaní". */
  net: number;
  receivables: DuePosition;
  payables: DuePosition;
  /**
   * `false` znamená, že žiadna faktúra nenesie stav úhrady — teda že KROS to pole
   * nevracia. Sekcia potom ukáže „Údaj z KROS nedostupný", nie nulu: neuhradené
   * pohľadávky a chýbajúci údaj sú dve rôzne správy.
   */
  receivablesAvailable: boolean;
};

/**
 * `parseDocumentDate` vracia splatnosť ako lokálnu polnoc. `referenceDate` ale
 * môže niesť aj čas (napr. „teraz"), takže bez orezania na polnoc by sa deň
 * splatnosti počítal proti neskoršiemu času toho istého (alebo susedného) dňa
 * a hranice 60 dní by sa posúvali o hodiny — presne 60 dní od splatnosti by
 * tak vedelo dopadnúť ako 60+ len preto, že „teraz" je popoludní.
 */
function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function bandFor(dueDate: string | undefined, referenceDate: Date, allowOverdue60: boolean) {
  const due = dueDate ? parseDocumentDate(dueDate) : null;
  const today = startOfLocalDay(referenceDate);
  // Doklad bez splatnosti nevieme označiť za omeškaný — do celku patrí, do
  // omeškania nie. Radšej ho podhodnotíme, než by sme niekoho obvinili z dlhu.
  if (!due || due >= today) return "due" as const;
  if (allowOverdue60 && today.getTime() - due.getTime() > OVERDUE_60_DAYS_MS) {
    return "overdue60" as const;
  }
  return "overdue" as const;
}

const BAND_LABELS: Record<DueBand["key"], string> = {
  due: "V splatnosti",
  overdue: "Po splatnosti",
  overdue60: "Po splatnosti nad 60 dní"
};

function toPosition(
  items: { amount: number; dueDate?: string }[],
  referenceDate: Date,
  bandKeys: DueBand["key"][]
): DuePosition {
  const allowOverdue60 = bandKeys.includes("overdue60");
  const totals = new Map<DueBand["key"], { total: number; count: number }>(
    bandKeys.map((key) => [key, { total: 0, count: 0 }])
  );

  for (const item of items) {
    const key = bandFor(item.dueDate, referenceDate, allowOverdue60);
    const bucket = totals.get(key);
    if (!bucket) continue;
    bucket.total += item.amount;
    bucket.count += 1;
  }

  const bands = bandKeys.map((key) => ({
    key,
    label: BAND_LABELS[key],
    total: Math.round(totals.get(key)?.total ?? 0),
    count: totals.get(key)?.count ?? 0
  }));

  return {
    total: bands.reduce((sum, band) => sum + band.total, 0),
    count: bands.reduce((sum, band) => sum + band.count, 0),
    bands
  };
}

type DuePositionsInput = {
  invoices: NormalizedInvoice[];
  expenses: NormalizedExpense[];
  selectedTags: string[];
  selectedCompanies: string[];
  referenceDate?: Date;
};

/**
 * Stav k dnešku, nie tok za obdobie: prepínač obdobia ani focus stĺpca sem
 * nezasahujú. Dlžoba nezaniká tým, že vznikla vlani.
 */
export function computeDuePositions({
  invoices,
  expenses,
  selectedTags,
  selectedCompanies,
  referenceDate = new Date()
}: DuePositionsInput): DuePositions {
  const tagSet = new Set(selectedTags);
  const companySet = new Set(selectedCompanies);
  const passes = (companyName: string, tags: string[]) =>
    (companySet.size === 0 || companySet.has(companyName)) &&
    (tagSet.size === 0 || tags.some((tag) => tagSet.has(tag)));

  const scopedInvoices = invoices.filter((invoice) =>
    passes(invoice.companyName, invoice.tags)
  );
  const receivablesAvailable = scopedInvoices.some(
    (invoice) => invoice.paymentStatus !== "undefined"
  );

  const receivables = toPosition(
    scopedInvoices
      .filter(
        (invoice) =>
          invoice.paymentStatus === "notPaid" || invoice.paymentStatus === "partiallyPaid"
      )
      .map((invoice) => ({ amount: invoice.totalPrice, dueDate: invoice.dueDate })),
    referenceDate,
    ["due", "overdue", "overdue60"]
  );

  const payables = toPosition(
    expenses
      .filter(
        (expense) =>
          countsTowardsSpend(expense) &&
          isExpenseUnpaid(expense) &&
          passes(expense.companyName, expense.tags)
      )
      .map((expense) => ({ amount: expense.totalPrice, dueDate: expense.dueDate })),
    referenceDate,
    ["due", "overdue"]
  );

  return {
    net: receivables.total - payables.total,
    receivables,
    payables,
    receivablesAvailable
  };
}
