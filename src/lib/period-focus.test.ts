import { describe, expect, it } from "vitest";
import {
  classifyPeriod,
  formatPeriodFocusLabel,
  getBucketPeriodWindow
} from "./period-buckets";
import {
  computeCompanyBreakdown,
  computeKpis,
  computeTagBreakdown,
  getFilteredRecentInvoices
} from "./dashboard-live";
import {
  computeExpenseKpis,
  computeExpenseTagBreakdown,
  computeExpenseVendorBreakdown
} from "./expenses-live";
import type { NormalizedExpense, NormalizedInvoice } from "./kros-types";

/**
 * Filter obdobia z hlavného grafu: klik na stĺpec zúži sekcie pod grafom na to isté
 * okno, aké stĺpec sčítal — v tomto roku daný stĺpec, vlani to isté obdobie.
 */

const NOW = new Date();
const CURRENT_YEAR = NOW.getFullYear();
const CURRENT_MONTH = NOW.getMonth();
const MONTH_LABEL = new Date(CURRENT_YEAR, CURRENT_MONTH, 1).toLocaleString("sk-SK", {
  month: "short"
});

/** Prvý deň mesiaca — vždy v minulosti alebo dnes, takže nespadne za orez „do dnes". */
function firstDayOf(year: number, month: number) {
  return `${year}-${String(month + 1).padStart(2, "0")}-01`;
}

function invoice(date: string, overrides: Partial<NormalizedInvoice> = {}): NormalizedInvoice {
  return {
    id: `inv-${date}-${overrides.partnerName ?? overrides.companyName ?? "x"}`,
    companyName: "Kros Trade",
    issueDate: date,
    deliveryDate: date,
    totalPrice: 100,
    tags: ["Retail"],
    ...overrides
  };
}

function expense(date: string, overrides: Partial<NormalizedExpense> = {}): NormalizedExpense {
  return {
    id: `exp-${date}-${overrides.partnerName ?? "x"}`,
    companyName: "Kros Trade",
    documentType: 10,
    issueDate: date,
    deliveryDate: date,
    totalPrice: 100,
    paymentStatus: "fullyPaid",
    hasAttachments: false,
    tags: ["Nákup"],
    allocations: [{ tags: ["Nákup"], amount: 100 }],
    ...overrides
  };
}

describe("getBucketPeriodWindow", () => {
  it("mesačný stĺpec je ten mesiac tento rok a ten istý mesiac vlani", () => {
    const window = getBucketPeriodWindow("month", MONTH_LABEL);

    expect(window).not.toBeNull();
    expect(window!.currentFrom.getFullYear()).toBe(CURRENT_YEAR);
    expect(window!.currentFrom.getMonth()).toBe(CURRENT_MONTH);
    expect(window!.previousFrom.getFullYear()).toBe(CURRENT_YEAR - 1);
    expect(window!.previousFrom.getMonth()).toBe(CURRENT_MONTH);
  });

  it("pri ročnej granularite je „vlani\" rok pred kliknutým rokom", () => {
    const window = getBucketPeriodWindow("year", String(CURRENT_YEAR - 1));

    expect(window).not.toBeNull();
    expect(window!.currentFrom.getFullYear()).toBe(CURRENT_YEAR - 1);
    expect(window!.previousFrom.getFullYear()).toBe(CURRENT_YEAR - 2);
  });

  it("stĺpec, ktorý pri danom období neexistuje, okno nedá", () => {
    // Presne to sa stane po prepnutí obdobia — stránka podľa toho filter zahodí.
    expect(getBucketPeriodWindow("week", MONTH_LABEL)).toBeNull();
    expect(getBucketPeriodWindow("month", "2019")).toBeNull();
  });
});

describe("classifyPeriod", () => {
  const window = {
    currentFrom: new Date(2026, 4, 1),
    currentTo: new Date(2026, 4, 31, 23, 59, 59, 999),
    previousFrom: new Date(2025, 4, 1),
    previousTo: new Date(2025, 4, 31, 23, 59, 59, 999)
  };

  it("rozdelí dátumy na toto a vlaňajšie obdobie", () => {
    expect(classifyPeriod(new Date(2026, 4, 15), window)).toBe("current");
    expect(classifyPeriod(new Date(2025, 4, 15), window)).toBe("previous");
  });

  it("dátum mimo okna sa nepočíta ani na jednu stranu", () => {
    expect(classifyPeriod(new Date(2026, 5, 1), window)).toBeNull();
  });
});

