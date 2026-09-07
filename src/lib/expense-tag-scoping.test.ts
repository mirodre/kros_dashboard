import { describe, expect, it } from "vitest";
import { scopeExpenseAmountsToTagFilters } from "./expenses-live";
import { buildTagCategoryIndex, EMPTY_TAG_CATEGORY_INDEX } from "./tag-categories";
import type { ExpenseTagAllocation, NormalizedExpense } from "./kros-types";

const CATEGORY_INDEX = buildTagCategoryIndex([
  { name: "Stredisko 1", category: { name: "Stredisko" } },
  { name: "Stredisko 2", category: { name: "Stredisko" } },
  { name: "Stredisko 3", category: { name: "Stredisko" } },
  { name: "Zákazka A", category: { name: "Zákazka" } },
  { name: "Zákazka B", category: { name: "Zákazka" } }
]);

function expense(allocations: ExpenseTagAllocation[]): NormalizedExpense {
  return {
    id: "doc-1",
    companyName: "Kros Services",
    documentType: 10,
    issueDate: "2026-04-08",
    totalPrice: allocations.reduce((sum, allocation) => sum + allocation.amount, 0),
    paymentStatus: "notPaid",
    hasAttachments: false,
    tags: Array.from(new Set(allocations.flatMap((allocation) => allocation.tags))),
    allocations
  };
}

const SPLIT_DOC = expense([
  { tags: ["Stredisko 1", "Zákazka A"], amount: 600 },
  { tags: ["Stredisko 2", "Zákazka A"], amount: 400 }
]);

function scopeOne(
  doc: NormalizedExpense,
  filters: Record<string, string[]>,
  focusedTags: string[] = [],
  index = CATEGORY_INDEX
) {
  return scopeExpenseAmountsToTagFilters([doc], filters, focusedTags, index)[0];
}

describe("scopeExpenseAmountsToTagFilters", () => {
  it("bez filtra a bez focusu nechá doklady tak, ako sú", () => {
    const result = scopeOne(SPLIT_DOC, {});

    expect(result).toBe(SPLIT_DOC);
    expect(result.totalPrice).toBe(1000);
    expect(result.documentTotalPrice).toBeUndefined();
  });

  it("rozkliknutý štítok zúži sumu na jeho riadky rozúčtovania", () => {
    const result = scopeOne(SPLIT_DOC, {}, ["Stredisko 1"]);

    expect(result.totalPrice).toBe(600);
    expect(result.documentTotalPrice).toBe(1000);
    expect(result.allocations).toHaveLength(1);
    expect(result.tags).toEqual(["Stredisko 1", "Zákazka A"]);
  });

  it("filtre dvoch kategórií sa na riadkoch spájajú cez AND, nie cez zjednotenie štítkov", () => {
    const result = scopeOne(SPLIT_DOC, { Stredisko: ["Stredisko 1"], "Zákazka": ["Zákazka A"] });

    // Riadok Stredisko 2 nesie Zákazku A, takže pri zjednotení štítkov by prešiel
    // a doklad by ukázal celých 1000.
    expect(result.totalPrice).toBe(600);
    expect(result.documentTotalPrice).toBe(1000);
  });

  it("riadok bez štítku filtrovanej kategórie ostáva — patrí celému dokladu", () => {
    const doc = expense([
      { tags: ["Stredisko 1"], amount: 600 },
      { tags: ["Stredisko 2"], amount: 400 }
    ]);

    // Doklad nie je rozúčtovaný podľa zákaziek; filter zákazky ho preto nesmie
    // rozbiť na nulu, len ho zúži podľa strediska.
    const result = scopeOne(doc, { Stredisko: ["Stredisko 1"], "Zákazka": ["Zákazka A"] });

    expect(result.totalPrice).toBe(600);
  });

  it("focus je prísnejší než širší filter kategórie", () => {
    const result = scopeOne(
      SPLIT_DOC,
      { Stredisko: ["Stredisko 1", "Stredisko 2"] },
      ["Stredisko 2"]
    );

    expect(result.totalPrice).toBe(400);
  });

  it("dva rozkliknuté štítky z rôznych kategórií zúžia na riadky, ktoré nesú oba", () => {
    const doc = expense([
      { tags: ["Stredisko 1", "Zákazka A"], amount: 600 },
      { tags: ["Stredisko 1", "Zákazka B"], amount: 400 }
    ]);

    const result = scopeOne(doc, {}, ["Stredisko 1", "Zákazka B"]);

    expect(result.totalPrice).toBe(400);
  });

  it("dva rozkliknuté štítky z jednej kategórie sa sčítajú", () => {
    const doc = expense([
      { tags: ["Stredisko 1"], amount: 600 },
      { tags: ["Stredisko 2"], amount: 400 },
      { tags: ["Stredisko 3"], amount: 250 }
    ]);

    const result = scopeOne(doc, {}, ["Stredisko 1", "Stredisko 2"]);

    expect(result.totalPrice).toBe(1000);
  });

  it("keď filtru vyhovejú všetky riadky, doklad ostáva s celou sumou", () => {
    const doc = expense([
      { tags: ["Stredisko 1"], amount: 600 },
      { tags: ["Stredisko 1"], amount: 400 }
    ]);

    const result = scopeOne(doc, { Stredisko: ["Stredisko 1"] });

    expect(result.totalPrice).toBe(1000);
    expect(result.documentTotalPrice).toBeUndefined();
  });

  it("riadok s iným štítkom filtrovanej kategórie vypadne, aj keď v druhej kategórii nemá nič", () => {
    const doc = expense([
      { tags: ["Stredisko 1"], amount: 600 },
      { tags: ["Zákazka A"], amount: 400 }
    ]);

    const result = scopeOne(doc, { Stredisko: ["Stredisko 1"], "Zákazka": ["Zákazka B"] });

    expect(result.totalPrice).toBe(600);
  });

  it("keď nesedí ani jeden riadok, doklad sa nezúži na nulu", () => {
    const doc = expense([
      { tags: ["Stredisko 1"], amount: 600 },
      { tags: ["Stredisko 2"], amount: 400 }
    ]);

    const result = scopeOne(doc, { Stredisko: ["Stredisko 3"] });

    expect(result.totalPrice).toBe(1000);
    expect(result.documentTotalPrice).toBeUndefined();
  });

  it("bez kategórií (plochý filter) zúži sumu podľa zvolených štítkov", () => {
    const doc = expense([
      { tags: ["Nájom"], amount: 900 },
      { tags: ["Energie"], amount: 350 },
      { tags: ["Služby"], amount: 200 }
    ]);

    const result = scopeOne(doc, { __all__: ["Nájom", "Energie"] }, [], EMPTY_TAG_CATEGORY_INDEX);

    expect(result.totalPrice).toBe(1250);
    expect(result.documentTotalPrice).toBe(1450);
    expect(result.tags).toEqual(["Nájom", "Energie"]);
  });

  it("dobropis si po zúžení nechá záporné znamienko", () => {
    const doc = expense([
      { tags: ["Stredisko 1"], amount: -200 },
      { tags: ["Stredisko 2"], amount: -120 }
    ]);

    const result = scopeOne(doc, {}, ["Stredisko 1"]);

    expect(result.totalPrice).toBe(-200);
    expect(result.documentTotalPrice).toBe(-320);
  });
});
