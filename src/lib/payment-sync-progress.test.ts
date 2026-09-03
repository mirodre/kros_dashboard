import { describe, expect, it } from "vitest";

import {
  estimatePaymentSyncProgress,
  formatPaymentPeriodLabel,
  readPaymentBookedAt,
  readTotalCount,
  trackPaymentDateSpan
} from "./payment-sync-progress";

const NOW = new Date("2026-09-03T12:00:00Z");

describe("readPaymentBookedAt", () => {
  it("prečíta dátum bez ohľadu na veľkosť prvého znaku kľúča", () => {
    expect(readPaymentBookedAt({ BookedAt: "2024-03-14" })).toBe("2024-03-14");
    expect(readPaymentBookedAt({ bookedAt: " 2024-03-14 " })).toBe("2024-03-14");
    expect(readPaymentBookedAt({ dateOfPayment: "2024-03-14" })).toBe("2024-03-14");
  });

  it("bez dátumu a pri nesprávnom type vráti undefined", () => {
    expect(readPaymentBookedAt({ bookedAt: "" })).toBeUndefined();
    expect(readPaymentBookedAt({ bookedAt: 20240314 })).toBeUndefined();
    expect(readPaymentBookedAt(null)).toBeUndefined();
  });
});

describe("estimatePaymentSyncProgress", () => {
  it("s celkovým počtom z API počíta priamo z položiek", () => {
    const { fraction } = estimatePaymentSyncProgress(
      { loaded: 300, total: 1200 },
      { now: NOW }
    );
    expect(fraction).toBeCloseTo(0.25, 5);
  });

  it("pri vzostupnom poradí rastie s posunom hranice k dnešku", () => {
    // Dva roky histórie, hranica je v polovici cesty.
    const half = estimatePaymentSyncProgress(
      {
        loaded: 500,
        oldest: "2024-09-03",
        newest: "2025-09-03",
        frontier: "2025-09-03"
      },
      { now: NOW }
    );
    expect(half.fraction).toBeCloseTo(0.5, 1);

    const almostDone = estimatePaymentSyncProgress(
      {
        loaded: 900,
        oldest: "2024-09-03",
        newest: "2026-09-01",
        frontier: "2026-09-01"
      },
      { now: NOW }
    );
    expect(almostDone.fraction).toBeGreaterThan(half.fraction);
    expect(almostDone.fraction).toBeCloseTo(0.97, 2);
  });

  it("pri zostupnom poradí rastie s posunom hranice do minulosti", () => {
    const early = estimatePaymentSyncProgress(
      {
        loaded: 100,
        oldest: "2026-06-03",
        newest: "2026-09-03",
        frontier: "2026-06-03"
      },
      { now: NOW }
    );
    const later = estimatePaymentSyncProgress(
      {
        loaded: 900,
        oldest: "2023-09-03",
        newest: "2026-09-03",
        frontier: "2023-09-03"
      },
      { now: NOW }
    );
    expect(early.fraction).toBeGreaterThan(0);
    expect(early.fraction).toBeLessThan(0.1);
    expect(later.fraction).toBeGreaterThan(0.5);
  });

  it("nezoradené dáta meria pokrytým rozpätím", () => {
    const { fraction } = estimatePaymentSyncProgress(
      {
        loaded: 400,
        oldest: "2024-03-03",
        newest: "2026-09-03",
        frontier: "2025-01-15"
      },
      { now: NOW }
    );
    expect(fraction).toBeGreaterThan(0.4);
    expect(fraction).toBeLessThan(0.6);
  });

  it("nikdy neklesne pod už dosiahnutý odhad", () => {
    const { fraction } = estimatePaymentSyncProgress(
      {
        loaded: 200,
        oldest: "2024-09-03",
        newest: "2024-10-03",
        frontier: "2024-10-03"
      },
      { now: NOW, previousFraction: 0.62 }
    );
    expect(fraction).toBe(0.62);
  });

  it("počas behu nikdy neukáže celok", () => {
    const { fraction } = estimatePaymentSyncProgress(
      { loaded: 1200, total: 1200 },
      { now: NOW }
    );
    expect(fraction).toBe(0.97);
  });

  it("bez použiteľných dátumov drží nulu a nehádže", () => {
    const { fraction, periodLabel } = estimatePaymentSyncProgress(
      { loaded: 42 },
      { now: NOW }
    );
    expect(fraction).toBe(0);
    expect(periodLabel).toBeUndefined();
  });

  it("hlási obdobie, v ktorom sťahovanie práve je", () => {
    const { periodLabel } = estimatePaymentSyncProgress(
      {
        loaded: 100,
        oldest: "2024-01-03",
        newest: "2024-03-14",
        frontier: "2024-03-14"
      },
      { now: NOW }
    );
    expect(periodLabel).toBe(formatPaymentPeriodLabel("2024-03-14"));
    expect(periodLabel).toContain("2024");
  });
});

