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
  getExpenseDocumentTypeLabel,
  isExpenseUnpaid
} from "./expenses-live";
import { parseDocumentDate } from "./document-date";
import { getDeltaPct } from "./format";
import { monthKeyFromDate } from "./invoice-cache";
import type { Granularity, KpiCard } from "./mock-data";
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

/**
 * Swipovateľné KPI karty nad grafom Zisku — tie isté tri otázky, aké majú Príjmy
 * a Výdavky, len o zisku: vybrané obdobie, kumulatív za rok a priemer na obdobie.
 *
 * Kumulatív číta zo `points`, nie z vlastného dopočtu, a preto potrebuje vedieť
 * granularitu: pri týždňoch a mesiacoch sú všetky stĺpce z tohto roka (`buildBuckets`
 * ich stavia od 1. januára), takže ich súčet JE rok. Pri rokoch je stĺpcov päť a
 * súčet by bol päťročný — vtedy je „tento rok" jediný stĺpec, ten posledný.
 */
export function computeProfitKpiCards(
  points: ProfitPoint[],
  granularity: Granularity,
  focusedPeriod?: string | null
): KpiCard[] {
  const focused = focusedPeriod
    ? points.find((point) => point.label === focusedPeriod) ?? null
    : null;
  const current = focused ?? (points.length > 0 ? points[points.length - 1] : null);

  const yearPoints = granularity === "year" ? points.slice(-1) : points;
  const ytdCurrent = yearPoints.reduce((sum, point) => sum + point.profit, 0);
  const ytdPrevious = yearPoints.reduce((sum, point) => sum + point.previousProfit, 0);

  const total = points.reduce((sum, point) => sum + point.profit, 0);
  const totalPrevious = points.reduce((sum, point) => sum + point.previousProfit, 0);
  const avgCurrent = points.length ? total / points.length : 0;
  const avgPrevious = points.length ? totalPrevious / points.length : 0;

  /**
   * Percento zo zisku sa nesmie počítať ako pri tržbách. Vlaňajšia STRATA dá
   * záporný menovateľ, takže `(current - previous) / previous` otočí znamienko:
   * zo straty −100 na zisk +50 by vyšlo −150 %, teda „pokles" pri zlepšení.
   * Delenie absolútnou hodnotou znamienko drží a `null` prizná, že pri nulovom
   * vlaňajšku percento neexistuje — na to má `hideDelta`.
   */
  const delta = (currentValue: number, previousValue: number) =>
    previousValue === 0 ? 0 : ((currentValue - previousValue) / Math.abs(previousValue)) * 100;
  const card = (title: string, currentValue: number, previousValue: number): KpiCard => ({
    title,
    currentValue: Math.round(currentValue),
    previousValue: Math.round(previousValue),
    deltaPct: delta(currentValue, previousValue),
    hideDelta: previousValue === 0
  });

  return [
    card(
      focused ? "Zisk vo vybranom období" : "Zisk v aktuálnom období",
      current?.profit ?? 0,
      current?.previousProfit ?? 0
    ),
    card("Kumulatívny zisk tento rok", ytdCurrent, ytdPrevious),
    card("Priemerný zisk na obdobie", avgCurrent, avgPrevious)
  ];
}

export type DueBandKey = "due" | "overdue" | "overdue60";

/**
 * Jeden riadok v zozname dokladov pod kartou. Zámerne to NIE je `NormalizedInvoice`
 * ani `NormalizedExpense`: karta ukazuje obe strany v jednom zozname, takže si ich
 * musí vedieť zjednotiť. Nesie len to, čo sa v riadku naozaj zobrazuje — vďaka tomu
 * sa zoznam nemá ako rozísť so súčtom pásma, z ktorého vznikol.
 */
export type DueDocument = {
  /** Unikátne v rámci jednej strany; `companyId` je v ňom preto, že id sa medzi firmami opakujú. */
  key: string;
  partnerName: string;
  companyName: string;
  documentNumber?: string;
  documentLabel: string;
  dueDate?: string;
  amount: number;
  /** Suma celého dokladu, keď ju filter štítkov zúžil — inak `undefined`. */
  documentTotal?: number;
  band: DueBandKey;
  /** Dní po splatnosti k `referenceDate`; `null` = v splatnosti alebo bez splatnosti. */
  daysOverdue: number | null;
};

export type DueBand = {
  key: DueBandKey;
  label: string;
  total: number;
  count: number;
};

