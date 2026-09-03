import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createPreferenceStore } from "@/lib/preferences/store";

type Call = { url: string; method: string; body: unknown };

function fakeStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    map
  };
}

function fakeFetch(responder?: (call: Call) => { ok?: boolean; body?: unknown }) {
  const calls: Call[] = [];

  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const call: Call = {
      url: String(input),
      method: init?.method ?? "GET",
      body: init?.body ? JSON.parse(String(init.body)) : undefined
    };
    calls.push(call);

    const result = responder?.(call) ?? {};
    return {
      ok: result.ok ?? true,
      json: async () => result.body ?? {}
    } as Response;
  }) as unknown as typeof fetch;

  return { fetchImpl, calls };
}

function serverPayload(overrides: Record<string, unknown> = {}) {
  return {
    values: {},
    personalKeys: [],
    storedKeys: [],
    tenantMeta: null,
    isPersonalFallback: false,
    ...overrides
  };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("citanie z localStorage", () => {
  it("prvy snapshot ma hodnoty z prehliadaca, bez cakania na siet", () => {
    const storage = fakeStorage({
      kros_dashboard_revenue_selected_companies: JSON.stringify(["Firma A"])
    });
    const { fetchImpl, calls } = fakeFetch();

    const store = createPreferenceStore({ storage, fetchImpl, debounceMs: 800 });

    expect(store.getSnapshot().values["revenue.companies"]).toEqual(["Firma A"]);
    // Ziadny request sa este nestal — inak by prvy paint cakal na server.
    expect(calls).toHaveLength(0);
  });

  it("prezije stary format zbalenia (1/0), nie len JSON", () => {
    // `usePersistedCollapsed` zapisoval "1"/"0". Bez toho by sa vsetkym pri prvom nacitani
    // vsetky panely rozbalili.
    const storage = fakeStorage({ kros_dashboard_collapsed_companies: "1" });
    const { fetchImpl } = fakeFetch();

    const store = createPreferenceStore({ storage, fetchImpl, debounceMs: 800 });

    expect(store.getSnapshot().values["ui.collapsed.companies"]).toBe(true);
  });

  it("nezmyselna hodnota v ulozisku spadne na default", () => {
    const storage = fakeStorage({ kros_dashboard_revenue_selected_companies: "{{nie json" });
    const { fetchImpl } = fakeFetch();

    const store = createPreferenceStore({ storage, fetchImpl, debounceMs: 800 });

    expect(store.getSnapshot().values["revenue.companies"]).toEqual([]);
  });
});

describe("zapis", () => {
  it("zapisuje do localStorage a do stavu okamzite", () => {
    const storage = fakeStorage();
    const { fetchImpl } = fakeFetch();
    const store = createPreferenceStore({ storage, fetchImpl, debounceMs: 800 });

    store.set("revenue.companies", ["Firma A"]);

    expect(store.getSnapshot().values["revenue.companies"]).toEqual(["Firma A"]);
    expect(storage.map.get("kros_dashboard_revenue_selected_companies")).toBe('["Firma A"]');
  });

  it("rychle klikanie posle jeden PATCH, nie dvadsat", async () => {
    const storage = fakeStorage();
    const { fetchImpl, calls } = fakeFetch();
    const store = createPreferenceStore({ storage, fetchImpl, debounceMs: 800 });

    store.set("revenue.companies", ["A"]);
    store.set("revenue.companies", ["A", "B"]);
    store.set("ui.granularity", "year");

    await vi.advanceTimersByTimeAsync(900);

    const patches = calls.filter((call) => call.method === "PATCH");
    expect(patches).toHaveLength(1);
    expect(patches[0].body).toEqual({ "revenue.companies": ["A", "B"], "ui.granularity": "year" });
  });

  it("okno debounce sa posuva pri kazdej zmene, nie od prvej", async () => {
    // Bez posunutia okna by sa odoslalo uprostred klikania a zvysok by isiel druhym
    // requestom — teda presne to, comu sa zlucovanie zapisov ma vyhnut.
    const storage = fakeStorage();
    const { fetchImpl, calls } = fakeFetch();
    const store = createPreferenceStore({ storage, fetchImpl, debounceMs: 800 });

    store.set("revenue.companies", ["A"]);
    await vi.advanceTimersByTimeAsync(500);
    store.set("revenue.companies", ["A", "B"]);
    await vi.advanceTimersByTimeAsync(500);

    expect(calls.filter((call) => call.method === "PATCH")).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(400);

    const patches = calls.filter((call) => call.method === "PATCH");
    expect(patches).toHaveLength(1);
    expect(patches[0].body).toEqual({ "revenue.companies": ["A", "B"] });
  });

  it("neplatna hodnota sa nezapise vobec", () => {
    const storage = fakeStorage();
    const { fetchImpl } = fakeFetch();
    const store = createPreferenceStore({ storage, fetchImpl, debounceMs: 800 });

    // @ts-expect-error — presne to, co by sem doniesol regresny bug v komponente
    store.set("ui.granularity", "storocie");

    expect(store.getSnapshot().values["ui.granularity"]).toBe("month");
  });

  it("zlyhany zapis nezmaze hodnotu a posle sa s dalsou zmenou", async () => {
    const storage = fakeStorage();
    let failing = true;
    const { fetchImpl, calls } = fakeFetch((call) =>
      call.method === "PATCH" && failing ? { ok: false } : { ok: true }
    );
    const store = createPreferenceStore({ storage, fetchImpl, debounceMs: 800 });

    store.set("revenue.companies", ["A"]);
    await store.flush();

    expect(store.getSnapshot().values["revenue.companies"]).toEqual(["A"]);

    failing = false;
    store.set("ui.granularity", "week");
    await store.flush();

    const posledny = calls.filter((call) => call.method === "PATCH").at(-1);
    // Zlyhana hodnota sa vezme so sebou; novsia ma prednost.
    expect(posledny?.body).toEqual({ "revenue.companies": ["A"], "ui.granularity": "week" });
  });
});

describe("nacitanie zo servera", () => {
  it("serverova hodnota prepise lokalnu", async () => {
    const storage = fakeStorage({
      kros_dashboard_revenue_selected_companies: JSON.stringify(["Stara"])
    });
    const { fetchImpl } = fakeFetch(() => ({
      body: serverPayload({
        values: { "revenue.companies": ["Nova"] },
        storedKeys: ["revenue.companies"],
        personalKeys: ["revenue.companies"]
      })
    }));
    const store = createPreferenceStore({ storage, fetchImpl, debounceMs: 800 });

    await store.load();

    expect(store.getSnapshot().values["revenue.companies"]).toEqual(["Nova"]);
    expect(store.getSnapshot().personalKeys).toContain("revenue.companies");
    expect(storage.map.get("kros_dashboard_revenue_selected_companies")).toBe('["Nova"]');
  });

  it("kluc, ktory server nepozna, ostava lokalny", async () => {
    const storage = fakeStorage({ kros_dashboard_granularity: JSON.stringify("year") });
    const { fetchImpl } = fakeFetch(() => ({ body: serverPayload() }));
    const store = createPreferenceStore({ storage, fetchImpl, debounceMs: 800 });

    await store.load();

    expect(store.getSnapshot().values["ui.granularity"]).toBe("year");
  });

  it("nedostupny server necha lokalny stav a nespadne", async () => {
    const storage = fakeStorage({ kros_dashboard_granularity: JSON.stringify("week") });
    const fetchImpl = (async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    const store = createPreferenceStore({ storage, fetchImpl, debounceMs: 800 });

    await store.load();

    expect(store.getSnapshot().values["ui.granularity"]).toBe("week");
    expect(store.getSnapshot().isLoaded).toBe(false);
  });
});

describe("migracia z localStorage", () => {
  it("nahra lokalne nastavenia, ktore server nepozna", async () => {
    const storage = fakeStorage({
      kros_dashboard_revenue_selected_companies: JSON.stringify(["Firma A"])
    });
    const { fetchImpl, calls } = fakeFetch((call) =>
      call.method === "GET" ? { body: serverPayload() } : { ok: true }
    );
    const store = createPreferenceStore({ storage, fetchImpl, debounceMs: 800 });

    await store.load();

    const patch = calls.find((call) => call.method === "PATCH");
    expect(patch?.body).toEqual({ "revenue.companies": ["Firma A"] });
    // Do OSOBNEJ urovne: firemnu by prvy clovek po nasadeni prestavil celej firme.
    expect(patch?.url).toBe("/api/preferences");
  });

  it("nenahra to, co server uz ma", async () => {
    const storage = fakeStorage({
      kros_dashboard_revenue_selected_companies: JSON.stringify(["Stara"])
    });
    const { fetchImpl, calls } = fakeFetch((call) =>
      call.method === "GET"
        ? { body: serverPayload({ values: { "revenue.companies": [] }, storedKeys: ["revenue.companies"] }) }
        : { ok: true }
    );
    const store = createPreferenceStore({ storage, fetchImpl, debounceMs: 800 });

    await store.load();

    // Vedome vyprazdneny filter sa nesmie prepisat starou hodnotou z tohto prehliadaca.
    expect(calls.filter((call) => call.method === "PATCH")).toHaveLength(0);
    expect(store.getSnapshot().values["revenue.companies"]).toEqual([]);
  });

  it("druhe nacitanie uz nemigruje", async () => {
    const storage = fakeStorage({
      kros_dashboard_revenue_selected_companies: JSON.stringify(["Firma A"])
    });
    const { fetchImpl, calls } = fakeFetch((call) =>
      call.method === "GET" ? { body: serverPayload() } : { ok: true }
    );
    const store = createPreferenceStore({ storage, fetchImpl, debounceMs: 800 });

    await store.load();
    await store.load();

    expect(calls.filter((call) => call.method === "PATCH")).toHaveLength(1);
  });

  it("zlyhana migracia sa priznakom neoznaci a skusi znova", async () => {
    const storage = fakeStorage({
      kros_dashboard_revenue_selected_companies: JSON.stringify(["Firma A"])
    });
    const { fetchImpl, calls } = fakeFetch((call) =>
      call.method === "GET" ? { body: serverPayload() } : { ok: false }
    );
    const store = createPreferenceStore({ storage, fetchImpl, debounceMs: 800 });

    await store.load();
    await store.load();

    expect(calls.filter((call) => call.method === "PATCH")).toHaveLength(2);
    expect(storage.map.get("kros_dashboard_prefs_migrated_v1")).toBeUndefined();
  });
});

describe("firemne predvolene", () => {
  it("zdielanie posle aktualne hodnoty na tenant endpoint", async () => {
    const storage = fakeStorage();
    const { fetchImpl, calls } = fakeFetch((call) =>
      call.method === "GET" ? { body: serverPayload() } : { ok: true }
    );
    const store = createPreferenceStore({ storage, fetchImpl, debounceMs: 800 });

    store.set("revenue.companies", ["Firma A"]);
    await store.shareWithTenant(["revenue.companies"]);

    const put = calls.find((call) => call.method === "PUT");
    expect(put?.url).toBe("/api/preferences/tenant");
    expect(put?.body).toEqual({ "revenue.companies": ["Firma A"] });
  });

  it("navrat na firemne posle DELETE so zoznamom klucov", async () => {
    const storage = fakeStorage();
    const { fetchImpl, calls } = fakeFetch((call) =>
      call.method === "GET" ? { body: serverPayload() } : { ok: true }
    );
    const store = createPreferenceStore({ storage, fetchImpl, debounceMs: 800 });

    await store.resetToTenant(["revenue.companies"]);

    const del = calls.find((call) => call.method === "DELETE");
    expect(del?.body).toEqual({ keys: ["revenue.companies"] });
  });

  it("cakajuci zapis sa doposle pred zdielanim", async () => {
    // Inak by sa firme nastavila hodnota, ktoru clovek prave prepisal a este neodoslal.
    const storage = fakeStorage();
    const { fetchImpl, calls } = fakeFetch((call) =>
      call.method === "GET" ? { body: serverPayload() } : { ok: true }
    );
    const store = createPreferenceStore({ storage, fetchImpl, debounceMs: 800 });

    store.set("revenue.companies", ["Firma A"]);
    await store.shareWithTenant(["revenue.companies"]);

    const poradie = calls.map((call) => call.method);
    expect(poradie.indexOf("PATCH")).toBeLessThan(poradie.indexOf("PUT"));
  });
});

describe("preteky medzi zmenou a odpovedou servera", () => {
  it("zmena spravena pred odpovedou servera neprepise spat", async () => {
    // Clovek klikne vo filtri v prvej sekunde po otvoreni stranky. Odpoved GET-u nesmie
    // jeho zmenu prepisat — na server ju aj tak o chvilu posle debounce, takze by vzniknol
    // rozpor medzi tym, co vidi, a tym, co je ulozene.
    const storage = fakeStorage();
    const { fetchImpl } = fakeFetch((call) =>
      call.method === "GET"
        ? {
            body: serverPayload({
              values: { "revenue.companies": ["Serverova"] },
              storedKeys: ["revenue.companies"]
            })
          }
        : { ok: true }
    );
    const store = createPreferenceStore({ storage, fetchImpl, debounceMs: 800 });

    store.set("revenue.companies", ["Moja"]);
    await store.load();

    expect(store.getSnapshot().values["revenue.companies"]).toEqual(["Moja"]);
  });

  it("kluc bez cakajucej zmeny sa serverovou hodnotou prepise", async () => {
    const storage = fakeStorage();
    const { fetchImpl } = fakeFetch((call) =>
      call.method === "GET"
        ? {
            body: serverPayload({
              values: { "revenue.companies": ["Serverova"], "ui.granularity": "year" },
              storedKeys: ["revenue.companies", "ui.granularity"]
            })
          }
        : { ok: true }
    );
    const store = createPreferenceStore({ storage, fetchImpl, debounceMs: 800 });

    store.set("revenue.companies", ["Moja"]);
    await store.load();

    expect(store.getSnapshot().values["ui.granularity"]).toBe("year");
  });
});