describe("readTotalCount", () => {
  it("prečíta celkový počet z bežných variantov názvu", () => {
    expect(readTotalCount({ totalCount: 1200 })).toBe(1200);
    expect(readTotalCount({ Total: 7 })).toBe(7);
    expect(readTotalCount({ "@odata.count": 0 })).toBe(0);
    expect(readTotalCount({ paging: { count: 42 } })).toBe(42);
  });

  it("neplatné a chýbajúce hodnoty ignoruje", () => {
    expect(readTotalCount({ totalCount: "1200" })).toBeUndefined();
    expect(readTotalCount({ total: -1 })).toBeUndefined();
    expect(readTotalCount({ total: Number.NaN })).toBeUndefined();
    expect(readTotalCount([1, 2, 3])).toBeUndefined();
    expect(readTotalCount(null)).toBeUndefined();
  });
});

describe("trackPaymentDateSpan", () => {
  it("drží krajné dátumy a hranicu na poslednej položke stránky", () => {
    const first = trackPaymentDateSpan({}, [
      { bookedAt: "2024-01-10" },
      { bookedAt: "2024-02-20" }
    ]);
    expect(first).toEqual({
      oldest: "2024-01-10",
      newest: "2024-02-20",
      frontier: "2024-02-20"
    });

    const second = trackPaymentDateSpan(first, [
      { bookedAt: "2023-12-01" },
      { bookedAt: "2024-03-05" }
    ]);
    expect(second).toEqual({
      oldest: "2023-12-01",
      newest: "2024-03-05",
      frontier: "2024-03-05"
    });
  });

  it("pohyby bez čitateľného dátumu rozpätie nezmenia", () => {
    const span = trackPaymentDateSpan({}, [{ id: "x" }, { bookedAt: "nezmysel" }, null]);
    expect(span).toEqual({});
  });

  it("celé stránkovanie vzostupných dát dá rastúci odhad, ktorý neklesne", () => {
    const pages = [
      [{ bookedAt: "2024-01-05" }, { bookedAt: "2024-04-05" }],
      [{ bookedAt: "2024-07-05" }, { bookedAt: "2025-01-05" }],
      [{ bookedAt: "2025-07-05" }, { bookedAt: "2026-08-30" }]
    ];

    let span = {};
    let fraction = 0;
    const seen: number[] = [];
    for (const page of pages) {
      span = trackPaymentDateSpan(span, page);
      const estimate = estimatePaymentSyncProgress(
        { loaded: seen.length * 2 + page.length, ...span },
        { now: NOW, previousFraction: fraction }
      );
      fraction = estimate.fraction;
      seen.push(fraction);
    }

    expect(seen).toEqual([...seen].sort((a, b) => a - b));
    expect(seen[0]).toBeLessThan(0.2);
    expect(seen[seen.length - 1]).toBeGreaterThan(0.9);
  });
});
