import { describe, expect, it } from "vitest";
import { buildMonthSyncRanges, getLiveDataRange } from "./month-ranges";

describe("buildMonthSyncRanges", () => {
  it("rozdelí okno na kalendárne mesiace", () => {
    const ranges = buildMonthSyncRanges(
      new Date(2026, 0, 15).toISOString(),
      new Date(2026, 2, 10).toISOString()
    );
    expect(ranges.map((range) => range.monthKey)).toEqual(["2026-01", "2026-02", "2026-03"]);
  });

  it("prvý a posledný mesiac oreže na hranice okna, nie mesiaca", () => {
    const ranges = buildMonthSyncRanges(
      new Date(2026, 0, 15).toISOString(),
      new Date(2026, 1, 10).toISOString()
    );
    expect(new Date(ranges[0].from).getDate()).toBe(15);
    expect(new Date(ranges[1].to).getDate()).toBe(10);
  });

  it("okno v jednom mesiaci dá jediný rozsah", () => {
    const ranges = buildMonthSyncRanges(
      new Date(2026, 4, 2).toISOString(),
      new Date(2026, 4, 20).toISOString()
    );
    expect(ranges).toHaveLength(1);
    expect(ranges[0].monthKey).toBe("2026-05");
  });

  it("okno cez prelom roka nezacyklí a mesiace idú za sebou", () => {
    const ranges = buildMonthSyncRanges(
      new Date(2025, 10, 1).toISOString(),
      new Date(2026, 0, 31).toISOString()
    );
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
