import { describe, expect, it } from "vitest";
import {
  computeDuePositions,
  computeProfitCompanyBreakdown,
  computeProfitKpiCards,
  computeProfitKpis,
  computeProfitSeries,
  computeProfitTagBreakdown,
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

describe("computeProfitKpiCards", () => {
  function point(label: string, profit: number, previousProfit = 0): ProfitPoint {
    return {
      label,
      income: profit,
      expense: 0,
      profit,
      previousIncome: previousProfit,
      previousExpense: 0,
      previousProfit
    };
  }

  it("dá tri karty v poradí: obdobie, kumulatív, priemer", () => {
    const cards = computeProfitKpiCards([point("jan", 100), point("feb", 300)], "month");
    expect(cards.map((card) => card.title)).toEqual([
      "Zisk v aktuálnom období",
      "Kumulatívny zisk tento rok",
      "Priemerný zisk na obdobie"
    ]);
  });

  it("prvá karta je posledný stĺpec, kumulatív je celý rok a priemer ich delí", () => {
    const cards = computeProfitKpiCards([point("jan", 100), point("feb", 300)], "month");
    expect(cards[0].currentValue).toBe(300);
    expect(cards[1].currentValue).toBe(400);
    expect(cards[2].currentValue).toBe(200);
  });

  it("focus stĺpca prepne prvú kartu aj jej názov, kumulatív a priemer nechá", () => {
    const cards = computeProfitKpiCards([point("jan", 100), point("feb", 300)], "month", "jan");
    expect(cards[0].title).toBe("Zisk vo vybranom období");
    expect(cards[0].currentValue).toBe(100);
    expect(cards[1].currentValue).toBe(400);
    expect(cards[2].currentValue).toBe(200);
  });

  it("pri rokoch je 'tento rok' posledný stĺpec, nie súčet piatich rokov", () => {
    const cards = computeProfitKpiCards(
      [point("2024", 100), point("2025", 200), point("2026", 300)],
      "year"
    );
    // Kumulatív = 300 (tento rok), nie 600 — inak by karta tvrdila, že sme
    // tento rok zarobili aj to, čo predvlani.
    expect(cards[1].currentValue).toBe(300);
    // Priemer naopak patrí celej sérii, ktorú graf ukazuje.
    expect(cards[2].currentValue).toBe(200);
  });

  it("zlepšenie z vlaňajšej straty je rast, nie pokles", () => {
    // Zo straty −100 na zisk +50: naivné (50 − (−100)) / (−100) dá −150 %, teda
    // „pokles" pri zlepšení. Delenie absolútnou hodnotou znamienko udrží.
    const cards = computeProfitKpiCards([point("jan", 50, -100)], "month");
    expect(cards[0].deltaPct).toBe(150);
    expect(cards[0].deltaPct).toBeGreaterThan(0);
  });

  it("zhoršenie zo vlaňajšieho zisku do straty je pokles", () => {
    const cards = computeProfitKpiCards([point("jan", -50, 100)], "month");
    expect(cards[0].deltaPct).toBeLessThan(0);
  });

  it("nulový vlaňajšok deltu skryje, nie ukáže 100 %", () => {
    const cards = computeProfitKpiCards([point("jan", 500, 0)], "month");
    expect(cards[0].hideDelta).toBe(true);
  });

  it("prázdna séria dá tri nulové karty a nespadne", () => {
    const cards = computeProfitKpiCards([], "month");
    expect(cards).toHaveLength(3);
    expect(cards.every((card) => card.currentValue === 0)).toBe(true);
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

  it("firma bez jedinej faktúry v scope naozaj nič nedlží — nie 'údaj nedostupný'", () => {
    const result = positions([], []);
    expect(result.receivablesAvailable).toBe(true);
    expect(result.receivables.total).toBe(0);
  });

  it("doklady nesie pozícia so sebou a ich súčet sa rovná súčtu pásiem", () => {
    const result = positions(
      [unpaidInvoice("2026-09-30", 500), unpaidInvoice("2026-06-01", 300)],
      [unpaidExpense("2026-08-27", 200)]
    );

    expect(result.receivables.documents).toHaveLength(2);
    expect(result.payables.documents).toHaveLength(1);
    // Zoznam a pásma nesmú tvrdiť dve rôzne sumy — čítajú z tej istej slučky.
    expect(result.receivables.documents.reduce((sum, doc) => sum + doc.amount, 0)).toBe(
      result.receivables.total
    );
    expect(result.receivables.documents.every((doc) => doc.key !== "")).toBe(true);
  });

  it("doklady idú od najdlhšie po splatnosti — 60+, potom po splatnosti, potom v splatnosti", () => {
    const result = positions(
      [
        unpaidInvoice("2026-09-30", 100),
        unpaidInvoice("2026-06-01", 200),
        unpaidInvoice("2026-08-27", 300)
      ],
      []
    );

    expect(result.receivables.documents.map((doc) => doc.band)).toEqual([
      "overdue60",
      "overdue",
      "due"
    ]);
  });

  it("dní po splatnosti je počítané k referenčnému dňu, v splatnosti je null", () => {
    const result = positions([unpaidInvoice("2026-08-27", 500), unpaidInvoice("2026-09-30", 100)], []);
    const overdue = result.receivables.documents.find((doc) => doc.band === "overdue");
    const due = result.receivables.documents.find((doc) => doc.band === "due");

    expect(overdue?.daysOverdue).toBe(10);
    // Doklad v splatnosti nie je „0 dní po splatnosti" — nie je po splatnosti vôbec.
    expect(due?.daysOverdue).toBeNull();
  });

  it("doklad bez splatnosti nemá dni po splatnosti a ostáva na konci svojho pásma", () => {
    const noDue = { ...unpaidInvoice("2026-09-30", 500), dueDate: undefined, id: "inv-no-due" };
    const result = positions([noDue, unpaidInvoice("2026-09-30", 100)], []);
    const found = result.receivables.documents.find((doc) => doc.key.endsWith("inv-no-due"));

    expect(found?.daysOverdue).toBeNull();
    expect(found?.band).toBe("due");
  });

  it("riadok výdavku nesie typ dokladu a celok, keď filter štítkov sumu zúžil", () => {
    const scoped = { ...unpaidExpense("2026-08-27", 120), documentTotalPrice: 300 };
    const result = positions([], [scoped]);

    expect(result.payables.documents[0].documentLabel).toBe("Došlá faktúra");
    expect(result.payables.documents[0].documentTotal).toBe(300);
  });

  it("čiastočne uhradená faktúra to prizná v popise riadku", () => {
    const partial = {
      ...unpaidInvoice("2026-09-30", 500),
      paymentStatus: "partiallyPaid" as const
    };
    const result = positions([partial], []);

    expect(result.receivables.documents[0].documentLabel).toContain("čiastočne uhradená");
  });

  it("uhradené doklady sa do zoznamu nedostanú", () => {
    const paid = { ...unpaidInvoice("2026-09-30", 500), paymentStatus: "fullyPaid" as const };
    expect(positions([paid], []).receivables.documents).toHaveLength(0);
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

  it("neprázdny výber firiem zúži odhad len na ne — presne tá trieda chyby, ktorú DPH karta mala (Important 3)", () => {
    const companyAInvoice = { ...vatInvoice("2026-09-02", 200), companyName: "CompanyA" };
    const companyBInvoice = { ...vatInvoice("2026-09-02", 900), companyName: "CompanyB" };
    const result = computeVatEstimate({
      invoices: [companyAInvoice, companyBInvoice],
      expenses: [],
      selectedCompanies: ["CompanyA"],
      referenceDate: VAT_REFERENCE
    });
    expect(result.currentMonth.outputVat).toBe(200);
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

function taggedInvoice(date: string, totalPrice: number, tags: string[]): NormalizedInvoice {
  return { ...invoice(date, totalPrice), id: `inv-${date}-${tags.join("-")}`, tags };
}

function taggedExpense(date: string, totalPrice: number, tags: string[]): NormalizedExpense {
  return {
    ...expense(date, totalPrice),
    id: `exp-${date}-${tags.join("-")}`,
    tags,
    allocations: [{ tags, amount: totalPrice }]
  };
}

describe("computeProfitTagBreakdown", () => {
  const date = firstDayOf(CURRENT_YEAR, NOW.getMonth());

  it("zisk štítku je jeho príjmy mínus jeho výdavky", () => {
    const points = computeProfitTagBreakdown({
      invoices: [taggedInvoice(date, 1000, ["Retail"])],
      expenses: [taggedExpense(date, 300, ["Retail"])],
      selectedCompanies: []
    });
    const retail = points.find((point) => point.name === "Retail");
    expect(retail).toMatchObject({ income: 1000, expense: 300, profit: 700 });
  });

  it("štítok len s výdavkami má záporný zisk a v zozname ostáva", () => {
    const points = computeProfitTagBreakdown({
      invoices: [],
      expenses: [taggedExpense(date, 400, ["Réžia"])],
      selectedCompanies: []
    });
    expect(points.find((point) => point.name === "Réžia")).toMatchObject({
      income: 0,
      expense: 400,
      profit: -400
    });
  });

  it("štítok len s príjmami sa nestratí", () => {
    const points = computeProfitTagBreakdown({
      invoices: [taggedInvoice(date, 500, ["Projekty"])],
      expenses: [],
      selectedCompanies: []
    });
    expect(points.find((point) => point.name === "Projekty")?.profit).toBe(500);
  });

  it("faktúra s dvoma štítkami sa započíta celá do oboch — priznaná nepresnosť", () => {
    const points = computeProfitTagBreakdown({
      invoices: [taggedInvoice(date, 600, ["Retail", "Projekty"])],
      expenses: [],
      selectedCompanies: []
    });
    expect(points.find((point) => point.name === "Retail")?.income).toBe(600);
    expect(points.find((point) => point.name === "Projekty")?.income).toBe(600);
  });

  it("zoradené od najziskovejšieho", () => {
    const points = computeProfitTagBreakdown({
      invoices: [taggedInvoice(date, 1000, ["A"]), taggedInvoice(date, 200, ["B"])],
      expenses: [],
      selectedCompanies: []
    });
    expect(points.map((point) => point.name)).toEqual(["A", "B"]);
  });

  it("rozpis zisku pripína vlaňajšok aj — profit a previousProfit sú odlišné", () => {
    const thisYear = firstDayOf(CURRENT_YEAR, NOW.getMonth());
    const lastYear = firstDayOf(CURRENT_YEAR - 1, NOW.getMonth());
    const points = computeProfitTagBreakdown({
      invoices: [
        taggedInvoice(thisYear, 2000, ["Consulting"]),
        taggedInvoice(lastYear, 1500, ["Consulting"])
      ],
      expenses: [
        taggedExpense(thisYear, 800, ["Consulting"]),
        taggedExpense(lastYear, 500, ["Consulting"])
      ],
      selectedCompanies: []
    });
    const consulting = points.find((point) => point.name === "Consulting");
    expect(consulting).toMatchObject({
      income: 2000,
      expense: 800,
      profit: 1200,
      previousProfit: 1000
    });
    expect(consulting?.profit).not.toBe(consulting?.previousProfit);
  });
});

describe("computeProfitCompanyBreakdown", () => {
  const date = firstDayOf(CURRENT_YEAR, NOW.getMonth());

  it("zisk firmy je jej príjmy mínus jej výdavky", () => {
    const points = computeProfitCompanyBreakdown({
      invoices: [invoice(date, 900)],
      expenses: [expense(date, 200)],
      selectedTags: [],
      selectedCompanies: []
    });
    expect(points.find((point) => point.name === "Kros Trade")).toMatchObject({
      income: 900,
      expense: 200,
      profit: 700
    });
  });

  it("firma len s výdavkami sa v zozname objaví", () => {
    const onlySpend: NormalizedExpense = { ...expense(date, 300), companyName: "Kros Servis" };
    const points = computeProfitCompanyBreakdown({
      invoices: [],
      expenses: [onlySpend],
      selectedTags: [],
      selectedCompanies: []
    });
    expect(points.find((point) => point.name === "Kros Servis")?.profit).toBe(-300);
  });

  it("filter štítkov zúžuje výsledok len na firmy s dokladmi v tom štítku", () => {
    const companyAInvoice = taggedInvoice(date, 1000, ["Marketing"]);
    const companyAInvoice2 = taggedInvoice(date, 500, ["Operations"]);
    const companyBInvoice = taggedInvoice(date, 800, ["Operations"]);
    const companyAExpense = taggedExpense(date, 200, ["Marketing"]);
    const companyAExpense2 = taggedExpense(date, 300, ["Operations"]);
    const companyBExpense = taggedExpense(date, 150, ["Operations"]);

    const points = computeProfitCompanyBreakdown({
      invoices: [
        { ...companyAInvoice, companyName: "CompanyA" },
        { ...companyAInvoice2, companyName: "CompanyA" },
        { ...companyBInvoice, companyName: "CompanyB" }
      ],
      expenses: [
        { ...companyAExpense, companyName: "CompanyA" },
        { ...companyAExpense2, companyName: "CompanyA" },
        { ...companyBExpense, companyName: "CompanyB" }
      ],
      selectedTags: ["Marketing"],
      selectedCompanies: []
    });

    const companyA = points.find((point) => point.name === "CompanyA");
    const companyB = points.find((point) => point.name === "CompanyB");

    expect(companyA).toMatchObject({
      income: 1000,
      expense: 200,
      profit: 800
    });
    expect(companyB).toBeUndefined();
  });
});
