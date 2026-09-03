import { describe, expect, it } from "vitest";

import {
  PREFERENCE_KEYS,
  PREFERENCE_KEY_LIST,
  isTenantKey,
  isValidValue,
  parseStoredValue
} from "@/lib/preferences/registry";
import { migrationFromLocalStorage, resolvePreferences } from "@/lib/preferences/resolve";

describe("resolvePreferences", () => {
  it("osobna hodnota prebije firemnu", () => {
    const resolved = resolvePreferences({
      tenant: { "revenue.companies": ["Firma A"] },
      user: { "revenue.companies": ["Firma B"] }
    });

    expect(resolved.values["revenue.companies"]).toEqual(["Firma B"]);
    expect(resolved.personalKeys).toContain("revenue.companies");
  });

  it("bez osobnej plati firemna", () => {
    const resolved = resolvePreferences({ tenant: { "revenue.companies": ["Firma A"] }, user: {} });

    expect(resolved.values["revenue.companies"]).toEqual(["Firma A"]);
    expect(resolved.personalKeys).not.toContain("revenue.companies");
    expect(resolved.storedKeys).toContain("revenue.companies");
  });

  it("bez oboch plati default z registra", () => {
    const resolved = resolvePreferences({ tenant: {}, user: {} });

    expect(resolved.values["revenue.companies"]).toEqual([]);
    expect(resolved.values["ui.granularity"]).toBe("month");
    expect(resolved.values["ui.collapsed.companies"]).toBe(false);
    expect(resolved.storedKeys).toEqual([]);
  });

  it("prazdny vyber je hodnota, nie chybajuci kluc", () => {
    // Rozdiel medzi „nic som nevybral" a „nic tu este nie je" rozhoduje o migracii:
    // vedome vyprazdneny filter sa nesmie prepisat starou hodnotou z prehliadaca.
    const resolved = resolvePreferences({ tenant: {}, user: { "revenue.companies": [] } });

    expect(resolved.storedKeys).toContain("revenue.companies");
    expect(resolved.personalKeys).toContain("revenue.companies");
  });

  it("neplatna hodnota v ulozisku sa sprava, akoby tam nebola", () => {
    const resolved = resolvePreferences({
      tenant: { "revenue.companies": "nie je pole" },
      user: { "ui.granularity": "storocie" }
    });

    expect(resolved.values["revenue.companies"]).toEqual([]);
    expect(resolved.values["ui.granularity"]).toBe("month");
    expect(resolved.storedKeys).toEqual([]);
  });

  it("vrati hodnotu pre kazdy kluc z registra", () => {
    const resolved = resolvePreferences({ tenant: {}, user: {} });

    expect(Object.keys(resolved.values).sort()).toEqual([...PREFERENCE_KEY_LIST].sort());
  });
});

describe("register urovni", () => {
  it("ergonomia je osobna, nie firemna", () => {
    // Zdielane zbalenie panela alebo granularita by prestavovali obrazovku kolegovi pri
    // kazdom kliknuti. Kto prida dalsi taky kluc, musi sa rozhodnut vedome.
    for (const key of PREFERENCE_KEY_LIST) {
      if (key.startsWith("ui.")) {
        expect(isTenantKey(key)).toBe(false);
      }
    }
  });

  it("filtre su firemne", () => {
    for (const key of ["revenue.companies", "revenue.tagFilters", "expenses.companies", "cashflow.companies"]) {
      expect(isTenantKey(key)).toBe(true);
    }
  });

  it("neznamy kluc neprijme ziadnu hodnotu", () => {
    expect(isValidValue("revenue.evil", ["cokolvek"])).toBe(false);
    expect(isValidValue("__proto__", {})).toBe(false);
  });

  it("kazdy kluc ma vlastny storageKey", () => {
    const storageKeys = PREFERENCE_KEY_LIST.map((key) => PREFERENCE_KEYS[key].storageKey);
    expect(new Set(storageKeys).size).toBe(storageKeys.length);
  });

  it("default kazdeho kluca prejde vlastnou validaciou", () => {
    for (const key of PREFERENCE_KEY_LIST) {
      expect(isValidValue(key, PREFERENCE_KEYS[key].default)).toBe(true);
    }
  });
});

describe("migrationFromLocalStorage", () => {
  it("nahra lokalnu hodnotu, ktoru server nepozna", () => {
    const upload = migrationFromLocalStorage({ "revenue.companies": ["Firma A"] }, []);

    expect(upload).toEqual({ "revenue.companies": ["Firma A"] });
  });

  it("nenahra kluc, ktory server uz ma", () => {
    // Inak by sa zmazany filter vratil z mrtvych pri kazdom otvoreni appky na zariadeni,
    // kde este lezi stara hodnota.
    const upload = migrationFromLocalStorage({ "revenue.companies": ["Firma A"] }, ["revenue.companies"]);

    expect(upload).toEqual({});
  });

  it("nenahra neplatnu lokalnu hodnotu", () => {
    const upload = migrationFromLocalStorage({ "revenue.companies": { nie: "pole" } }, []);

    expect(upload).toEqual({});
  });
});

describe("citanie starych formatov z localStorage", () => {
  it("plochy filter stitkov (pole) sa prevedie na kategorie, nie zahodi", () => {
    // Takto filtre ukladala verzia pred kategoriami. Bez prevodu by ich validacia zahodila
    // ako neplatne a ludom by pri prvom nacitani zmizli.
    const value = parseStoredValue("revenue.tagFilters", JSON.stringify(["Praca", "Material"]));

    expect(value).toEqual({ __all__: ["Praca", "Material"] });
    expect(isValidValue("revenue.tagFilters", value)).toBe(true);
  });

  it("zbalenie ulozene ako 1/0 sa cita ako boolean", () => {
    expect(parseStoredValue("ui.collapsed.companies", "1")).toBe(true);
    expect(parseStoredValue("ui.collapsed.companies", "0")).toBe(false);
  });

  it("1 v poli firiem nie je true, ale neplatna hodnota", () => {
    const value = parseStoredValue("revenue.companies", "1");

    expect(isValidValue("revenue.companies", value)).toBe(false);
  });
});
