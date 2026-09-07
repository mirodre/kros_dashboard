import { describe, expect, it } from "vitest";
import { focusOutsideDonut, focusedTagNames, reconcileFocusedTags } from "./tag-focus";

describe("reconcileFocusedTags", () => {
  it("novému štítku priradí pôvod kliku", () => {
    expect(reconcileFocusedTags([], ["Zákazka A"], true)).toEqual([
      { tag: "Zákazka A", fromDonut: true }
    ]);
    expect(reconcileFocusedTags([], ["Zákazka A"], false)).toEqual([
      { tag: "Zákazka A", fromDonut: false }
    ]);
  });

  it("štítku, ktorý vo focuse už bol, pôvod nezmení", () => {
    const previous = [{ tag: "Zákazka A", fromDonut: true }];

    expect(reconcileFocusedTags(previous, ["Zákazka A", "Stredisko 1"], false)).toEqual([
      { tag: "Zákazka A", fromDonut: true },
      { tag: "Stredisko 1", fromDonut: false }
    ]);
  });

  it("odobratý štítok vypadne", () => {
    const previous = [
      { tag: "Zákazka A", fromDonut: true },
      { tag: "Stredisko 1", fromDonut: false }
    ];

    expect(reconcileFocusedTags(previous, ["Stredisko 1"], false)).toEqual([
      { tag: "Stredisko 1", fromDonut: false }
    ]);
  });

  it("drží poradie podľa nového zoznamu a duplicitu zahodí", () => {
    const result = reconcileFocusedTags([], ["B", "A", "B"], false);

    expect(result.map((item) => item.tag)).toEqual(["B", "A"]);
  });
});

describe("focusedTagNames / focusOutsideDonut", () => {
  const focused = [
    { tag: "Zákazka A", fromDonut: true },
    { tag: "Stredisko 1", fromDonut: false }
  ];

  it("celý focus zužuje grafy a zoznamy", () => {
    expect(focusedTagNames(focused)).toEqual(["Zákazka A", "Stredisko 1"]);
  });

  it("donut zužuje len focus, ktorý v ňom nevznikol", () => {
    expect(focusOutsideDonut(focused)).toEqual(["Stredisko 1"]);
  });

  it("keď je celý focus z donutu, donut sa nezužuje vôbec", () => {
    expect(focusOutsideDonut([{ tag: "Zákazka A", fromDonut: true }])).toEqual([]);
  });
});
