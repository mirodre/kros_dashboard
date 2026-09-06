import { computeRevenueSeries } from "./dashboard-live";
import { computeExpenseSeries } from "./expenses-live";
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
