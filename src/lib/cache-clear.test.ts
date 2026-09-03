import { describe, expect, it } from "vitest";

import { CLEARED_LOCAL_KEYS, PROTECTED_PREFERENCE_KEYS, clearLocalDataCacheKeys } from "@/lib/cache-clear";

describe("vymazanie cache dat", () => {
  it("nezmaze ziadne nastavenie", () => {
    // Rozhodnutie z 3.9.2026: tlacidlo maze len doklady stiahnute z KROS API a stav syncu.
    for (const storageKey of PROTECTED_PREFERENCE_KEYS) {
      expect(CLEARED_LOCAL_KEYS).not.toContain(storageKey);
    }
  });

  it("zmaze stav synchronizacie", () => {
    const removed: string[] = [];
    clearLocalDataCacheKeys({ removeItem: (key: string) => void removed.push(key) });

    expect(removed).toContain("kros_dashboard_last_sync_at");
  });

  it("filtre v ulozisku prezijú", () => {
    const map = new Map<string, string>([
      ["kros_dashboard_revenue_selected_companies", '["Firma A"]'],
      ["kros_dashboard_last_sync_at", "2026-09-03T10:00:00.000Z"]
    ]);

    clearLocalDataCacheKeys({ removeItem: (key: string) => void map.delete(key) });

    expect(map.get("kros_dashboard_revenue_selected_companies")).toBe('["Firma A"]');
    expect(map.has("kros_dashboard_last_sync_at")).toBe(false);
  });
});
