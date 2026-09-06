import { describe, expect, it } from "vitest";
import {
  computeDuePositions,
  computeProfitKpis,
  computeProfitSeries,
  computeVatEstimate,
  type ProfitPoint
} from "./home-live";
import type { NormalizedExpense, NormalizedInvoice } from "./kros-types";

const NOW = new Date();
const CURRENT_YEAR = NOW.getFullYear();

/** Prvý deň mesiaca — vždy dnes alebo v minulosti, takže nespadne za orez „do dnes". */
function firstDayOf(year: number, month: number) {
  return `${year}-${String(month + 1).padStart(2, "0")}-01`;
}

function invoice(date: string, totalPrice: number): NormalizedInvoice {
  return {
    id: `inv-${date}-${totalPrice}`,
    companyName: "Kros Trade",
    issueDate: date,
    deliveryDate: date,
    totalPrice,
    paymentStatus: "fullyPaid",
    tags: ["Retail"]
  };
}

function expense(date: string, totalPrice: number): NormalizedExpense {
  return {
    id: `exp-${date}-${totalPrice}`,
    companyName: "Kros Trade",
    documentType: 10,
    issueDate: date,
    deliveryDate: date,
    totalPrice,
    paymentStatus: "fullyPaid",
    hasAttachments: false,
    tags: ["Retail"],
    allocations: [{ tags: ["Retail"], amount: totalPrice }]
  };
}

function seriesInput(invoices: NormalizedInvoice[], expenses: NormalizedExpense[]) {
  return {
    invoices,
    expenses,
    granularity: "month" as const,
    selectedTags: [],
    selectedCompanies: []
  };
}

describe("computeProfitSeries", () => {
  it("zisk je príjmy mínus výdavky v tom istom stĺpci", () => {
    const date = firstDayOf(CURRENT_YEAR, 0);
    const points = computeProfitSeries(seriesInput([invoice(date, 1000)], [expense(date, 400)]));
    const january = points[0];
    expect(january.income).toBe(1000);
    expect(january.expense).toBe(400);
    expect(january.profit).toBe(600);
  });

  it("výdavky nad príjmami dajú záporný zisk — graf ho musí vedieť nakresliť", () => {
    const date = firstDayOf(CURRENT_YEAR, 0);
    const points = computeProfitSeries(seriesInput([invoice(date, 300)], [expense(date, 900)]));
    expect(points[0].profit).toBe(-600);
  });

  it("počíta aj vlaňajší zisk pre porovnanie", () => {
    const thisYear = firstDayOf(CURRENT_YEAR, 0);
    const lastYear = firstDayOf(CURRENT_YEAR - 1, 0);
    const points = computeProfitSeries(
      seriesInput(
        [invoice(thisYear, 1000), invoice(lastYear, 800)],
        [expense(thisYear, 400), expense(lastYear, 500)]
      )
    );
    expect(points[0].profit).toBe(600);
    expect(points[0].previousProfit).toBe(300);
  });

  it("stĺpce sú tie isté a v tom istom poradí ako v moduloch", () => {
    const points = computeProfitSeries(seriesInput([], []));
    expect(points.length).toBeGreaterThan(0);
    expect(points.every((point) => point.profit === 0)).toBe(true);
  });
});

describe("computeProfitKpis", () => {
  function point(label: string, income: number, expenseValue: number, prevProfit = 0): ProfitPoint {
    return {
      label,
      income,
      expense: expenseValue,
      profit: income - expenseValue,
      previousIncome: 0,
      previousExpense: 0,
      previousProfit: prevProfit
    };
  }

  it("bez focusu berie posledný stĺpec", () => {
    const kpis = computeProfitKpis([point("jan", 100, 40), point("feb", 200, 50)]);
    expect(kpis.periodLabel).toBe("feb");
    expect(kpis.profit.current).toBe(150);
  });

  it("focus stĺpca prepne hlavné číslo na ten stĺpec", () => {
    const kpis = computeProfitKpis([point("jan", 100, 40), point("feb", 200, 50)], "jan");
    expect(kpis.periodLabel).toBe("jan");
    expect(kpis.profit.current).toBe(60);
  });

  it("focus na neexistujúci stĺpec padne späť na posledný, nie na nulu", () => {
    const kpis = computeProfitKpis([point("jan", 100, 40)], "december");
    expect(kpis.periodLabel).toBe("jan");
    expect(kpis.profit.current).toBe(60);
  });

  it("bez vlaňajška je delta null, nie 100 % — nedá sa deliť nulou", () => {
    const kpis = computeProfitKpis([point("jan", 100, 40, 0)]);
    expect(kpis.profit.deltaPct).toBeNull();
  });

  it("prázdna séria dá nuly a nespadne", () => {
    const kpis = computeProfitKpis([]);
    expect(kpis.periodLabel).toBeNull();
    expect(kpis.profit.current).toBe(0);
  });
});

const REFERENCE = new Date("2026-09-06T12:00:00Z");

