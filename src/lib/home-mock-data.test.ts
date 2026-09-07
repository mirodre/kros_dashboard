import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getHomeMockData } from "./home-mock-data";
import { computeDuePositions, computeProfitSeries, computeVatEstimate } from "./home-live";

const REFERENCE = new Date(2026, 8, 6);

describe("getHomeMockData", () => {
  // `computeProfitSeries` nemá parameter `referenceDate` — deleguje na
  // `computeRevenueSeries`/`computeExpenseSeries`, ktoré si „dnes" berú z reálneho
  // hodinového stroja cez `getDateRange()` (pozri period-buckets.ts, dashboard-live.ts).
  // Fixtúry v tomto súbore sú dátované okolo REFERENCE (rok 2026); keby REFERENCE
  // ostalo natvrdo a systémový čas nie, po prelome do roku 2027 by bucketovanie hľadalo
  // „tento rok" = 2027 a žiadna fixtúra by doň nespadla — zisk by bol všade nula
  // a test by zlyhal bez akejkoľvek regresie v kóde. Zamknutím systémového času na
  // REFERENCE zostávajú fixtúra aj bucketovanie v tom istom roku nech test beží kedykoľvek.
  // Neriešiť „jednoducho" REFERENCE = new Date() — časti dát (napr. neuhradené doklady
  // v pásmach splatnosti) sú viazané na deň v mesiaci a strata kontroly nad rokom by
  // znova otvorila presne tento problém.
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(REFERENCE);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("dáva doklady v aktuálnom aj minulom roku, nech je čo porovnávať", () => {
    const data = getHomeMockData(REFERENCE);
    const years = new Set(data.invoices.map((invoice) => invoice.issueDate.slice(0, 4)));
    expect(years.size).toBeGreaterThan(1);
  });

  it("demo zisk je nenulový v aspoň jednom stĺpci", () => {
    const data = getHomeMockData(REFERENCE);
    const points = computeProfitSeries({
      invoices: data.invoices,
      expenses: data.expenses,
      granularity: "month",
      selectedTags: [],
      selectedCompanies: []
    });
    expect(points.some((point) => point.profit !== 0)).toBe(true);
  });

  it("demo pohľadávky sú dostupné a nenulové — inak by karta hlásila chýbajúci údaj", () => {
    const data = getHomeMockData(REFERENCE);
    const positions = computeDuePositions({
      invoices: data.invoices,
      expenses: data.expenses,
      selectedTags: [],
      selectedCompanies: [],
      referenceDate: REFERENCE
    });
    expect(positions.receivablesAvailable).toBe(true);
    expect(positions.receivables.total).toBeGreaterThan(0);
    expect(positions.payables.total).toBeGreaterThan(0);
  });

  it("demo doklady nesú DPH, takže odhad nie je null", () => {
    const data = getHomeMockData(REFERENCE);
    const estimate = computeVatEstimate({
      invoices: data.invoices,
      expenses: data.expenses,
      selectedCompanies: [],
      referenceDate: REFERENCE
    });
    expect(estimate.currentMonth.amount).not.toBeNull();
    expect(estimate.previousMonth.amount).not.toBeNull();
  });

  it("demo má aspoň dva účty a dve firmy", () => {
    const data = getHomeMockData(REFERENCE);
    expect(data.accounts.length).toBeGreaterThanOrEqual(2);
    expect(new Set(data.invoices.map((invoice) => invoice.companyName)).size).toBeGreaterThanOrEqual(2);
  });

  it("demo obsahuje aspoň jeden výdavok rozúčtovaný na viac štítkov naraz", () => {
    // Bez takého dokladu sa nedá v prehliadači overiť, že tok (graf, KPI) a
    // "Zisk podľa štítkov" počítajú s rovnakou (alikvotnou) sumou — pozri
    // scopeExpenseAmountsToTagFilters v page.tsx.
    const data = getHomeMockData(REFERENCE);
    expect(data.expenses.some((expense) => expense.allocations.length > 1)).toBe(true);
  });
});
