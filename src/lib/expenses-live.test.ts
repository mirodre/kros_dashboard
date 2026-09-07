import { describe, expect, it } from "vitest";
import { normalizeExpenses } from "./expenses-live";

/**
 * Hlavička výdavku v tvare, aký naozaj vracia KROS — pozri
 * `docs/superpowers/plans/2026-09-06-domov-kros-polia.md`.
 */
function rawExpense(overrides: Record<string, unknown> = {}) {
  return {
    id: "exp-1",
    issueDate: "2026-08-01T00:00:00",
    documentType: 10,
    __company: "Kros Trade",
    __companyId: 1,
    prices: {
      documentPrices: { totalPrice: 3.53, vatTotalPrice: 0.67 },
      legislativePrices: { totalPrice: 3.53, vatTotalPrice: 0.67 },
      exchangeRate: 1,
      currency: "EUR"
    },
    ...overrides
  };
}

describe("normalizeExpenses — suma a mena", () => {
  it("berie legislatívnu sumu, ktorá je v účtovnej mene", () => {
    expect(normalizeExpenses([rawExpense()])[0].totalPrice).toBe(3.53);
  });

  it("doklad v cudzej mene NEPADÁ na documentPrices — tá je v mene dokladu", () => {
    // Poľský doklad: 8,94 PLN = 2,18 EUR. Do eurového súčtu patrí 2,18.
    // Kým tu bol fallback na documentPrices, vynulovaná legislatívna skupina
    // by sem prepustila 8,94 — pri českom doklade dvadsaťpäťnásobok.
    const raw = rawExpense({
      prices: {
        documentPrices: { totalPrice: 8.94, vatTotalPrice: 0 },
        legislativePrices: { totalPrice: 0, vatTotalPrice: 0 },
        exchangeRate: 4.1,
        currency: "PLN"
      }
    });
    expect(normalizeExpenses([raw])[0].totalPrice).toBe(0);
  });

  it("doklad bez cien dá nulu, nie NaN", () => {
    expect(normalizeExpenses([rawExpense({ prices: {} })])[0].totalPrice).toBe(0);
  });
});

describe("normalizeExpenses — DPH", () => {
  it("berie DPH z legislatívnych cien", () => {
    expect(normalizeExpenses([rawExpense()])[0].vatAmount).toBe(0.67);
  });

  it("chýbajúca DPH ostane undefined, nie nula", () => {
    const raw = rawExpense({
      prices: { legislativePrices: { totalPrice: 3.53 }, exchangeRate: 1, currency: "EUR" }
    });
    expect(normalizeExpenses([raw])[0].vatAmount).toBeUndefined();
  });

  it("nulová DPH je nula, nie chýbajúci údaj", () => {
    const raw = rawExpense({
      prices: {
        legislativePrices: { totalPrice: 3.53, vatTotalPrice: 0 },
        exchangeRate: 1,
        currency: "EUR"
      }
    });
    expect(normalizeExpenses([raw])[0].vatAmount).toBe(0);
  });

  it("dobropis nesie zápornú sumu aj zápornú DPH tak, ako prišli z KROSu", () => {
    const raw = rawExpense({
      documentType: 17,
      prices: {
        legislativePrices: { totalPrice: -55.12, vatTotalPrice: -12.68 },
        exchangeRate: 1,
        currency: "EUR"
      }
    });
    const expense = normalizeExpenses([raw])[0];
    expect(expense.totalPrice).toBe(-55.12);
    expect(expense.vatAmount).toBe(-12.68);
  });

  it("riadok zaúčtovania NEPADÁ na svoj totalPrice — ten je v mene dokladu, nie v eurách", () => {
    // Rovnaký dôvod ako pri hlavičke: `totalPrice` riadku je v mene dokladu, nie
    // v eurách. Prvý riadok má vynulovanú legislatívnu sumu (KROS to vie nechať
    // tak) a cudzomenový `totalPrice` — keby bol fallback, súčet by ho pripočítal
    // a vyšiel by 72.9 namiesto 5.
    const raw = rawExpense({
      journalItems: [
        { tags: ["Materiál"], legislativeTotalPrice: 0, totalPrice: 67.9 },
        { tags: ["Réžia"], legislativeTotalPrice: 5, totalPrice: 5 }
      ]
    });
    expect(normalizeExpenses([raw])[0].totalPrice).toBe(5);
  });
});