function unpaidInvoice(dueDate: string, totalPrice: number): NormalizedInvoice {
  return {
    id: `inv-${dueDate}-${totalPrice}`,
    companyName: "Kros Trade",
    issueDate: "2026-01-01",
    dueDate,
    totalPrice,
    paymentStatus: "notPaid",
    tags: ["Retail"]
  };
}

function unpaidExpense(dueDate: string, totalPrice: number): NormalizedExpense {
  return {
    id: `exp-${dueDate}-${totalPrice}`,
    companyName: "Kros Trade",
    documentType: 10,
    issueDate: "2026-01-01",
    dueDate,
    totalPrice,
    paymentStatus: "notPaid",
    hasAttachments: false,
    tags: ["Retail"],
    allocations: [{ tags: ["Retail"], amount: totalPrice }]
  };
}

function positions(invoices: NormalizedInvoice[], expenses: NormalizedExpense[]) {
  return computeDuePositions({
    invoices,
    expenses,
    selectedTags: [],
    selectedCompanies: [],
    referenceDate: REFERENCE
  });
}

describe("computeDuePositions", () => {
  it("uhradené doklady sa nerátajú", () => {
    const paid = { ...unpaidInvoice("2026-09-30", 500), paymentStatus: "fullyPaid" as const };
    expect(positions([paid], []).receivables.total).toBe(0);
  });

  it("faktúra pred splatnosťou ide do pásma 'v splatnosti'", () => {
    const result = positions([unpaidInvoice("2026-09-30", 500)], []);
    expect(result.receivables.total).toBe(500);
    expect(result.receivables.bands.find((band) => band.key === "due")?.total).toBe(500);
  });

  it("faktúra 10 dní po splatnosti ide do pásma 'po splatnosti', nie do 60+", () => {
    const result = positions([unpaidInvoice("2026-08-27", 500)], []);
    expect(result.receivables.bands.find((band) => band.key === "overdue")?.total).toBe(500);
    expect(result.receivables.bands.find((band) => band.key === "overdue60")?.total).toBe(0);
  });

  it("faktúra viac než 60 dní po splatnosti ide do vlastného pásma", () => {
    const result = positions([unpaidInvoice("2026-06-01", 500)], []);
    expect(result.receivables.bands.find((band) => band.key === "overdue60")?.total).toBe(500);
    expect(result.receivables.bands.find((band) => band.key === "overdue")?.total).toBe(0);
  });

  it("presne 60 dní ešte nie je 60+ — hranica sa nesmie prekrývať", () => {
    const result = positions([unpaidInvoice("2026-07-08", 500)], []);
    expect(result.receivables.bands.find((band) => band.key === "overdue60")?.total).toBe(0);
  });

  it("faktúra bez splatnosti sa ráta do celku, ale ako 'v splatnosti'", () => {
    const noDue = { ...unpaidInvoice("2026-09-30", 500), dueDate: undefined };
    const result = positions([noDue], []);
    expect(result.receivables.total).toBe(500);
    expect(result.receivables.bands.find((band) => band.key === "due")?.total).toBe(500);
  });

  it("záväzky majú len dve pásma — 60+ je otázka pre pohľadávky, nie pre vlastné dlhy", () => {
    const result = positions([], [unpaidExpense("2026-06-01", 300)]);
    expect(result.payables.bands.map((band) => band.key)).toEqual(["due", "overdue"]);
    expect(result.payables.total).toBe(300);
  });

  it("čistá pozícia je dostať mínus zaplatiť", () => {
    const result = positions([unpaidInvoice("2026-09-30", 900)], [unpaidExpense("2026-09-30", 400)]);
    expect(result.net).toBe(500);
  });

  it("faktúry bez stavu úhrady znamenajú nedostupné pohľadávky, nie nulové", () => {
    const unknown = { ...unpaidInvoice("2026-09-30", 500), paymentStatus: "undefined" as const };
    const result = positions([unknown], []);
    expect(result.receivablesAvailable).toBe(false);
  });

  it("aspoň jedna faktúra so známym stavom stačí na to, aby sa pohľadávky ukázali", () => {
    const unknown = { ...unpaidInvoice("2026-09-30", 500), paymentStatus: "undefined" as const };
    const result = positions([unknown, unpaidInvoice("2026-09-30", 200)], []);
    expect(result.receivablesAvailable).toBe(true);
    expect(result.receivables.total).toBe(200);
  });
});

/** 6. september 2026 — „tento mesiac" je 2026-09, „minulý" 2026-08. */
const VAT_REFERENCE = new Date(2026, 8, 6);

function vatInvoice(deliveryDate: string, vatAmount: number | undefined): NormalizedInvoice {
  return {
    id: `inv-vat-${deliveryDate}-${vatAmount}`,
    companyName: "Kros Trade",
    issueDate: deliveryDate,
    deliveryDate,
    totalPrice: 1000,
    paymentStatus: "fullyPaid",
    vatAmount,
    tags: ["Retail"]
  };
}

