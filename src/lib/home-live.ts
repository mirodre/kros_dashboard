import {
  computeCompanyBreakdown,
  computeRevenueSeries,
  computeTagBreakdown,
  getInvoiceAnalyticsDate
} from "./dashboard-live";
import {
  computeExpenseCompanyBreakdown,
  computeExpenseSeries,
  computeExpenseTagBreakdown,
  countsTowardsSpend,
  getExpenseAnalyticsDate,
  isExpenseUnpaid
} from "./expenses-live";
import { parseDocumentDate } from "./document-date";
import { getDeltaPct } from "./format";
import { monthKeyFromDate } from "./invoice-cache";
import type { Granularity } from "./mock-data";
import type { AggregatedBreakdownPoint, NormalizedExpense, NormalizedInvoice } from "./kros-types";
import type { PeriodWindow } from "./period-buckets";

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

export type VatMonthEstimate = {
  /** `2026-09` */
  monthKey: string;
  /**
   * Odhad dane. `null` znamená, že ani jeden doklad mesiaca nenesie sumu DPH —
   * teda že sa nedá spočítať, nie že vyšla nula.
   */
  amount: number | null;
  outputVat: number;
  inputVat: number;
};

export type VatEstimate = {
  previousMonth: VatMonthEstimate;
  currentMonth: VatMonthEstimate;
};

type VatInput = {
  invoices: NormalizedInvoice[];
  expenses: NormalizedExpense[];
  selectedCompanies: string[];
  referenceDate?: Date;
};

/**
 * Odhad DPH za kalendárne mesiace — vždy, bez ohľadu na prepínač obdobia.
 * Priznanie sa podáva po mesiacoch a po týždňoch alebo rokoch by to číslo
 * nemalo význam.
 *
 * Doklady sa zaraďujú podľa dátumu dodania (DUZP), rovnako ako v grafoch.
 * Filter štítkov sa nepoužíva: daň sa priraďuje dokladu ako celku a rozpočítať
 * ju na štítky by bol odhad tváriaci sa ako číslo z účtovníctva.
 */
export function computeVatEstimate({
  invoices,
  expenses,
  selectedCompanies,
  referenceDate = new Date()
}: VatInput): VatEstimate {
  const companySet = new Set(selectedCompanies);
  const inCompany = (companyName: string) =>
    companySet.size === 0 || companySet.has(companyName);

  const currentKey = monthKeyFromDate(referenceDate);
  const previousKey = monthKeyFromDate(
    new Date(referenceDate.getFullYear(), referenceDate.getMonth() - 1, 1)
  );

  const totals = new Map<string, { output: number; input: number; hasAny: boolean }>([
    [previousKey, { output: 0, input: 0, hasAny: false }],
    [currentKey, { output: 0, input: 0, hasAny: false }]
  ]);

  const bucketFor = (rawDate: string | undefined, companyName: string) => {
    if (!inCompany(companyName)) return null;
    const date = rawDate ? parseDocumentDate(rawDate) : null;
    if (!date) return null;
    return totals.get(monthKeyFromDate(date)) ?? null;
  };

  for (const invoice of invoices) {
    const bucket = bucketFor(getInvoiceAnalyticsDate(invoice), invoice.companyName);
    if (!bucket || invoice.vatAmount === undefined) continue;
    bucket.output += invoice.vatAmount;
    bucket.hasAny = true;
  }

  for (const expense of expenses) {
    if (!countsTowardsSpend(expense)) continue;
    const bucket = bucketFor(getExpenseAnalyticsDate(expense), expense.companyName);
    if (!bucket || expense.vatAmount === undefined) continue;
    // Bez otáčania znamienka: dobropis nesie zápornú DPH už z KROSu.
    bucket.input += expense.vatAmount;
    bucket.hasAny = true;
  }

  const toEstimate = (monthKey: string): VatMonthEstimate => {
    const bucket = totals.get(monthKey) ?? { output: 0, input: 0, hasAny: false };
    return {
      monthKey,
      outputVat: Math.round(bucket.output * 100) / 100,
      inputVat: Math.round(bucket.input * 100) / 100,
      amount: bucket.hasAny ? Math.round((bucket.output - bucket.input) * 100) / 100 : null
    };
  };

  return { previousMonth: toEstimate(previousKey), currentMonth: toEstimate(currentKey) };
}

/**
 * Jeden riadok rozpisu zisku. Nesie aj obe zložky, lebo samotný zisk sa bez nich
 * nedá prečítať — „−400 €" je iná správa pri štítku bez príjmov než pri štítku,
 * ktorý zarobil 10 000 a minul 10 400.
 */
export type ProfitBreakdownPoint = {
  name: string;
  income: number;
  expense: number;
  profit: number;
  previousProfit: number;
};

/**
 * Spojí príjmovú a výdavkovú stranu podľa názvu. Zjednotenie, nie prienik: štítok
 * alebo firma, ktorá má len jednu stranu, musí byť v zozname vidieť — inak by
 * čisté nákladové stredisko z prehľadu zmizlo.
 */
function mergeBreakdowns(
  incomePoints: AggregatedBreakdownPoint[],
  expensePoints: AggregatedBreakdownPoint[]
): ProfitBreakdownPoint[] {
  const incomeByName = new Map(incomePoints.map((point) => [point.name, point]));
  const expenseByName = new Map(expensePoints.map((point) => [point.name, point]));
  const names = new Set([...incomeByName.keys(), ...expenseByName.keys()]);

  return Array.from(names)
    .map((name) => {
      const income = incomeByName.get(name);
      const expense = expenseByName.get(name);
      const incomeAmount = income?.amount ?? 0;
      const expenseAmount = expense?.amount ?? 0;
      return {
        name,
        income: incomeAmount,
        expense: expenseAmount,
        profit: incomeAmount - expenseAmount,
        previousProfit: (income?.previousAmount ?? 0) - (expense?.previousAmount ?? 0)
      };
    })
    .sort((a, b) => b.profit - a.profit);
}

/**
 * Zisk na štítok.
 *
 * POZOR na asymetriu, ktorú tu nemáme ako odstrániť: faktúra s viacerými štítkami
 * sa započíta CELÁ do každého z nich (tak počíta `computeTagBreakdown`), kým výdavok
 * sa rozdelí podľa rozúčtovania. Súčet riadkov preto nedá celkový zisk a pri
 * viacštítkových faktúrach je nadhodnotený. Sekcia to musí povedať textom —
 * predstierať presnosť, ktorú dáta nemajú, je horšie než ju priznať.
 */
export function computeProfitTagBreakdown({
  invoices,
  expenses,
  selectedCompanies,
  period
}: {
  invoices: NormalizedInvoice[];
  expenses: NormalizedExpense[];
  selectedCompanies: string[];
  period?: PeriodWindow;
}): ProfitBreakdownPoint[] {
  return mergeBreakdowns(
    computeTagBreakdown(invoices, selectedCompanies, period),
    computeExpenseTagBreakdown(expenses, selectedCompanies, period)
  );
}

export function computeProfitCompanyBreakdown({
  invoices,
  expenses,
  selectedTags,
  selectedCompanies,
  period
}: {
  invoices: NormalizedInvoice[];
  expenses: NormalizedExpense[];
  selectedTags: string[];
  selectedCompanies: string[];
  period?: PeriodWindow;
}): ProfitBreakdownPoint[] {
  return mergeBreakdowns(
    computeCompanyBreakdown(invoices, selectedTags, selectedCompanies, period),
    computeExpenseCompanyBreakdown(expenses, selectedTags, selectedCompanies, period)
  );
}
