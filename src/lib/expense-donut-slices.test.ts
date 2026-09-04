import { describe, expect, it } from "vitest";
import { excludeFocusedTagSlices } from "./expenses-live";
import type { ExpenseTagSlice } from "./expenses-live";

function slice(name: string, amount: number, documentCount = 1): ExpenseTagSlice {
  return { name, amount, previousAmount: 0, share: 0, documentCount };
}

describe("excludeFocusedTagSlices", () => {
  it("bez focusu prepočíta podiely na súčet výsekov", () => {
    const result = excludeFocusedTagSlices([slice("A", 75), slice("B", 25)], []);

    expect(result.map((item) => item.name)).toEqual(["A", "B"]);
    expect(result[0].share).toBeCloseTo(0.75);
    expect(result[1].share).toBeCloseTo(0.25);
  });

  it("focusnutý štítok medzi výsekmi nenechá a zvyšok prepočíta na 100 %", () => {
    const result = excludeFocusedTagSlices(
      [slice("Zákazka A", 100), slice("Stredisko 1", 60), slice("Stredisko 2", 40)],
      ["Zákazka A"]
    );

    expect(result.map((item) => item.name)).toEqual(["Stredisko 1", "Stredisko 2"]);
    expect(result[0].share).toBeCloseTo(0.6);
    expect(result[1].share).toBeCloseTo(0.4);
  });

  it("vypustí každý focusnutý štítok, aj keď je ich viac", () => {
    const result = excludeFocusedTagSlices(
      [slice("Zákazka A", 100), slice("Stredisko 1", 100), slice("Typ X", 40)],
      ["Zákazka A", "Stredisko 1"]
    );

    expect(result.map((item) => item.name)).toEqual(["Typ X"]);
    expect(result[0].share).toBeCloseTo(1);
  });

  it("keď focusnutý štítok nemá ďalšie členenie, vráti prázdny zoznam", () => {
    expect(excludeFocusedTagSlices([slice("Zákazka A", 100)], ["Zákazka A"])).toEqual([]);
  });

  it("nulový súčet nespôsobí delenie nulou", () => {
    const result = excludeFocusedTagSlices([slice("A", 0), slice("B", 0)], []);

    expect(result.every((item) => item.share === 0)).toBe(true);
  });

  it("záporné sumy sa do súčtu nezapočítajú", () => {
    const result = excludeFocusedTagSlices([slice("A", 100), slice("B", -20)], []);

    expect(result[0].share).toBeCloseTo(1);
    expect(result[1].share).toBe(0);
  });
});
