import { describe, expect, it } from "vitest";
import { getMaxLastModified, withLastModifiedOverlap } from "./last-modified";

describe("withLastModifiedOverlap", () => {
  it("posunie čas o 5 minút späť a vráti ho bez zóny", () => {
    expect(withLastModifiedOverlap("2026-09-06T10:00:00.000Z")).toBe("2026-09-06T09:55:00");
  });

  // Overené priamo proti KROS API na tej istej firme: značka `...T14:48:29.2`
  // (aj `...29.200`) vrátila všetkých 433 dokladov, `...T14:48:29` jeden. Zlomok
  // sekundy teda API neparsuje a filter potichu zahodí — a z inkrementálneho
  // doťahovania sa stane plné sťahovanie na každom refreshi.
  it("zlomok sekundy zahodí — s ním KROS API filter ignoruje", () => {
    expect(withLastModifiedOverlap("2026-09-06T10:00:00.120Z")).toBe("2026-09-06T09:55:00");
  });

  it("sekundy zaokrúhľuje dole, nie hore — okno sa smie len rozšíriť", () => {
    expect(withLastModifiedOverlap("2026-09-06T10:00:00.999Z")).toBe("2026-09-06T09:55:00");
  });

  it("neplatný vstup vráti nezmenený — radšej nič než posunuté okno", () => {
    expect(withLastModifiedOverlap("nezmysel")).toBe("nezmysel");
  });
});

describe("getMaxLastModified", () => {
  it("vráti najnovšiu značku", () => {
    const items = [
      { lastModifiedTimestamp: "2026-09-01T00:00:00Z" },
      { lastModifiedTimestamp: "2026-09-05T00:00:00Z" },
      { lastModifiedTimestamp: "2026-09-03T00:00:00Z" }
    ];
    expect(getMaxLastModified(items)).toBe("2026-09-05T00:00:00Z");
  });

  it("položky bez značky preskočí", () => {
    expect(getMaxLastModified([{}, { lastModifiedTimestamp: "2026-09-01T00:00:00Z" }, {}])).toBe(
      "2026-09-01T00:00:00Z"
    );
  });

  it("bez položiek vráti fallback — inkrementálny sync nesmie zabudnúť, kde skončil", () => {
    expect(getMaxLastModified([], "2026-08-01T00:00:00Z")).toBe("2026-08-01T00:00:00Z");
  });

  it("fallback prekoná, len ak je položka novšia", () => {
    const items = [{ lastModifiedTimestamp: "2026-07-01T00:00:00Z" }];
    expect(getMaxLastModified(items, "2026-08-01T00:00:00Z")).toBe("2026-08-01T00:00:00Z");
  });
});