function vatExpense(
  deliveryDate: string,
  vatAmount: number | undefined,
  documentType = 10
): NormalizedExpense {
  return {
    id: `exp-vat-${deliveryDate}-${vatAmount}-${documentType}`,
    companyName: "Kros Trade",
    documentType,
    issueDate: deliveryDate,
    deliveryDate,
    totalPrice: documentType === 17 ? -500 : 500,
    paymentStatus: "fullyPaid",
    hasAttachments: false,
    vatAmount,
    tags: ["Retail"],
    allocations: [{ tags: ["Retail"], amount: documentType === 17 ? -500 : 500 }]
  };
}

function vat(invoices: NormalizedInvoice[], expenses: NormalizedExpense[]) {
  return computeVatEstimate({
    invoices,
    expenses,
    selectedCompanies: [],
    referenceDate: VAT_REFERENCE
  });
}

describe("computeVatEstimate", () => {
  it("odhad je DPH na výstupe mínus DPH na vstupe", () => {
    const result = vat([vatInvoice("2026-09-02", 200)], [vatExpense("2026-09-03", 60)]);
    expect(result.currentMonth.outputVat).toBe(200);
    expect(result.currentMonth.inputVat).toBe(60);
    expect(result.currentMonth.amount).toBe(140);
  });

  it("triedi podľa dátumu dodania, nie vystavenia — DPH sa podáva podľa DUZP", () => {
    const result = vat([vatInvoice("2026-08-31", 100), vatInvoice("2026-09-01", 300)], []);
    expect(result.previousMonth.outputVat).toBe(100);
    expect(result.currentMonth.outputVat).toBe(300);
  });

  it("doklady mimo oboch mesiacov sa nerátajú", () => {
    const result = vat([vatInvoice("2026-07-15", 999)], []);
    expect(result.currentMonth.outputVat).toBe(0);
    expect(result.previousMonth.outputVat).toBe(0);
  });

  it("dobropis vstupnú daň znižuje — prichádza už so záporným znamienkom", () => {
    // KROS vracia pri dobropise zápornú DPH, takže stačí sčítať. Otočenie
    // znamienka by daň pripočítalo namiesto odpočítania.
    const result = vat([], [vatExpense("2026-09-03", 60), vatExpense("2026-09-04", -20, 17)]);
    expect(result.currentMonth.inputVat).toBe(40);
  });

  it("faktúrový dobropis znižuje daň na výstupe", () => {
    const result = vat([vatInvoice("2026-09-02", 200), vatInvoice("2026-09-05", -50)], []);
    expect(result.currentMonth.outputVat).toBe(150);
  });

  it("bez jediného dokladu s DPH je odhad null, nie nula", () => {
    const result = vat([vatInvoice("2026-09-02", undefined)], [vatExpense("2026-09-03", undefined)]);
    expect(result.currentMonth.amount).toBeNull();
  });

  it("nulová DPH na doklade je platný odhad nula", () => {
    const result = vat([vatInvoice("2026-09-02", 0)], []);
    expect(result.currentMonth.amount).toBe(0);
  });

  it("mesiace sú kalendárne bez ohľadu na prepínač obdobia", () => {
    const result = vat([], []);
    expect(result.previousMonth.monthKey).toBe("2026-08");
    expect(result.currentMonth.monthKey).toBe("2026-09");
  });

  it("január vracia december predchádzajúceho roka", () => {
    const result = computeVatEstimate({
      invoices: [],
      expenses: [],
      selectedCompanies: [],
      referenceDate: new Date(2026, 0, 10)
    });
    expect(result.previousMonth.monthKey).toBe("2025-12");
  });

  it("doklad dodaný v minulom mesiaci ale vystavený v tomto ide do minulého, nie do tohto mesiac — dátum dodania je rozhodujúci", () => {
    const invoiceLastMonthDelivered = { ...vatInvoice("2026-08-20", 100), issueDate: "2026-09-02" };
    const result = vat([invoiceLastMonthDelivered], []);
    expect(result.previousMonth.outputVat).toBe(100);
    expect(result.currentMonth.outputVat).toBe(0);
  });

  it("výdavok dodaný v minulom mesiaci ale vystavený v tomto ide do minulého — dátum dodania je rozhodujúci aj pri výdavkoch", () => {
    const expenseLastMonthDelivered = { ...vatExpense("2026-08-20", 50), issueDate: "2026-09-02" };
    const result = vat([], [expenseLastMonthDelivered]);
    expect(result.previousMonth.inputVat).toBe(50);
    expect(result.currentMonth.inputVat).toBe(0);
  });

  it("zálohová faktúra sa vynecháva — výdavok sa nepočíta dvakrát (záloha plus finálna faktúra)", () => {
    const invoice = vatInvoice("2026-09-02", 200);
    const normalExpense = vatExpense("2026-09-03", 60);
    const proformaExpense = vatExpense("2026-09-04", 40, 15);
    const result = vat([invoice], [normalExpense, proformaExpense]);
    expect(result.currentMonth.outputVat).toBe(200);
    expect(result.currentMonth.inputVat).toBe(60);
    expect(result.currentMonth.amount).toBe(140);
  });
});
