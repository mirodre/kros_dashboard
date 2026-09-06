import { describe, expect, it } from "vitest";
import { buildMonthSyncRanges, getLiveDataRange } from "./month-ranges";

describe("buildMonthSyncRanges", () => {
  it("rozdelí okno na kalendárne mesiace", () => {
    const ranges = buildMonthSyncRanges("2026-01-15T00:00:00.000Z", "2026-03-10T00:00:00.000Z");
    expect(ranges.map((range) => range.monthKey)).toEqual(["2026-01", "2026-02", "2026-03"]);
  });

  it("prvý a posledný mesiac oreže na hranice okna, nie mesiaca", () => {
    const ranges = buildMonthSyncRanges("2026-01-15T00:00:00.000Z", "2026-02-10T00:00:00.000Z");
    expect(ranges[0].from.slice(0, 10)).toBe("2026-01-15");
    expect(ranges[1].to.slice(0, 10)).toBe("2026-02-10");
  });

  it("okno v jednom mesiaci dá jediný rozsah", () => {
    const ranges = buildMonthSyncRanges("2026-05-02T00:00:00.000Z", "2026-05-20T00:00:00.000Z");
    expect(ranges).toHaveLength(1);
    expect(ranges[0].monthKey).toBe("2026-05");
  });

  it("okno cez prelom roka nezacyklí a mesiace idú za sebou", () => {
    const ranges = buildMonthSyncRanges("2025-11-01T00:00:00.000Z", "2026-01-31T00:00:00.000Z");
    expect(ranges.map((range) => range.monthKey)).toEqual(["2025-11", "2025-12", "2026-01"]);
  });
});

describe("getLiveDataRange", () => {
  it("roky potrebujú históriu, týždne a mesiace stačia od začiatku roka", () => {
    expect(getLiveDataRange("year")).toBe("history");
    expect(getLiveDataRange("month")).toBe("ytd");
    expect(getLiveDataRange("week")).toBe("ytd");
  });
});