describe("filter obdobia v sekciách Príjmov", () => {
  const periodWindow = getBucketPeriodWindow("month", MONTH_LABEL)!;
  const invoices = [
    invoice(firstDayOf(CURRENT_YEAR, CURRENT_MONTH), { totalPrice: 300 }),
    invoice(firstDayOf(CURRENT_YEAR - 1, CURRENT_MONTH), { totalPrice: 120 }),
    // Doklad z iného mesiaca tohto roka — vo focusnutom stĺpci nemá čo robiť.
    invoice(firstDayOf(CURRENT_YEAR, (CURRENT_MONTH + 11) % 12), { totalPrice: 999 })
  ];

  it("štítky sčítajú len doklady focusnutého obdobia", () => {
    const [tag] = computeTagBreakdown(invoices, [], periodWindow);

    expect(tag).toMatchObject({ name: "Retail", amount: 300, previousAmount: 120 });
  });

  it("bez focusu ostáva pôvodné okno celého roka", () => {
    const [tag] = computeTagBreakdown(invoices, []);

    expect(tag.amount).toBeGreaterThanOrEqual(300);
  });

  it("firmy sa počítajú v tom istom okne", () => {
    const [company] = computeCompanyBreakdown(invoices, [], [], periodWindow);

    expect(company).toMatchObject({ name: "Kros Trade", amount: 300, previousAmount: 120 });
  });

  it("posledné faktúry sú z focusnutého obdobia, nie aj z vlaňajšieho", () => {
    const recent = getFilteredRecentInvoices(invoices, {
      granularity: "month",
      selectedTags: [],
      selectedCompanies: [],
      period: periodWindow
    });

    expect(recent).toHaveLength(1);
    expect(recent[0].totalPrice).toBe(300);
  });
});

describe("filter obdobia v sekciách Výdavkov", () => {
  const periodWindow = getBucketPeriodWindow("month", MONTH_LABEL)!;
  const expenses = [
    expense(firstDayOf(CURRENT_YEAR, CURRENT_MONTH), {
      totalPrice: 400,
      partnerName: "Dodávateľ A",
      allocations: [{ tags: ["Nákup"], amount: 400 }]
    }),
    expense(firstDayOf(CURRENT_YEAR - 1, CURRENT_MONTH), {
      totalPrice: 150,
      partnerName: "Dodávateľ A",
      allocations: [{ tags: ["Nákup"], amount: 150 }]
    }),
    expense(firstDayOf(CURRENT_YEAR, (CURRENT_MONTH + 11) % 12), {
      totalPrice: 999,
      partnerName: "Dodávateľ A",
      allocations: [{ tags: ["Nákup"], amount: 999 }]
    })
  ];

  it("štítky sčítajú len doklady focusnutého obdobia", () => {
    const [tag] = computeExpenseTagBreakdown(expenses, [], periodWindow);

    expect(tag).toMatchObject({ name: "Nákup", amount: 400, previousAmount: 150 });
  });

  it("dodávatelia sa počítajú v tom istom okne", () => {
    const [vendor] = computeExpenseVendorBreakdown(expenses, [], [], undefined, periodWindow);

    expect(vendor).toMatchObject({ name: "Dodávateľ A", amount: 400, previousAmount: 150 });
  });
});

describe("formatPeriodFocusLabel", () => {
  it("k mesiacu a týždňu dopíše rok, samotný rok nechá tak", () => {
    expect(formatPeriodFocusLabel("month", "sep")).toBe(`sep ${CURRENT_YEAR}`);
    expect(formatPeriodFocusLabel("week", "T5")).toBe(`T5 ${CURRENT_YEAR}`);
    expect(formatPeriodFocusLabel("year", "2024")).toBe("2024");
  });
});

/**
 * Hlavné KPI ide za klikom do grafu: bez focusu ukazuje posledný stĺpec („aktuálne
 * obdobie"), s focusom ten, na ktorý sa kliklo — inak by číslo nad grafom tvrdilo
 * niečo iné ako zvýraznený stĺpec a sekcie pod ním.
 */
describe("hlavné KPI pri focuse obdobia", () => {
  const points = [
    { label: "jan", current: 100, previous: 40 },
    { label: "feb", current: 200, previous: 50 },
    { label: "mar", current: 300, previous: 150 }
  ];
  const emptyWatchlist = { overdue: [], overdueTotal: 0, upcoming: [], upcomingTotal: 0 };

  it("bez focusu drží tržby posledného stĺpca", () => {
    expect(computeKpis(points)[0]).toMatchObject({
      title: "Tržby v aktuálnom období",
      currentValue: 300,
      previousValue: 150
    });
  });

  it("focus prepne tržby na vybraný stĺpec", () => {
    expect(computeKpis(points, undefined, "feb")[0]).toMatchObject({
      title: "Tržby vo vybranom období",
      currentValue: 200,
      previousValue: 50
    });
  });

  it("focus prepne aj výdavky na vybraný stĺpec", () => {
    const kpis = computeExpenseKpis(points, { current: 600, previous: 240 }, emptyWatchlist, "jan");

    expect(kpis[0]).toMatchObject({
      title: "Výdavky vo vybranom období",
      currentValue: 100,
      previousValue: 40
    });
    // Kumulované číslo je celoročné, focus stĺpca ho nezužuje.
    expect(kpis[1]).toMatchObject({ title: "Kumulované výdavky tento rok", currentValue: 600 });
  });

  it("stĺpec, ktorý v sérii nie je, KPI nezmení", () => {
    expect(computeKpis(points, undefined, "dec")[0]).toMatchObject({
      title: "Tržby v aktuálnom období",
      currentValue: 300
    });
  });
});
