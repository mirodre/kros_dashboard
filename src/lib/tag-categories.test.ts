import { describe, expect, it } from "vitest";
import {
  buildTagCategoryIndex,
  documentMatchesTagFilters,
  EMPTY_TAG_CATEGORY_INDEX,
  FLAT_TAG_FILTER_KEY,
  tagFilterKey,
  UNCATEGORIZED_CATEGORY
} from "./tag-categories";

const index = buildTagCategoryIndex([
  { name: "Nájom", category: { name: "Druh" } },
  { name: "Marketing", category: { name: "Druh" } },
  { name: "Projekt A", category: { name: "Projekt" } },
  { name: "Bez kategórie" }
]);

describe("tagFilterKey", () => {
  it("vráti kategóriu štítku, keď kategórie poznáme", () => {
    expect(tagFilterKey(index, "Nájom")).toBe("Druh");
    expect(tagFilterKey(index, "Bez kategórie")).toBe(UNCATEGORIZED_CATEGORY);
  });

  it("bez skutočných kategórií zhrnie štítky do jednej spoločnej sekcie", () => {
    expect(tagFilterKey(EMPTY_TAG_CATEGORY_INDEX, "Nájom")).toBe(FLAT_TAG_FILTER_KEY);
  });
});

describe("documentMatchesTagFilters", () => {
  it("bez filtra a bez focusu prejde každý doklad", () => {
    expect(documentMatchesTagFilters([], {})).toBe(true);
    expect(documentMatchesTagFilters(["Nájom"], {})).toBe(true);
  });

  it("kategórie sa spájajú cez AND, štítky v kategórii cez OR", () => {
    const filters = { Druh: ["Nájom", "Marketing"], Projekt: ["Projekt A"] };

    expect(documentMatchesTagFilters(["Marketing", "Projekt A"], filters)).toBe(true);
    expect(documentMatchesTagFilters(["Marketing"], filters)).toBe(false);
  });

  it("doklad musí niesť všetky focusnuté štítky", () => {
    expect(documentMatchesTagFilters(["Nájom", "Projekt A"], {}, ["Nájom", "Projekt A"])).toBe(true);
    expect(documentMatchesTagFilters(["Nájom"], {}, ["Nájom", "Projekt A"])).toBe(false);
    expect(documentMatchesTagFilters(["Projekt A"], {}, ["Nájom", "Projekt A"])).toBe(false);
  });

  it("focus neignoruje veľkosť písmen ani okolité medzery", () => {
    expect(documentMatchesTagFilters([" nájom "], {}, ["NÁJOM"])).toBe(true);
  });

  it("focus platí spolu s filtrom kategórií", () => {
    const filters = { Projekt: ["Projekt A"] };

    expect(documentMatchesTagFilters(["Nájom", "Projekt A"], filters, ["Nájom"])).toBe(true);
    expect(documentMatchesTagFilters(["Nájom", "Projekt B"], filters, ["Nájom"])).toBe(false);
  });
});
