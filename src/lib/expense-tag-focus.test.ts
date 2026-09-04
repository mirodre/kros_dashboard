import { describe, expect, it } from "vitest";
import type { NormalizedExpense } from "./kros-types";
import { computeExpenseTagStructure, scopeExpenseAmountsToTagFilters } from "./expenses-live";
import { buildTagCategoryIndex, documentMatchesTagFilters } from "./tag-categories";

/**
 * Scenár z praxe: dve dimenzie štítkov (apartmán a druh nákladu). Doklad nesie v každej
 * dimenzii práve jeden štítok — presne preto musí focus v rámci kategórie fungovať ako OR.
 */
const index = buildTagCategoryIndex([
  { name: "Apartmán 1", category: { name: "Apartmán" } },
  { name: "Apartmán 2", category: { name: "Apartmán" } },
  { name: "Apartmán 3", category: { name: "Apartmán" } },
  { name: "Náklady 1", category: { name: "Kategória nákladov" } },
  { name: "Náklady 2", category: { name: "Kategória nákladov" } },
  { name: "Náklady 3", category: { name: "Kategória nákladov" } }
]);

const today = new Date().toISOString();

function doc(id: string, amount: number, tags: string[]): NormalizedExpense {
  return {
    id,
    companyId: 1,
    companyName: "Firma",
    partnerName: "Dodávateľ",
    documentNumber: id,
    documentType: 10,
    issueDate: today,
    deliveryDate: today,
    dueDate: today,
    totalPrice: amount,
    paymentStatus: "fullyPaid",
    hasAttachments: false,
    tags,
    allocations: [{ tags, amount }]
  } as unknown as NormalizedExpense;
}

const expenses = [
  doc("1", 100, ["Apartmán 1", "Náklady 1"]),
  doc("2", 200, ["Apartmán 1", "Náklady 2"]),
  doc("3", 300, ["Apartmán 2", "Náklady 1"]),
  doc("4", 400, ["Apartmán 3", "Náklady 3"])
];

/** To isté, čo robí `scopeExpensesToTags` na stránke Výdavky. */
function scoped(focusedTags: string[]) {
  const matching = expenses.filter((expense) =>
    documentMatchesTagFilters(expense.tags, {}, focusedTags, index)
  );
  return scopeExpenseAmountsToTagFilters(matching, {}, focusedTags, index);
}

function amountsByTag(focusedTags: string[]) {
  return Object.fromEntries(
    computeExpenseTagStructure(scoped(focusedTags), [], []).map((slice) => [slice.name, slice.amount])
  );
}

describe("focus naprieč kategóriami štítkov", () => {
  it("bez focusu ide do prehľadu všetko", () => {
    expect(amountsByTag([])).toMatchObject({
      "Apartmán 1": 300,
      "Apartmán 2": 300,
      "Apartmán 3": 400,
      "Náklady 1": 400,
      "Náklady 2": 200,
      "Náklady 3": 400
    });
  });

  it("jeden apartmán ukáže náklady len zaňho", () => {
    const amounts = amountsByTag(["Apartmán 1"]);

    expect(amounts["Náklady 1"]).toBe(100);
    expect(amounts["Náklady 2"]).toBe(200);
    expect(amounts["Náklady 3"]).toBeUndefined();
  });

  it("druhý apartmán čísla v druhej kategórii ROZŠÍRI, nie zúži", () => {
    const amounts = amountsByTag(["Apartmán 1", "Apartmán 2"]);

    // Náklady 1 = 100 (Apartmán 1) + 300 (Apartmán 2).
    expect(amounts["Náklady 1"]).toBe(400);
    expect(amounts["Náklady 2"]).toBe(200);
    expect(amounts["Náklady 3"]).toBeUndefined();
  });

  it("štítky z dvoch rôznych kategórií výber zúžia", () => {
    const amounts = amountsByTag(["Apartmán 1", "Náklady 1"]);

    expect(amounts["Apartmán 1"]).toBe(100);
    expect(amounts["Náklady 1"]).toBe(100);
    expect(amounts["Náklady 2"]).toBeUndefined();
  });

  it("dva apartmány a jeden druh nákladu — OR vnútri, AND naprieč", () => {
    const amounts = amountsByTag(["Apartmán 1", "Apartmán 2", "Náklady 1"]);

    // Doklady 1 (100) a 3 (300); doklad 2 vypadne na Nákladoch 2.
    expect(amounts["Náklady 1"]).toBe(400);
    expect(amounts["Apartmán 1"]).toBe(100);
    expect(amounts["Apartmán 2"]).toBe(300);
    expect(amounts["Apartmán 3"]).toBeUndefined();
  });
});
