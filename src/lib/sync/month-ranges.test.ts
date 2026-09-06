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

    // Začiatok okna: startOfDayIso musí cieliť na miestnu 00:00:00.000, nielen na správny deň.
    const windowStart = new Date(ranges[0].from);
    expect(windowStart.getDate()).toBe(15);
    expect(windowStart.getHours()).toBe(0);
    expect(windowStart.getMinutes()).toBe(0);
    expect(windowStart.getSeconds()).toBe(0);
    expect(windowStart.getMilliseconds()).toBe(0);

    // Koniec okna: endOfDayIso musí cieliť na miestnu 23:59:59.999, nielen na správny deň
    // (getDate() samo osebe by pri UTC posune stále vrátilo 10 aj pri zle vypočítanom čase).
    const windowEnd = new Date(ranges[1].to);
    expect(windowEnd.getDate()).toBe(10);
    expect(windowEnd.getHours()).toBe(23);
    expect(windowEnd.getMinutes()).toBe(59);
    expect(windowEnd.getSeconds()).toBe(59);
    expect(windowEnd.getMilliseconds()).toBe(999);
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
