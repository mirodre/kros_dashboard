import { describe, expect, it } from "vitest";
import { withNormalizedTagShares } from "./expenses-live";
import type { ExpenseTagSlice } from "./expenses-live";

function slice(name: string, amount: number, documentCount = 1): ExpenseTagSlice {
  return { name, amount, previousAmount: 0, share: 0, documentCount };
}

describe("withNormalizedTagShares", () => {
  it("prepočíta podiely na súčet výsekov", () => {
    const result = withNormalizedTagShares([slice("A", 75), slice("B", 25)]);

    expect(result.map((item) => item.name)).toEqual(["A", "B"]);
    expect(result[0].share).toBeCloseTo(0.75);
    expect(result[1].share).toBeCloseTo(0.25);
  });

  it("žiadny výsek nezahodí", () => {
    const input = [slice("A", 100), slice("B", 0), slice("C", 40)];

    expect(withNormalizedTagShares(input).map((item) => item.name)).toEqual(["A", "B", "C"]);
  });

  it("nulový súčet nespôsobí delenie nulou", () => {
    const result = withNormalizedTagShares([slice("A", 0), slice("B", 0)]);

    expect(result.every((item) => item.share === 0)).toBe(true);
  });

  it("záporné sumy sa do súčtu nezapočítajú", () => {
    const result = withNormalizedTagShares([slice("A", 100), slice("B", -20)]);

    expect(result[0].share).toBeCloseTo(1);
    expect(result[1].share).toBe(0);
  });

  it("ostatné polia výseku nechá tak", () => {
    const result = withNormalizedTagShares([
      { name: "A", amount: 100, previousAmount: 80, share: 0.5, documentCount: 7 }
    ]);

    expect(result[0]).toMatchObject({ name: "A", amount: 100, previousAmount: 80, documentCount: 7 });
  });
});
