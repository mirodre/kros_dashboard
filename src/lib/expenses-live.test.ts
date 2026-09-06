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
