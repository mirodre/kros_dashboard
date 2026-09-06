import { describe, expect, it } from "vitest";
import { getHomeMockData } from "./home-mock-data";
import { computeDuePositions, computeProfitSeries, computeVatEstimate } from "./home-live";

const REFERENCE = new Date(2026, 8, 6);

describe("getHomeMockData", () => {
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
});