export type DuePosition = {
  total: number;
  count: number;
  bands: DueBand[];
  /**
   * Doklady, z ktorých sú súčty — od najdlhšie po splatnosti po tie v splatnosti.
   * Zoznam v karte z nich číta priamo, nefiltruje si nič sám: keby si sumy skládal
   * druhýkrát, vedel by sa s pásmami rozísť.
   */
  documents: DueDocument[];
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

const BAND_LABELS: Record<DueBandKey, string> = {
  due: "V splatnosti",
  overdue: "Po splatnosti",
  overdue60: "Po splatnosti nad 60 dní"
};

/**
 * Dní po splatnosti k `referenceDate`. `null` znamená „nie je po splatnosti" —
 * teda aj doklad bez splatnosti, ktorý nevieme zaradiť a `bandFor` ho drží v
 * splatnosti. Rovnaké orezanie na polnoc ako `bandFor`, aby zoznam neukazoval
 * jeden deň a pásmo druhý.
 */
function daysOverdueFrom(dueDate: string | undefined, referenceDate: Date): number | null {
  const due = dueDate ? parseDocumentDate(dueDate) : null;
  if (!due) return null;
  const today = startOfLocalDay(referenceDate);
  if (due >= today) return null;
  return Math.round((today.getTime() - due.getTime()) / (24 * 60 * 60 * 1000));
}

/** Vstup pre jeden riadok pásma — spoločný tvar pre faktúru aj výdavok. */
type DueItem = Omit<DueDocument, "band" | "daysOverdue">;

const BAND_ORDER: Record<DueBandKey, number> = { overdue60: 0, overdue: 1, due: 2 };

function toPosition(
  items: DueItem[],
  referenceDate: Date,
  bandKeys: DueBandKey[]
): DuePosition {
  const allowOverdue60 = bandKeys.includes("overdue60");
  const totals = new Map<DueBandKey, { total: number; count: number }>(
    bandKeys.map((key) => [key, { total: 0, count: 0 }])
  );
  const documents: DueDocument[] = [];

  for (const item of items) {
    const key = bandFor(item.dueDate, referenceDate, allowOverdue60);
    const bucket = totals.get(key);
    if (!bucket) continue;
    bucket.total += item.amount;
    bucket.count += 1;
    documents.push({
      ...item,
      band: key,
      daysOverdue: daysOverdueFrom(item.dueDate, referenceDate)
    });
  }

  // Najurgentnejšie navrch: najprv pásmo, v ňom najdlhšie po splatnosti. Doklad bez
  // splatnosti (`daysOverdue === null`) patrí na konec svojho pásma — nevieme o ňom
  // povedať, že je omeškaný, takže ho nemáme prečo tlačiť pred tie, čo omeškané sú.
  documents.sort(
    (a, b) =>
      BAND_ORDER[a.band] - BAND_ORDER[b.band] ||
      (b.daysOverdue ?? -1) - (a.daysOverdue ?? -1) ||
      Math.abs(b.amount) - Math.abs(a.amount)
  );

  // Bez zaokrúhľovania jednotlivých pásiem — `formatCurrency` zaokrúhli až na
  // zobrazenie. Zaokrúhliť každé pásmo zvlášť a potom sčítať by vedelo celok
  // posunúť až o desiatky centov na pásmo.
  const bands = bandKeys.map((key) => ({
    key,
    label: BAND_LABELS[key],
    total: totals.get(key)?.total ?? 0,
    count: totals.get(key)?.count ?? 0
  }));

  return {
    total: bands.reduce((sum, band) => sum + band.total, 0),
    count: bands.reduce((sum, band) => sum + band.count, 0),
    bands,
    documents
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
  // Prázdny výber (firma bez jedinej faktúry vo výbere) naozaj nedlží nič — `.some()`
  // nad prázdnym poľom vráti `false`, čo by tu tvrdilo nedostupný údaj tam, kde
  // v skutočnosti niet čo dlžiť.
  const receivablesAvailable =
    scopedInvoices.length === 0 ||
    scopedInvoices.some((invoice) => invoice.paymentStatus !== "undefined");

  const receivables = toPosition(
    scopedInvoices
      .filter(
        (invoice) =>
          invoice.paymentStatus === "notPaid" || invoice.paymentStatus === "partiallyPaid"
      )
      .map((invoice) => ({
        key: `${invoice.companyId ?? invoice.companyName}-${invoice.id}`,
        partnerName: invoice.partnerName ?? "Neznámy odberateľ",
        companyName: invoice.companyName,
        documentNumber: invoice.invoiceNumber,
        documentLabel:
          invoice.paymentStatus === "partiallyPaid" ? "Faktúra • čiastočne uhradená" : "Faktúra",
        amount: invoice.totalPrice,
        dueDate: invoice.dueDate
      })),
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
      .map((expense) => ({
        key: `${expense.companyId ?? expense.companyName}-${expense.id}`,
        partnerName: expense.partnerName ?? "Neznámy dodávateľ",
        companyName: expense.companyName,
        documentNumber: expense.documentNumber,
        documentLabel: getExpenseDocumentTypeLabel(expense.documentType),
        amount: expense.totalPrice,
        // Filter štítkov vie `totalPrice` zúžiť na časť rozúčtovania. Vtedy zoznam
        // musí povedať, z akého celku tá časť je — inak riadok tvrdí, že doklad je
        // na menšiu sumu, než na akú naozaj je.
        documentTotal: expense.documentTotalPrice,
        dueDate: expense.dueDate
      })),
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
