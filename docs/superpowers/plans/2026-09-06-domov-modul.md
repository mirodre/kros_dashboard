# Modul Domov — implementačný plán

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Postaviť modul Domov ako hlavnú obrazovku, ktorá skladá zisk, pohľadávky, hotovosť a odhad DPH z dát, ktoré už majú stiahnuté ostatné moduly — bez jediného duplicitného volania KROS API.

**Architecture:** Sync efekty troch stránok sa vytiahnu do „enginov" (`plan()` + `run()`) a jedného orchestrátora, ktorý ich plány zreťazí a poháňa jeden ukazovateľ priebehu. `syncMeta` v IndexedDB tým ostáva jediným zdrojom pravdy o tom, čo je stiahnuté, takže Domov nemá ako stiahnuť to, čo modul už má. Nad zlúčenými dátami stojí `home-live.ts` — čisté funkcie bez Reactu — a nad ním nová stránka.

**Tech Stack:** Next.js 16 (App Router, client components), React 19, TypeScript 5.8, vitest (environment `node`), IndexedDB, CSS v jedinom `src/app/globals.css`.

**Spec:** [docs/superpowers/specs/2026-09-06-domov-modul-design.md](../specs/2026-09-06-domov-modul-design.md)

## Global Constraints

- Vetva: `feat/domov-modul`. Commituj po každej úlohe.
- Testy sú `src/**/*.test.ts`, spúšťa ich `npm test` (vitest, `environment: "node"`). **Žiadne testy komponentov** — jsdom v projekte nie je. Testuje sa `src/lib/**`, nie `src/components/**` ani `src/app/**`.
- Alias `@/` = `src/`. Používaj ho vo všetkých importoch medzi modulmi.
- Všetky texty pre používateľa sú **po slovensky**. Komentáre v kóde po slovensky, v štýle okolitého kódu: vysvetľujú *prečo*, nie *čo*.
- Nepridávaj žiadnu npm závislosť. Grafy sú ručné CSS/SVG, tak ako doteraz.
- `DB_VERSION` v cache moduloch meň **jedným atomickým editom na súbor** — pri bežiacom HMR by rozdelený edit nechal živú stránku vykonať medzistav a cache by sa premazala dvakrát.
- Súbory s escapemi (`\`) píš cez Write/Edit, nie cez bash heredoc — heredoc ich v tomto prostredí komolí.
- Dev server nespúšťaj cez Bash. Používaj Browser pane (`preview_start`). Lokálny dev server bez `AUTH_SERVICE_URL` v `.env` vracia 500 — UI over cez dočasnú route alebo cez `javascript_tool`.
- Po každej úlohe, ktorá mení správanie modulu, spusti `npm test` **aj** `npx tsc --noEmit`.
- Pri presunoch kódu („Move: `src/app/page.tsx:200-330`") presúvaj **doslovne aj s komentármi**. Komentáre v tomto projekte nesú rozhodnutia, ktoré sa inde nedajú dohľadať.

---

## Prehľad úloh

| # | Úloha | Fáza |
|---|---|---|
| 1 | Vzorkovanie payloadu z KROS API | 0 |
| 2 | Zdieľané pomôcky sync vrstvy + typy | 1 |
| 3 | Orchestrátor `useSyncOrchestrator` | 1 |
| 4 | `invoice-engine` + prepnutie Príjmov | 1 |
| 5 | `expense-engine` + prepnutie Výdavkov | 1 |
| 6 | `cashflow-engine` + prepnutie Financií | 1 |
| 7 | Routing `/prijmy` + päťpoložkové menu | 2 |
| 8 | Faktúry: splatnosť, stav úhrady, DPH, oprava sumy | 3 |
| 9 | Výdavky: DPH | 3 |
| 10 | `home-live`: séria a KPI zisku | 4 |
| 11 | `home-live`: pohľadávky a záväzky | 4 |
| 12 | `home-live`: odhad DPH | 4 |
| 13 | `home-live`: zisk podľa štítkov a firiem | 4 |
| 14 | Komponent grafu zisku (nulová os + čiara) | 5 |
| 15 | Stránka Domov + panel Zisk firmy | 5 |
| 16 | Karta Peniaze na účtoch | 5 |
| 17 | Karta Pohľadávky a záväzky | 5 |
| 18 | Karta Odhad DPH | 5 |
| 19 | Sekcie Zisk podľa štítkov a podľa firiem | 5 |
| 20 | Demo režim Domova | 5 |

---

## Fáza 0 — zistiť skutočný tvar dát

### Task 1: Vzorkovanie payloadu z KROS API

Názvy polí pre splatnosť, stav úhrady a DPH na faktúrach **nie sú overené** — `IntegrationApiGuide.md` pokrýva len súhlasový flow a v `runtime-logs/kros-api-log.json` sú len chybové payloady. Táto úloha ich zistí. Bez nej sa úlohy 8, 9 a 12 píšu naslepo.

**Files:**
- Modify: `src/app/api/kros/invoices/route.ts` (vo `fetchCompanyInvoices`, po naplnení `items`)
- Modify: `src/app/api/kros/expenses/route.ts` (v mieste, kde sa hlavičky spájajú s detailom)
- Modify: `.env.example`
- Create: `docs/superpowers/plans/2026-09-06-domov-kros-polia.md`

**Interfaces:**
- Consumes: nič
- Produces: `docs/superpowers/plans/2026-09-06-domov-kros-polia.md` — dokument so skutočnými názvami polí, ktorý čítajú úlohy 8, 9 a 12.

- [ ] **Step 1: Pridaj env prepínač do `.env.example`**

Na koniec tabuľky premenných v `.env.example` doplň:

```
# Dočasné: zaloguje prvú položku každej stránky odpovede z KROS API do
# runtime-logs/kros-api-log.json. Slúži na zistenie názvov polí (splatnosť,
# stav úhrady, DPH). NEZAPÍNAJ na produkcii — do logu sa dostanú účtovné dáta.
KROS_LOG_SAMPLE_PAYLOAD=
```

- [ ] **Step 2: Zaloguj vzorku faktúry**

V `src/app/api/kros/invoices/route.ts`, vo funkcii `fetchCompanyInvoices`, hneď za riadok `aggregated.push(...items);` vlož:

```ts
    // Dočasná diagnostika (KROS_LOG_SAMPLE_PAYLOAD): potrebujeme zistiť, ako sa
    // v odpovedi volajú polia splatnosti, stavu úhrady a DPH. Odstrániť, keď to
    // bude zapísané v docs/superpowers/plans/2026-09-06-domov-kros-polia.md.
    if (process.env.KROS_LOG_SAMPLE_PAYLOAD && skip === 0 && items.length > 0) {
      await appendKrosLog({
        direction: "response",
        endpoint: "/api/invoices",
        method: "GET",
        companyName: company.companyName,
        message: "VZORKA: prvá faktúra zo stránky",
        payload: items[0]
      });
    }
```

- [ ] **Step 3: Zaloguj vzorku výdavku**

V `src/app/api/kros/expenses/route.ts` nájdi miesto, kde sa hlavička doplní o detail (`expenses[index] = { ...expense, journalItems: detail.journalItems ?? [] };`). Hneď za blok `await Promise.all(...)`, ktorý dotiahne detaily, vlož:

```ts
  // Dočasná diagnostika (KROS_LOG_SAMPLE_PAYLOAD) — rovnaký účel ako pri faktúrach.
  if (process.env.KROS_LOG_SAMPLE_PAYLOAD && expenses.length > 0) {
    await appendKrosLog({
      direction: "response",
      endpoint: "/api/expenses/{id}",
      method: "GET",
      companyName: company.companyName,
      message: "VZORKA: prvý výdavok aj s detailom",
      payload: expenses[0]
    });
  }
```

Ak `company` v tom rozsahu nie je dostupné, vynechaj pole `companyName` — je voliteľné.

- [ ] **Step 4: Over, že sa to skompiluje**

Run: `npx tsc --noEmit`
Expected: bez chýb.

- [ ] **Step 5: Zober vzorku (vyžaduje človeka)**

Toto je jediný krok plánu, ktorý nevieš dokončiť sám. Povedz používateľovi presne toto:

> Do `.env` si daj `KROS_LOG_SAMPLE_PAYLOAD=1`, reštartuj dev server, otvor Príjmy aj Výdavky a v každom klikni na obnovenie (ikona vpravo hore). Potom mi daj vedieť.

Počkaj na odpoveď. **Nepokračuj a nič si nedomýšľaj** — vymyslené názvy polí by prešli typovou kontrolou aj testami a zlyhali by až na živých dátach, kde by ticho vyrábali nuly.

- [ ] **Step 6: Prečítaj zistené polia**

Nájdi v logu obe vzorky:

```bash
grep -n "VZORKA" runtime-logs/kros-api-log.json
```

Z payloadov vypíš, ako sa naozaj volajú (a či vôbec existujú):
- na faktúre: dátum splatnosti, stav úhrady (kód alebo reťazec?), suma DPH a v ktorej cenovej skupine (`prices.legislativePrices` / `prices.documentPrices`) leží
- na výdavku: suma DPH a v ktorej skupine

- [ ] **Step 7: Zapíš zistenia**

Vytvor `docs/superpowers/plans/2026-09-06-domov-kros-polia.md` s týmto tvarom (hodnoty doplň zo Step 6):

```markdown
# KROS API — polia potrebné pre Domov

Zistené: 2026-09-06, zo vzoriek v `runtime-logs/kros-api-log.json`.

## Faktúra (`GET /api/invoices`)

| Údaj | Cesta v payloade | Existuje? |
|---|---|---|
| dátum splatnosti | | |
| stav úhrady | | |
| suma DPH | | |

Kódovanie stavu úhrady: (čísla a ich význam, alebo „reťazec")

## Výdavok (`GET /api/expenses/{id}`)

| Údaj | Cesta v payloade | Existuje? |
|---|---|---|
| suma DPH | | |

## Dôsledky

(Pre každé pole, ktoré NEEXISTUJE, napíš, ktorá sekcia Domova preto ukáže
„Údaj z KROS nedostupný": pohľadávky = splatnosť + stav úhrady, DPH = suma DPH.)
```

- [ ] **Step 8: Vypni diagnostiku a commitni**

Nechaj kód aj env prepínač na mieste (bez zapnutej premennej nerobí nič a pri ďalšej zmene API sa zíde), ale over, že `KROS_LOG_SAMPLE_PAYLOAD` **nie je** v commite v `.env`.

```bash
git add .env.example src/app/api/kros/invoices/route.ts src/app/api/kros/expenses/route.ts docs/superpowers/plans/2026-09-06-domov-kros-polia.md
git commit -m "chore(kros): vzorkovanie payloadu za env prepínačom"
```

---

## Fáza 1 — extrakcia sync vrstvy (bez zmeny správania)

Tri stránky dnes obsahujú tri kópie toho istého sync efektu. Táto fáza ich nahradí jednou implementáciou. **Správanie sa nesmie zmeniť ani o pixel** — porovnávaj s tým, čo modul robil predtým.

### Task 2: Zdieľané pomôcky sync vrstvy + typy

Tri kópie `withLastModifiedOverlap` a `getMaxLastModified`, dve kópie `buildMonthSyncRanges` a `getLiveDataRange`. Táto úloha ich zjednotí a definuje rozhranie enginu. Nič sa zatiaľ nezapája — je to čistý základ s testami.

**Files:**
- Create: `src/lib/sync/types.ts`
- Create: `src/lib/sync/last-modified.ts`
- Create: `src/lib/sync/month-ranges.ts`
- Test: `src/lib/sync/last-modified.test.ts`
- Test: `src/lib/sync/month-ranges.test.ts`

**Interfaces:**
- Consumes: `KrosConnection`, `NormalizedInvoice`, `NormalizedExpense`, `NormalizedPaymentAccount`, `NormalizedPaymentTransaction` z `@/lib/kros-types`; `SyncStep` z `@/lib/sync-progress-types`; `Granularity` z `@/lib/mock-data`.
- Produces:
  - `type SyncData = { invoices; expenses; accounts; transactions }` a `EMPTY_SYNC_DATA: SyncData`
  - `type SyncEngine<TStep>` s `key`, `hydrate`, `plan`, `describe`, `run`
  - `type PlanContext`, `type RunContext`
  - `withLastModifiedOverlap(value: string): string`
  - `getMaxLastModified<T extends { lastModifiedTimestamp?: string }>(items: T[], fallback?: string): string | undefined`
  - `type MonthSyncRange = { monthKey: string; from: string; to: string }`
  - `buildMonthSyncRanges(fetchFrom: string, fetchTo: string): MonthSyncRange[]`
  - `getLiveDataRange(granularity: Granularity): "ytd" | "history"`

- [ ] **Step 1: Napíš padajúci test pre `last-modified`**

Vytvor `src/lib/sync/last-modified.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { getMaxLastModified, withLastModifiedOverlap } from "./last-modified";

describe("withLastModifiedOverlap", () => {
  it("posunie čas o 5 minút späť a vráti ho bez zóny", () => {
    expect(withLastModifiedOverlap("2026-09-06T10:00:00.000Z")).toBe("2026-09-06T09:55:00");
  });

  it("zachová zlomky sekundy bez koncových núl", () => {
    expect(withLastModifiedOverlap("2026-09-06T10:00:00.120Z")).toBe("2026-09-06T09:55:00.12");
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
```

- [ ] **Step 2: Spusti test a over, že padá**

Run: `npx vitest run src/lib/sync/last-modified.test.ts`
Expected: FAIL — `Failed to resolve import "./last-modified"`.

- [ ] **Step 3: Vytvor `src/lib/sync/last-modified.ts`**

```ts
/**
 * Značka `LastModifiedTimestamp`, od ktorej sa pýtame zmeny, posunutá o 5 minút
 * späť. Prekryv je zámerný: hodiny KROSu a naše nemusia sedieť na sekundu
 * a doklad, ktorý by padol do medzery, by sa už nikdy nedosynchronizoval.
 *
 * KROS API značku očakáva bez časovej zóny, preto sa skladá ručne z UTC zložiek.
 */
export function withLastModifiedOverlap(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  date.setMinutes(date.getMinutes() - 5);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const hours = String(date.getUTCHours()).padStart(2, "0");
  const minutes = String(date.getUTCMinutes()).padStart(2, "0");
  const seconds = String(date.getUTCSeconds()).padStart(2, "0");
  const milliseconds = date.getUTCMilliseconds();
  const fraction =
    milliseconds > 0 ? `.${String(milliseconds).padStart(3, "0").replace(/0+$/, "")}` : "";
  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}${fraction}`;
}

/**
 * Najnovšia značka zmeny v dávke. `fallback` je predchádzajúca značka firmy —
 * dávka bez zmien ju nesmie zahodiť, inak by sa inkrementálny sync vrátil
 * na začiatok a stiahol všetko odznova.
 */
export function getMaxLastModified<T extends { lastModifiedTimestamp?: string }>(
  items: T[],
  fallback?: string
) {
  return items.reduce<string | undefined>((max, item) => {
    if (!item.lastModifiedTimestamp) return max;
    if (!max) return item.lastModifiedTimestamp;
    return new Date(item.lastModifiedTimestamp).getTime() > new Date(max).getTime()
      ? item.lastModifiedTimestamp
      : max;
  }, fallback);
}
```

- [ ] **Step 4: Spusti test a over, že prechádza**

Run: `npx vitest run src/lib/sync/last-modified.test.ts`
Expected: PASS, 7 testov.

- [ ] **Step 5: Napíš padajúci test pre `month-ranges`**

Vytvor `src/lib/sync/month-ranges.test.ts`:

```ts
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
```

- [ ] **Step 6: Spusti test a over, že padá**

Run: `npx vitest run src/lib/sync/month-ranges.test.ts`
Expected: FAIL — `Failed to resolve import "./month-ranges"`.

- [ ] **Step 7: Vytvor `src/lib/sync/month-ranges.ts`**

Telo `buildMonthSyncRanges`, `startOfDayIso` a `endOfDayIso` presuň **doslovne** z `src/app/page.tsx` (funkcie `startOfDayIso`, `endOfDayIso`, `buildMonthSyncRanges`) a `getLiveDataRange` tiež z `src/app/page.tsx`. Výsledok:

```ts
import type { Granularity } from "@/lib/mock-data";
import { monthKeyFromDate } from "@/lib/invoice-cache";

/** Jeden mesiac sťahovania. `from`/`to` sú ISO okamihy, nie kalendárne mesiace. */
export type MonthSyncRange = { monthKey: string; from: string; to: string };

/** Roky potrebujú aj minulé roky; týždne a mesiace vystačia s aktuálnym rokom. */
export function getLiveDataRange(granularity: Granularity): "ytd" | "history" {
  return granularity === "year" ? "history" : "ytd";
}

function startOfDayIso(date: Date) {
  const value = new Date(date);
  value.setHours(0, 0, 0, 0);
  return value.toISOString();
}

function endOfDayIso(date: Date) {
  const value = new Date(date);
  value.setHours(23, 59, 59, 999);
  return value.toISOString();
}

/**
 * Okno sťahovania rozdelené na mesiace. Mesiac je jednotka, ktorú si cache
 * pamätá ako hotovú (`syncMeta`), preto je aj jednotkou plánu a jedným krokom
 * ukazovateľa priebehu.
 */
export function buildMonthSyncRanges(fetchFrom: string, fetchTo: string) {
  const start = new Date(fetchFrom);
  const end = new Date(fetchTo);
  const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
  const ranges: MonthSyncRange[] = [];

  while (cursor <= end) {
    const monthStart = new Date(cursor);
    const monthEnd = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
    const from = monthStart < start ? start : monthStart;
    const to = monthEnd > end ? end : monthEnd;

    ranges.push({
      monthKey: monthKeyFromDate(cursor),
      from: startOfDayIso(from),
      to: endOfDayIso(to)
    });

    cursor.setMonth(cursor.getMonth() + 1);
  }

  return ranges;
}
```

- [ ] **Step 8: Spusti test a over, že prechádza**

Run: `npx vitest run src/lib/sync/month-ranges.test.ts`
Expected: PASS, 5 testov.

- [ ] **Step 9: Vytvor `src/lib/sync/types.ts`**

```ts
import type { Granularity } from "@/lib/mock-data";
import type {
  KrosConnection,
  NormalizedExpense,
  NormalizedInvoice,
  NormalizedPaymentAccount,
  NormalizedPaymentTransaction
} from "@/lib/kros-types";
import type { SyncStep } from "@/lib/sync-progress-types";

/**
 * Všetko, čo appka vie mať stiahnuté. Zámerne jeden uzavretý tvar, nie generický
 * parameter na engine: vďaka tomu orchestrátor zlúči výsledky troch enginov bez
 * jediného pretypovania a stránka dostane hotové polia.
 */
export type SyncData = {
  invoices: NormalizedInvoice[];
  expenses: NormalizedExpense[];
  accounts: NormalizedPaymentAccount[];
  transactions: NormalizedPaymentTransaction[];
};

export const EMPTY_SYNC_DATA: SyncData = {
  invoices: [],
  expenses: [],
  accounts: [],
  transactions: []
};

export type PlanContext = {
  /** Firmy, ktoré sa majú synchronizovať — už po aplikovaní filtra firiem. */
  connections: KrosConnection[];
  companyIds: number[];
  granularity: Granularity;
  /** Ručné obnovenie doťahuje aj zmeny; automatické otvorenie len chýbajúce mesiace. */
  isManualRefresh: boolean;
  signal: AbortSignal;
};

export type RunContext = {
  signal: AbortSignal;
  /**
   * Priebeh vnútri kroku (0–1) a jeho bližší popis. Engine tak nevie nič
   * o `sync-progress-store` — vlastníkom ukazovateľa je orchestrátor.
   */
  onProgress: (fraction: number, detail?: string) => void;
};

/**
 * Jedna doména sťahovania. `plan` a `run` sú oddelené zámerne: plán poznáme pred
 * prvým fetchom, takže ukazovateľ priebehu vie zobraziť celok práce namiesto
 * nekonečného loadera — a dá sa otestovať bez siete.
 */
export type SyncEngine<TStep = unknown> = {
  /** Ladiaci názov domény, napr. `"invoices"`. */
  readonly key: string;
  /** Prečíta IndexedDB cache — bez siete. */
  hydrate(companyIds: number[]): Promise<Partial<SyncData>>;
  plan(ctx: PlanContext): Promise<TStep[]>;
  /** Krok tak, ako ho vidí človek na obrazovke sťahovania. */
  describe(step: TStep): SyncStep;
  /** fetch → normalizácia → zápis do cache → syncMeta. */
  run(step: TStep, ctx: RunContext): Promise<void>;
};

/**
 * Engine so zabudnutým typom kroku. Orchestrátor drží tri enginy s tromi rôznymi
 * typmi krokov v jednom poli a každý krok vracia späť len tomu enginu, od ktorého
 * ho dostal — typ kroku sa teda mimo enginu nikdy nečíta.
 *
 * `unknown` tu nestačí: `plan()` enginu vracia `InvoiceSyncStep[]`, čo nie je
 * priraditeľné k `unknown[]` v protismere, a `SyncEngine<never>` by nesedelo tiež.
 * Toto je presne ten prípad, na aký `any` je.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnySyncEngine = SyncEngine<any>;
```

- [ ] **Step 10: Over typy a commitni**

Run: `npx tsc --noEmit && npm test`
Expected: bez chýb typov, všetky testy PASS.

```bash
git add src/lib/sync
git commit -m "feat(sync): zdieľané pomôcky a rozhranie sync enginu"
```

---

### Task 3: Orchestrátor `useSyncOrchestrator`

Jediné miesto, ktoré vlastní `sync-progress-store`, hydratáciu z cache a slučku krokov. Zatiaľ ho nikto nepoužíva — zapoja ho úlohy 4–6.

**Files:**
- Create: `src/lib/sync/use-sync-orchestrator.ts`

**Interfaces:**
- Consumes: `AnySyncEngine`, `SyncData`, `EMPTY_SYNC_DATA`, `PlanContext`, `RunContext` z `./types`; `useSyncProgress` z `@/lib/use-sync-progress`.
- Produces:
  ```ts
  useSyncOrchestrator(
    engines: AnySyncEngine[],
    options: {
      connections: KrosConnection[];
      syncConnections: KrosConnection[];
      granularity: Granularity;
      enabled: boolean;
    }
  ): {
    data: SyncData;
    isSyncing: boolean;
    hasResolvedFirstData: boolean;
    error: string | null;
    refresh: () => void;
  }
  ```

- [ ] **Step 1: Vytvor `src/lib/sync/use-sync-orchestrator.ts`**

```ts
"use client";

import { startTransition, useCallback, useEffect, useRef, useState } from "react";
import type { Granularity } from "@/lib/mock-data";
import type { KrosConnection } from "@/lib/kros-types";
import { useSyncProgress } from "@/lib/use-sync-progress";
import { EMPTY_SYNC_DATA, type AnySyncEngine, type SyncData } from "./types";

const LAST_SYNC_STORAGE_KEY = "kros_dashboard_last_sync_at";

/** Od koľkých krokov je sťahovanie „na dlho" a patrí naň celá obrazovka. */
const IMMERSIVE_STEP_THRESHOLD = 3;

type Options = {
  /** Všetky prepojené firmy — prázdne pole znamená demo režim. */
  connections: KrosConnection[];
  /** Firmy po aplikovaní filtra; len tie sa synchronizujú. */
  syncConnections: KrosConnection[];
  granularity: Granularity;
  /**
   * Prvý render beží ešte pred pripojením k store-u nastavení, takže sa sťahovanie
   * odkladá o tik. Bez toho by prvý fetch šiel s prázdnym filtrom a hneď za ním
   * druhý so skutočným.
   */
  enabled: boolean;
};

/**
 * Poháňa sťahovanie pre ľubovoľnú kombináciu domén. Modul si vypýta jeden engine,
 * Domov tri — plány sa zreťazia za seba a bežia pod JEDNÝM ukazovateľom priebehu.
 * To je dôvod, prečo enginy o `sync-progress-store` nevedia: vlastník musí byť
 * jeden, inak si dve domény prepisujú ten istý ukazovateľ.
 *
 * Pole `engines` musí byť modulová konštanta, nie literál v tele komponentu —
 * inak sa efekt spustí pri každom rendere odznova.
 */
export function useSyncOrchestrator(engines: AnySyncEngine[], options: Options) {
  const { connections, syncConnections, granularity, enabled } = options;
  const [data, setData] = useState<SyncData>(EMPTY_SYNC_DATA);
  const [isSyncing, setIsSyncing] = useState(false);
  const [hasResolvedFirstData, setHasResolvedFirstData] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const handledRefreshNonceRef = useRef(0);
  const { beginSync, startStep, advanceStep, completeStep, endSync } = useSyncProgress();

  const refresh = useCallback(() => setRefreshNonce((value) => value + 1), []);

  useEffect(() => {
    if (!enabled) return;

    // Bez prepojenia (demo) aj bez prieniku filtra s prepojenými firmami je výsledok
    // ten istý: prázdne dáta a hotovo. Rozdiel medzi tými dvoma stavmi rieši stránka,
    // nie sťahovanie.
    if (connections.length === 0 || syncConnections.length === 0) {
      setData(EMPTY_SYNC_DATA);
      setIsSyncing(false);
      setHasResolvedFirstData(true);
      setError(null);
      endSync();
      return;
    }

    const abortController = new AbortController();
    const companyIds = syncConnections.map((connection) => connection.companyId);
    const isManualRefresh = refreshNonce !== handledRefreshNonceRef.current;

    const hydrateAll = async () => {
      const parts = await Promise.all(engines.map((engine) => engine.hydrate(companyIds)));
      const merged = parts.reduce<SyncData>(
        (accumulator, part) => ({ ...accumulator, ...part }),
        { ...EMPTY_SYNC_DATA }
      );
      if (!abortController.signal.aborted) {
        // Prepočet dashboardu z dokladov je drahý. Ako transition ho React vie
        // prerušiť, keď medzitým klikneš v menu — appka tak ostáva ovládateľná.
        startTransition(() => setData(merged));
        setHasResolvedFirstData(true);
      }
      return merged;
    };

    const countRows = (value: SyncData) =>
      value.invoices.length + value.expenses.length + value.accounts.length + value.transactions.length;

    const run = async () => {
      const cached = await hydrateAll();
      setError(null);

      try {
        // Najprv plán: čo všetko treba stiahnuť. Počet krokov je podklad pre
        // ukazovateľ priebehu, preto ho zisťujeme ešte pred prvým fetchom.
        const planned: { engine: AnySyncEngine; step: unknown }[] = [];
        for (const engine of engines) {
          const steps = await engine.plan({
            connections: syncConnections,
            companyIds,
            granularity,
            isManualRefresh,
            signal: abortController.signal
          });
          for (const step of steps) planned.push({ engine, step });
        }

        if (abortController.signal.aborted) return;

        // Bez dát na obrazovke (alebo pri práci na dlho) sťahujeme naplno,
        // krátke dosynchronizovanie nad existujúcimi dátami stačí v hlavičke.
        beginSync(
          planned.map(({ engine, step }) => engine.describe(step)),
          countRows(cached) === 0 || planned.length >= IMMERSIVE_STEP_THRESHOLD
        );
        if (planned.length === 0) return;

        setIsSyncing(true);
        // Log KROS volaní čistíme raz na začiatku sťahovania, nie raz za modul —
        // inak by Domov premazal to, čo práve zapísal jeho vlastný prvý engine.
        await fetch("/api/kros/logs", { method: "DELETE" });

        for (const [index, { engine, step }] of planned.entries()) {
          if (abortController.signal.aborted) return;

          startStep(index);
          await engine.run(step, {
            signal: abortController.signal,
            onProgress: advanceStep
          });
          completeStep();
          await hydrateAll();
        }

        localStorage.setItem(LAST_SYNC_STORAGE_KEY, new Date().toISOString());
      } catch (caught) {
        if (!abortController.signal.aborted) {
          setError(caught instanceof Error ? caught.message : "Načítanie dát zlyhalo.");
        }
      } finally {
        if (!abortController.signal.aborted) {
          handledRefreshNonceRef.current = refreshNonce;
          setIsSyncing(false);
          endSync();
        }
      }
    };

    run();

    return () => abortController.abort();
  }, [
    engines,
    connections,
    syncConnections,
    granularity,
    enabled,
    refreshNonce,
    beginSync,
    startStep,
    advanceStep,
    completeStep,
    endSync
  ]);

  return { data, isSyncing, hasResolvedFirstData, error, refresh };
}
```

- [ ] **Step 2: Over typy**

Run: `npx tsc --noEmit`
Expected: bez chýb. (Orchestrátor zatiaľ nikto nevolá — to je v poriadku.)

- [ ] **Step 3: Commitni**

```bash
git add src/lib/sync/use-sync-orchestrator.ts
git commit -m "feat(sync): orchestrátor sťahovania nad viacerými doménami"
```

---

### Task 4: `invoice-engine` + prepnutie Príjmov

Prvý engine. Po tejto úlohe robia Príjmy presne to, čo predtým, ale sťahovanie žije mimo komponentu a má prvý test.

**Files:**
- Create: `src/lib/sync/invoice-engine.ts`
- Test: `src/lib/sync/invoice-engine.test.ts`
- Modify: `src/app/page.tsx` (odstrániť riadky 56–160 a celý sync `useEffect`, cca 190–330)

**Interfaces:**
- Consumes: `SyncEngine`, `PlanContext`, `RunContext` z `./types`; `buildMonthSyncRanges`, `getLiveDataRange`, `MonthSyncRange` z `./month-ranges`; `getMaxLastModified`, `withLastModifiedOverlap` z `./last-modified`; `getCachedInvoices`, `readSyncMeta`, `syncCompanyMetaKey`, `syncMonthMetaKey`, `upsertCachedInvoices`, `writeSyncMeta` z `@/lib/invoice-cache`; `normalizeInvoices` z `@/lib/dashboard-live`.
- Produces:
  - `type InvoiceSyncStep = { kind: "month"; connection: KrosConnection; monthRange: MonthSyncRange } | { kind: "changes"; connection: KrosConnection; lastModifiedTimestamp: string }`
  - `planInvoiceSteps(ctx: PlanContext): Promise<InvoiceSyncStep[]>` — exportovaná zvlášť, aby sa dala testovať bez enginu
  - `invoiceEngine: SyncEngine<InvoiceSyncStep>`

- [ ] **Step 1: Napíš padajúci test plánovača**

Vytvor `src/lib/sync/invoice-engine.test.ts`. Test beží v Node, kde `indexedDB` neexistuje, preto sa `readSyncMeta` nahradí mockom cez `vi.mock`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { KrosConnection } from "@/lib/kros-types";

const syncMeta = new Map<string, { completedAt?: string; lastModifiedTimestamp?: string }>();

vi.mock("@/lib/invoice-cache", async () => {
  const actual = await vi.importActual<typeof import("@/lib/invoice-cache")>("@/lib/invoice-cache");
  return {
    ...actual,
    readSyncMeta: async (key: string) => syncMeta.get(key) ?? null,
    getCachedInvoices: async () => [],
    upsertCachedInvoices: async () => {},
    writeSyncMeta: async () => {}
  };
});

const { planInvoiceSteps } = await import("./invoice-engine");
const { syncCompanyMetaKey, syncMonthMetaKey } = await import("@/lib/invoice-cache");

const CONNECTION: KrosConnection = {
  companyId: 1,
  companyName: "Kros Trade",
  connectedAt: "2026-01-01T00:00:00Z"
};

function context(overrides: Partial<Parameters<typeof planInvoiceSteps>[0]> = {}) {
  return {
    connections: [CONNECTION],
    companyIds: [CONNECTION.companyId],
    granularity: "month" as const,
    isManualRefresh: false,
    signal: new AbortController().signal,
    ...overrides
  };
}

beforeEach(() => {
  syncMeta.clear();
});

describe("planInvoiceSteps", () => {
  it("prázdna cache znamená krok na každý mesiac okna", async () => {
    const steps = await planInvoiceSteps(context());
    expect(steps.length).toBeGreaterThan(0);
    expect(steps.every((step) => step.kind === "month")).toBe(true);
  });

  it("hotové mesiace sa už nesťahujú — to je celá ochrana pred duplicitou", async () => {
    const first = await planInvoiceSteps(context());
    for (const step of first) {
      if (step.kind !== "month") continue;
      syncMeta.set(syncMonthMetaKey(CONNECTION.companyId, "ytd", step.monthRange.monthKey), {
        completedAt: "2026-09-01T00:00:00Z"
      });
    }

    expect(await planInvoiceSteps(context())).toEqual([]);
  });

  it("ručné obnovenie nad hotovými mesiacmi doťahuje len zmeny", async () => {
    const first = await planInvoiceSteps(context());
    for (const step of first) {
      if (step.kind !== "month") continue;
      syncMeta.set(syncMonthMetaKey(CONNECTION.companyId, "ytd", step.monthRange.monthKey), {
        completedAt: "2026-09-01T00:00:00Z"
      });
    }
    syncMeta.set(syncCompanyMetaKey(CONNECTION.companyId, "ytd"), {
      completedAt: "2026-09-01T00:00:00Z",
      lastModifiedTimestamp: "2026-09-01T00:00:00Z"
    });

    const steps = await planInvoiceSteps(context({ isManualRefresh: true }));
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({ kind: "changes", lastModifiedTimestamp: "2026-09-01T00:00:00Z" });
  });

  it("firma bez značky zmeny nedostane krok zmien — nemá od čoho merať", async () => {
    const first = await planInvoiceSteps(context());
    for (const step of first) {
      if (step.kind !== "month") continue;
      syncMeta.set(syncMonthMetaKey(CONNECTION.companyId, "ytd", step.monthRange.monthKey), {
        completedAt: "2026-09-01T00:00:00Z"
      });
    }

    expect(await planInvoiceSteps(context({ isManualRefresh: true }))).toEqual([]);
  });

  it("chýbajúci mesiac má prednosť pred krokom zmien", async () => {
    syncMeta.set(syncCompanyMetaKey(CONNECTION.companyId, "ytd"), {
      completedAt: "2026-09-01T00:00:00Z",
      lastModifiedTimestamp: "2026-09-01T00:00:00Z"
    });

    const steps = await planInvoiceSteps(context({ isManualRefresh: true }));
    expect(steps.every((step) => step.kind === "month")).toBe(true);
  });
});
```

- [ ] **Step 2: Spusti test a over, že padá**

Run: `npx vitest run src/lib/sync/invoice-engine.test.ts`
Expected: FAIL — `Failed to resolve import "./invoice-engine"`.

- [ ] **Step 3: Vytvor `src/lib/sync/invoice-engine.ts`**

Telo `plan` je doslovný presun bloku „Najprv plán" z `src/app/page.tsx`; telo `run` je presun tela slučky `for (const [index, step] of steps.entries())` z tej istej stránky, bez `startStep`/`completeStep` (to robí orchestrátor) a bez `clearSyncLogsOnce` (to tiež).

```ts
import { getDateRange } from "@/lib/period-buckets";
import { normalizeInvoices } from "@/lib/dashboard-live";
import type { KrosConnection } from "@/lib/kros-types";
import {
  getCachedInvoices,
  readSyncMeta,
  syncCompanyMetaKey,
  syncMonthMetaKey,
  upsertCachedInvoices,
  writeSyncMeta
} from "@/lib/invoice-cache";
import { formatMonthKeyLabel } from "@/lib/use-sync-progress";
import { getMaxLastModified, withLastModifiedOverlap } from "./last-modified";
import { buildMonthSyncRanges, getLiveDataRange, type MonthSyncRange } from "./month-ranges";
import type { PlanContext, RunContext, SyncEngine } from "./types";

/**
 * Jeden krok sťahovania — buď chýbajúci mesiac firmy, alebo faktúry zmenené od
 * posledného syncu.
 *
 * `range` nesie krok, nie engine: pôvodne sa počítal raz pre celý beh efektu
 * z aktuálnej granularity, ale engine dostáva krok samostatne. Keby si ho
 * domýšľal, zapísal by mesiac pod iný kľúč `syncMeta`, než pod akým sa hľadá —
 * a ten mesiac by sa sťahoval donekonečna.
 */
export type InvoiceSyncStep =
  | {
      kind: "month";
      range: "ytd" | "history";
      connection: KrosConnection;
      monthRange: MonthSyncRange;
    }
  | {
      kind: "changes";
      range: "ytd" | "history";
      connection: KrosConnection;
      lastModifiedTimestamp: string;
    };

async function fetchInvoices(
  body: {
    companyIds: number[];
    deliveryDateFrom?: string;
    deliveryDateTo?: string;
    lastModifiedTimestamp?: string;
  },
  signal: AbortSignal
) {
  const response = await fetch("/api/kros/invoices", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(
      payload?.details
        ? `${payload?.error ?? "Nepodarilo sa načítať faktúry."} ${payload.details}`
        : payload?.error ?? "Nepodarilo sa načítať faktúry."
    );
  }
  if (Array.isArray(payload?.errors) && payload.errors.length > 0) {
    throw new Error(payload.errors[0]?.message ?? "Niektoré firmy sa nepodarilo načítať.");
  }
  return Array.isArray(payload?.data) ? (payload.data as unknown[]) : [];
}

/**
 * Plán sťahovania. Exportovaný zvlášť od enginu, aby sa dal otestovať bez siete —
 * je to jediné miesto, ktoré rozhoduje, či sa niečo stiahne druhýkrát.
 */
export async function planInvoiceSteps(ctx: PlanContext): Promise<InvoiceSyncStep[]> {
  const liveDataRange = getLiveDataRange(ctx.granularity);
  const fetchRange = getDateRange(liveDataRange === "history" ? "year" : "month");
  const monthRanges = buildMonthSyncRanges(fetchRange.fetchFrom, fetchRange.fetchTo);
  const steps: InvoiceSyncStep[] = [];

  for (const connection of ctx.connections) {
    const missingMonthRanges: MonthSyncRange[] = [];
    for (const monthRange of monthRanges) {
      const monthMeta = await readSyncMeta(
        syncMonthMetaKey(connection.companyId, liveDataRange, monthRange.monthKey)
      );
      if (!monthMeta?.completedAt) {
        missingMonthRanges.push(monthRange);
      }
    }

    if (missingMonthRanges.length > 0) {
      for (const monthRange of missingMonthRanges) {
        steps.push({ kind: "month", range: liveDataRange, connection, monthRange });
      }
      continue;
    }

    if (!ctx.isManualRefresh) continue;

    const companyMeta = await readSyncMeta(syncCompanyMetaKey(connection.companyId, liveDataRange));
    if (!companyMeta?.lastModifiedTimestamp) continue;
    steps.push({
      kind: "changes",
      range: liveDataRange,
      connection,
      lastModifiedTimestamp: companyMeta.lastModifiedTimestamp
    });
  }

  return steps;
}

export const invoiceEngine: SyncEngine<InvoiceSyncStep> = {
  key: "invoices",

  async hydrate(companyIds) {
    return { invoices: await getCachedInvoices(companyIds) };
  },

  plan: planInvoiceSteps,

  describe(step) {
    if (step.kind === "month") {
      return {
        key: `invoices:${step.connection.companyId}:${step.monthRange.monthKey}`,
        group: step.connection.companyName,
        // Doména je v popise zámerne: na Domove bežia faktúry aj výdavky za sebou
        // a bez nej by obrazovka sťahovania ukázala dvakrát ten istý riadok.
        label: `faktúry — ${formatMonthKeyLabel(step.monthRange.monthKey)}`
      };
    }
    return {
      key: `invoices:${step.connection.companyId}:changes`,
      group: step.connection.companyName,
      label: "zmenené faktúry"
    };
  },

  async run(step, ctx: RunContext) {
    const { connection } = step;
    const liveDataRange = step.range;

    const rawInvoices = await fetchInvoices(
      step.kind === "month"
        ? {
            companyIds: [connection.companyId],
            deliveryDateFrom: step.monthRange.from,
            deliveryDateTo: step.monthRange.to
          }
        : {
            companyIds: [connection.companyId],
            lastModifiedTimestamp: withLastModifiedOverlap(step.lastModifiedTimestamp)
          },
      ctx.signal
    );

    const companyInvoices = normalizeInvoices(rawInvoices).filter(
      (invoice) =>
        invoice.companyId === connection.companyId || invoice.companyName === connection.companyName
    );
    const completedAt = new Date().toISOString();
    await upsertCachedInvoices(connection.companyId, companyInvoices);

    if (step.kind === "month") {
      await writeSyncMeta({
        key: syncMonthMetaKey(connection.companyId, liveDataRange, step.monthRange.monthKey),
        companyId: connection.companyId,
        range: liveDataRange,
        monthKey: step.monthRange.monthKey,
        completedAt
      });
    }

    const companyMetaKey = syncCompanyMetaKey(connection.companyId, liveDataRange);
    const previousCompanyMeta = await readSyncMeta(companyMetaKey);
    await writeSyncMeta({
      key: companyMetaKey,
      companyId: connection.companyId,
      range: liveDataRange,
      completedAt,
      lastModifiedTimestamp: getMaxLastModified(
        companyInvoices,
        previousCompanyMeta?.lastModifiedTimestamp
      )
    });
  }
};
```

- [ ] **Step 4: Spusti test a over, že prechádza**

Run: `npx vitest run src/lib/sync/invoice-engine.test.ts`
Expected: PASS, 5 testov.

- [ ] **Step 5: Prepni `src/app/page.tsx` na orchestrátor**

Odstráň z `src/app/page.tsx`:
- typy `LiveDataRange`, `MonthSyncRange`, `InvoiceSyncStep`, konštanty `LAST_SYNC_STORAGE_KEY`, `IMMERSIVE_STEP_THRESHOLD`
- funkcie `toSyncStep`, `getLiveDataRange`, `startOfDayIso`, `endOfDayIso`, `buildMonthSyncRanges`, `getMaxLastModified`, `withLastModifiedOverlap`
- stavy `liveInvoices`, `isLoadingLiveData`, `setLiveError`, `refreshNonce`, `hasResolvedFirstData`, `handledRefreshNonceRef`, `useSyncProgress()`
- celý sync `useEffect`

Nad komponentom pridaj modulovú konštantu (nie literál v tele — inak sa efekt spustí pri každom rendere):

```ts
const REVENUE_ENGINES = [invoiceEngine];
```

V tele komponentu, hneď za `const syncConnections = companyFilter.companies;`:

```ts
  const {
    data: { invoices: liveInvoices },
    isSyncing: isLoadingLiveData,
    hasResolvedFirstData,
    refresh
  } = useSyncOrchestrator(REVENUE_ENGINES, {
    connections,
    syncConnections,
    granularity,
    enabled: hasLoadedPersistedFilters
  });
```

V `DashboardShell` nahraď `onRefresh={connections.length > 0 ? () => setRefreshNonce((value) => value + 1) : undefined}` za `onRefresh={connections.length > 0 ? refresh : undefined}`.

Zvyšok stránky (všetky `useMemo` a render) ostáva **nezmenený** — `liveInvoices`, `isLoadingLiveData` aj `hasResolvedFirstData` sa volajú rovnako ako predtým.

`refreshNonce` sa dnes používa aj v `useTagCategoryIndex(connections, refreshNonce)`. Nahraď ho vlastným počítadlom, ktoré sa zvýši pri obnovení:

```ts
  const [tagRefreshNonce, setTagRefreshNonce] = useState(0);
  const handleRefresh = () => {
    setTagRefreshNonce((value) => value + 1);
    refresh();
  };
```

a použi `handleRefresh` v `onRefresh` a `tagRefreshNonce` v `useTagCategoryIndex`.

- [ ] **Step 6: Over typy a testy**

Run: `npx tsc --noEmit && npm test`
Expected: bez chýb, všetky testy PASS.

- [ ] **Step 7: Over v prehliadači, že sa Príjmy nezmenili**

Spusti dev server cez Browser pane (`preview_start` s konfiguráciou z `.claude/launch.json`; ak neexistuje, vytvor ju pre `npm run dev` na porte 3000). Otvor `/`.

Over:
1. Modul sa načíta a ukáže graf a KPI (alebo demo banner bez prepojenia).
2. Klik na obnovenie spustí ukazovateľ priebehu a ten dobehne do 100 %.
3. `read_console_messages` — žiadne chyby.

Ak stránka nevykreslí nič, otvor ju v čerstvej karte (`tabs_create`) — v tomto prehliadači sa moduly na fresh load občas nehydratujú.

- [ ] **Step 8: Commitni**

```bash
git add src/lib/sync src/app/page.tsx
git commit -m "refactor(sync): faktúry sťahuje engine, nie stránka"
```

---

### Task 5: `expense-engine` + prepnutie Výdavkov

Výdavky sťahujú stream (NDJSON), takže tento engine ako prvý použije `ctx.onProgress`.

**Files:**
- Create: `src/lib/sync/expense-engine.ts`
- Test: `src/lib/sync/expense-engine.test.ts`
- Modify: `src/app/expenses/page.tsx`

**Interfaces:**
- Consumes: `SyncEngine`, `PlanContext`, `RunContext` z `./types`; `buildMonthSyncRanges`, `getLiveDataRange`, `MonthSyncRange` z `./month-ranges`; `getMaxLastModified`, `withLastModifiedOverlap` z `./last-modified`; `expenseCompanyMetaKey`, `expenseMonthMetaKey`, `getCachedExpenses`, `readExpenseSyncMeta`, `upsertCachedExpenses`, `writeExpenseSyncMeta` z `@/lib/expense-cache`; `normalizeExpenses` z `@/lib/expenses-live`; `readNdjsonStream` z `@/lib/ndjson-stream`.
- Produces:
  - `type ExpenseSyncStep` — rovnaký tvar ako `InvoiceSyncStep`, ale vlastný typ (domény sa nesmú zamotať)
  - `planExpenseSteps(ctx: PlanContext): Promise<ExpenseSyncStep[]>`
  - `expenseEngine: SyncEngine<ExpenseSyncStep>`

- [ ] **Step 1: Napíš padajúci test plánovača**

Vytvor `src/lib/sync/expense-engine.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { KrosConnection } from "@/lib/kros-types";

const syncMeta = new Map<string, { completedAt?: string; lastModifiedTimestamp?: string }>();

vi.mock("@/lib/expense-cache", async () => {
  const actual = await vi.importActual<typeof import("@/lib/expense-cache")>("@/lib/expense-cache");
  return {
    ...actual,
    readExpenseSyncMeta: async (key: string) => syncMeta.get(key) ?? null,
    getCachedExpenses: async () => [],
    upsertCachedExpenses: async () => {},
    writeExpenseSyncMeta: async () => {}
  };
});

const { planExpenseSteps } = await import("./expense-engine");
const { expenseCompanyMetaKey, expenseMonthMetaKey } = await import("@/lib/expense-cache");

const CONNECTION: KrosConnection = {
  companyId: 7,
  companyName: "Kros Servis",
  connectedAt: "2026-01-01T00:00:00Z"
};

function context(overrides: Partial<Parameters<typeof planExpenseSteps>[0]> = {}) {
  return {
    connections: [CONNECTION],
    companyIds: [CONNECTION.companyId],
    granularity: "month" as const,
    isManualRefresh: false,
    signal: new AbortController().signal,
    ...overrides
  };
}

async function markAllMonthsDone() {
  const steps = await planExpenseSteps(context());
  for (const step of steps) {
    if (step.kind !== "month") continue;
    syncMeta.set(expenseMonthMetaKey(CONNECTION.companyId, "ytd", step.monthRange.monthKey), {
      completedAt: "2026-09-01T00:00:00Z"
    });
  }
}

beforeEach(() => {
  syncMeta.clear();
});

describe("planExpenseSteps", () => {
  it("prázdna cache znamená krok na každý mesiac okna", async () => {
    const steps = await planExpenseSteps(context());
    expect(steps.length).toBeGreaterThan(0);
    expect(steps.every((step) => step.kind === "month")).toBe(true);
  });

  it("hotové mesiace sa už nesťahujú", async () => {
    await markAllMonthsDone();
    expect(await planExpenseSteps(context())).toEqual([]);
  });

  it("ručné obnovenie nad hotovými mesiacmi doťahuje len zmeny", async () => {
    await markAllMonthsDone();
    syncMeta.set(expenseCompanyMetaKey(CONNECTION.companyId, "ytd"), {
      completedAt: "2026-09-01T00:00:00Z",
      lastModifiedTimestamp: "2026-09-01T00:00:00Z"
    });

    const steps = await planExpenseSteps(context({ isManualRefresh: true }));
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({ kind: "changes", lastModifiedTimestamp: "2026-09-01T00:00:00Z" });
  });

  it("firma bez značky zmeny nedostane krok zmien", async () => {
    await markAllMonthsDone();
    expect(await planExpenseSteps(context({ isManualRefresh: true }))).toEqual([]);
  });

  it("roky plánujú rozsah history, nie ytd — inak by kľúče cache nesedeli", async () => {
    const steps = await planExpenseSteps(context({ granularity: "year" }));
    expect(steps.every((step) => step.range === "history")).toBe(true);
  });
});
```

- [ ] **Step 2: Spusti test a over, že padá**

Run: `npx vitest run src/lib/sync/expense-engine.test.ts`
Expected: FAIL — `Failed to resolve import "./expense-engine"`.

- [ ] **Step 3: Vytvor `src/lib/sync/expense-engine.ts`**

`readStepProgress`, typy `ExpenseStreamEvent` a `ExpenseResultEvent` presuň doslovne z `src/app/expenses/page.tsx` (nájdeš ich nad komponentom).

```ts
import { getDateRange } from "@/lib/period-buckets";
import { normalizeExpenses } from "@/lib/expenses-live";
import type { KrosConnection } from "@/lib/kros-types";
import {
  expenseCompanyMetaKey,
  expenseMonthMetaKey,
  getCachedExpenses,
  readExpenseSyncMeta,
  upsertCachedExpenses,
  writeExpenseSyncMeta
} from "@/lib/expense-cache";
import { readNdjsonStream } from "@/lib/ndjson-stream";
import { formatMonthKeyLabel } from "@/lib/use-sync-progress";
import { getMaxLastModified, withLastModifiedOverlap } from "./last-modified";
import { buildMonthSyncRanges, getLiveDataRange, type MonthSyncRange } from "./month-ranges";
import type { PlanContext, RunContext, SyncEngine } from "./types";

/**
 * Krok sťahovania výdavkov. `range` nesie krok, nie engine — pod týmto kľúčom sa
 * mesiac zapisuje do `syncMeta` aj hľadá, takže domýšľať ho v `run` by znamenalo
 * mesiac, ktorý sa nikdy neoznačí za hotový.
 */
export type ExpenseSyncStep =
  | {
      kind: "month";
      range: "ytd" | "history";
      connection: KrosConnection;
      monthRange: MonthSyncRange;
    }
  | {
      kind: "changes";
      range: "ytd" | "history";
      connection: KrosConnection;
      lastModifiedTimestamp: string;
    };

export async function planExpenseSteps(ctx: PlanContext): Promise<ExpenseSyncStep[]> {
  const liveDataRange = getLiveDataRange(ctx.granularity);
  const fetchRange = getDateRange(liveDataRange === "history" ? "year" : "month");
  const monthRanges = buildMonthSyncRanges(fetchRange.fetchFrom, fetchRange.fetchTo);
  const steps: ExpenseSyncStep[] = [];

  for (const connection of ctx.connections) {
    const missingMonthRanges: MonthSyncRange[] = [];
    for (const monthRange of monthRanges) {
      const monthMeta = await readExpenseSyncMeta(
        expenseMonthMetaKey(connection.companyId, liveDataRange, monthRange.monthKey)
      );
      if (!monthMeta?.completedAt) {
        missingMonthRanges.push(monthRange);
      }
    }

    if (missingMonthRanges.length > 0) {
      for (const monthRange of missingMonthRanges) {
        steps.push({ kind: "month", range: liveDataRange, connection, monthRange });
      }
      continue;
    }

    if (!ctx.isManualRefresh) continue;

    const companyMeta = await readExpenseSyncMeta(
      expenseCompanyMetaKey(connection.companyId, liveDataRange)
    );
    if (!companyMeta?.lastModifiedTimestamp) continue;
    steps.push({
      kind: "changes",
      range: liveDataRange,
      connection,
      lastModifiedTimestamp: companyMeta.lastModifiedTimestamp
    });
  }

  return steps;
}

async function fetchExpenses(
  body: {
    companyIds: number[];
    deliveryDateFrom?: string;
    deliveryDateTo?: string;
    lastModifiedTimestamp?: string;
  },
  ctx: RunContext
) {
  const response = await fetch("/api/kros/expenses", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: ctx.signal
  });

  if (!response.ok || !response.body) {
    const payload = await response.json().catch(() => null);
    throw new Error(
      payload?.details
        ? `${payload?.error ?? "Nepodarilo sa načítať výdavky."} ${payload.details}`
        : payload?.error ?? "Nepodarilo sa načítať výdavky."
    );
  }

  // Dáta prídu posledným riadkom streamu, dovtedy chodí priebeh sťahovania.
  const collected: { result: ExpenseResultEvent | null } = { result: null };
  await readNdjsonStream(response.body, (raw) => {
    const event = raw as ExpenseStreamEvent;
    if (event?.type === "result") {
      collected.result = event;
      return;
    }

    const stepProgress = readStepProgress(event);
    if (stepProgress) {
      ctx.onProgress(stepProgress.fraction, stepProgress.detail);
    }
  });

  const payload = collected.result;
  if (!payload) {
    throw new Error("Nepodarilo sa načítať výdavky — sťahovanie sa nedokončilo.");
  }
  if (Array.isArray(payload.errors) && payload.errors.length > 0) {
    throw new Error(payload.errors[0]?.message ?? "Niektoré firmy sa nepodarilo načítať.");
  }
  return Array.isArray(payload.data) ? payload.data : [];
}

export const expenseEngine: SyncEngine<ExpenseSyncStep> = {
  key: "expenses",

  async hydrate(companyIds) {
    return { expenses: await getCachedExpenses(companyIds) };
  },

  plan: planExpenseSteps,

  describe(step) {
    if (step.kind === "month") {
      return {
        key: `expenses:${step.connection.companyId}:${step.monthRange.monthKey}`,
        group: step.connection.companyName,
        // Doména je v popise zámerne: na Domove bežia faktúry aj výdavky za sebou
        // a bez nej by obrazovka sťahovania ukázala dvakrát ten istý riadok.
        label: `výdavky — ${formatMonthKeyLabel(step.monthRange.monthKey)}`
      };
    }
    return {
      key: `expenses:${step.connection.companyId}:changes`,
      group: step.connection.companyName,
      label: "zmenené výdavky"
    };
  },

  async run(step, ctx) {
    const { connection } = step;
    const liveDataRange = step.range;

    const rawExpenses = await fetchExpenses(
      step.kind === "month"
        ? {
            companyIds: [connection.companyId],
            deliveryDateFrom: step.monthRange.from,
            deliveryDateTo: step.monthRange.to
          }
        : {
            companyIds: [connection.companyId],
            lastModifiedTimestamp: withLastModifiedOverlap(step.lastModifiedTimestamp)
          },
      ctx
    );

    const companyExpenses = normalizeExpenses(rawExpenses).filter(
      (expense) =>
        expense.companyId === connection.companyId || expense.companyName === connection.companyName
    );
    const completedAt = new Date().toISOString();
    await upsertCachedExpenses(connection.companyId, companyExpenses);

    if (step.kind === "month") {
      await writeExpenseSyncMeta({
        key: expenseMonthMetaKey(connection.companyId, liveDataRange, step.monthRange.monthKey),
        companyId: connection.companyId,
        range: liveDataRange,
        monthKey: step.monthRange.monthKey,
        completedAt
      });
    }

    const companyMetaKey = expenseCompanyMetaKey(connection.companyId, liveDataRange);
    const previousCompanyMeta = await readExpenseSyncMeta(companyMetaKey);
    await writeExpenseSyncMeta({
      key: companyMetaKey,
      companyId: connection.companyId,
      range: liveDataRange,
      completedAt,
      lastModifiedTimestamp: getMaxLastModified(
        companyExpenses,
        previousCompanyMeta?.lastModifiedTimestamp
      )
    });
  }
};
```

- [ ] **Step 4: Spusti test a over, že prechádza**

Run: `npx vitest run src/lib/sync/expense-engine.test.ts`
Expected: PASS, 5 testov.

- [ ] **Step 5: Prepni `src/app/expenses/page.tsx` na orchestrátor**

Odstráň z `src/app/expenses/page.tsx` to isté, čo v Task 4 z Príjmov: typy krokov a stream eventov (presunuli sa do enginu), `getLiveDataRange`, `startOfDayIso`, `endOfDayIso`, `buildMonthSyncRanges`, `getMaxLastModified`, `withLastModifiedOverlap`, `readStepProgress`, `toSyncStep`, `IMMERSIVE_STEP_THRESHOLD`, stavy `liveExpenses`, `isLoadingLiveData`, `setLiveError`, `refreshNonce`, `hasResolvedFirstData`, `handledRefreshNonceRef`, `useSyncProgress()` a celý sync `useEffect`.

Nad komponentom:

```ts
const EXPENSE_ENGINES = [expenseEngine];
```

V tele, za `const syncConnections = companyFilter.companies;`:

```ts
  const {
    data: { expenses: liveExpenses },
    isSyncing: isLoadingLiveData,
    hasResolvedFirstData,
    refresh
  } = useSyncOrchestrator(EXPENSE_ENGINES, {
    connections,
    syncConnections,
    granularity,
    enabled: hasLoadedPersistedFilters
  });
```

Ak stránka používa `refreshNonce` aj pre `useTagCategoryIndex`, zaveď `tagRefreshNonce` rovnako ako v Task 4:

```ts
  const [tagRefreshNonce, setTagRefreshNonce] = useState(0);
  const handleRefresh = () => {
    setTagRefreshNonce((value) => value + 1);
    refresh();
  };
```

- [ ] **Step 6: Over typy a testy**

Run: `npx tsc --noEmit && npm test`
Expected: bez chýb, všetky testy PASS.

- [ ] **Step 7: Over v prehliadači**

Otvor `/expenses`. Over, že sa modul načíta, obnovenie hýbe ukazovateľom priebehu (pri výdavkoch sa musí hýbať aj **vnútri** kroku, lebo ich stream hlási doklady) a v konzole nie sú chyby.

- [ ] **Step 8: Commitni**

```bash
git add src/lib/sync src/app/expenses/page.tsx
git commit -m "refactor(sync): výdavky sťahuje engine, nie stránka"
```

---

### Task 6: `cashflow-engine` + prepnutie Financií

Financie majú iný tvar plánu: jeden krok na firmu, vnútri ktorého sa najprv stiahnu účty a potom pohyby.

**Files:**
- Create: `src/lib/sync/cashflow-engine.ts`
- Test: `src/lib/sync/cashflow-engine.test.ts`
- Modify: `src/app/cashflow/page.tsx`

**Interfaces:**
- Consumes: `SyncEngine`, `PlanContext`, `RunContext` z `./types`; `getMaxLastModified`, `withLastModifiedOverlap` z `./last-modified`; `cashflowCompanyMetaKey`, `getCachedPaymentAccounts`, `getCachedPaymentTransactions`, `readCashflowSyncMeta`, `replaceCachedPaymentAccounts`, `upsertCachedPaymentTransactions`, `writeCashflowSyncMeta` z `@/lib/cashflow-cache`; `normalizePaymentAccounts`, `normalizePaymentTransactions` z `@/lib/cashflow-live`; `estimatePaymentSyncProgress` z `@/lib/payment-sync-progress`; `readNdjsonStream` z `@/lib/ndjson-stream`.
- Produces:
  - `type CashflowSyncStep = { connection: KrosConnection; needsFullSync: boolean; lastModifiedTimestamp?: string }`
  - `planCashflowSteps(ctx: PlanContext): Promise<CashflowSyncStep[]>`
  - `cashflowEngine: SyncEngine<CashflowSyncStep>`

- [ ] **Step 1: Napíš padajúci test plánovača**

Vytvor `src/lib/sync/cashflow-engine.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { KrosConnection } from "@/lib/kros-types";

const syncMeta = new Map<string, { completedAt?: string; lastModifiedTimestamp?: string }>();

vi.mock("@/lib/cashflow-cache", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/cashflow-cache")>("@/lib/cashflow-cache");
  return {
    ...actual,
    readCashflowSyncMeta: async (key: string) => syncMeta.get(key) ?? null,
    getCachedPaymentAccounts: async () => [],
    getCachedPaymentTransactions: async () => [],
    replaceCachedPaymentAccounts: async () => {},
    upsertCachedPaymentTransactions: async () => {},
    writeCashflowSyncMeta: async () => {}
  };
});

const { planCashflowSteps } = await import("./cashflow-engine");
const { cashflowCompanyMetaKey } = await import("@/lib/cashflow-cache");

const CONNECTION: KrosConnection = {
  companyId: 3,
  companyName: "Kros Financie",
  connectedAt: "2026-01-01T00:00:00Z"
};

function context(overrides: Partial<Parameters<typeof planCashflowSteps>[0]> = {}) {
  return {
    connections: [CONNECTION],
    companyIds: [CONNECTION.companyId],
    granularity: "month" as const,
    isManualRefresh: false,
    signal: new AbortController().signal,
    ...overrides
  };
}

beforeEach(() => {
  syncMeta.clear();
});

describe("planCashflowSteps", () => {
  it("firma bez syncu dostane plný krok", async () => {
    const steps = await planCashflowSteps(context());
    expect(steps).toHaveLength(1);
    expect(steps[0].needsFullSync).toBe(true);
  });

  it("hotová firma sa pri automatickom otvorení nesťahuje", async () => {
    syncMeta.set(cashflowCompanyMetaKey(CONNECTION.companyId), {
      completedAt: "2026-09-01T00:00:00Z"
    });
    expect(await planCashflowSteps(context())).toEqual([]);
  });

  it("ručné obnovenie hotovú firmu doťahuje inkrementálne", async () => {
    syncMeta.set(cashflowCompanyMetaKey(CONNECTION.companyId), {
      completedAt: "2026-09-01T00:00:00Z",
      lastModifiedTimestamp: "2026-09-01T00:00:00Z"
    });

    const steps = await planCashflowSteps(context({ isManualRefresh: true }));
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({
      needsFullSync: false,
      lastModifiedTimestamp: "2026-09-01T00:00:00Z"
    });
  });

  it("každá prepojená firma je vlastný krok", async () => {
    const second: KrosConnection = { ...CONNECTION, companyId: 4, companyName: "Druhá" };
    const steps = await planCashflowSteps(
      context({ connections: [CONNECTION, second], companyIds: [3, 4] })
    );
    expect(steps.map((step) => step.connection.companyId)).toEqual([3, 4]);
  });
});
```

- [ ] **Step 2: Spusti test a over, že padá**

Run: `npx vitest run src/lib/sync/cashflow-engine.test.ts`
Expected: FAIL — `Failed to resolve import "./cashflow-engine"`.

- [ ] **Step 3: Vytvor `src/lib/sync/cashflow-engine.ts`**

Typy `PaymentsStreamEvent` a `PaymentsResultEvent` aj konštantu `ACCOUNTS_SHARE` presuň doslovne z `src/app/cashflow/page.tsx` (aj s komentárom, ktorý vysvetľuje, prečo účty nie sú vlastný krok).

```ts
import type { KrosConnection, NormalizedPaymentTransaction } from "@/lib/kros-types";
import {
  cashflowCompanyMetaKey,
  getCachedPaymentAccounts,
  getCachedPaymentTransactions,
  readCashflowSyncMeta,
  replaceCachedPaymentAccounts,
  upsertCachedPaymentTransactions,
  writeCashflowSyncMeta
} from "@/lib/cashflow-cache";
import { normalizePaymentAccounts, normalizePaymentTransactions } from "@/lib/cashflow-live";
import { readNdjsonStream } from "@/lib/ndjson-stream";
import { estimatePaymentSyncProgress, type PaymentSyncStats } from "@/lib/payment-sync-progress";
import { getMaxLastModified, withLastModifiedOverlap } from "./last-modified";
import type { PlanContext, RunContext, SyncEngine } from "./types";

/** Riadky priebehu z `/api/kros/payments` (NDJSON stream). */
type PaymentsStreamEvent =
  | ({ type: "progress"; phase: "payments"; companyName: string } & PaymentSyncStats)
  | PaymentsResultEvent;

type PaymentsResultEvent = { type: "result"; data?: unknown[]; errors?: { message?: string }[] };

/**
 * Sťahovanie firmy je jeden krok — zoznam účtov je proti pohybom krátky, takže
 * by ako vlastný krok zabral polovicu baru a ten by potom skočil na 50 % a
 * zvyšok sa vliekol. Účty preto dostanú len začiatok kroku.
 */
const ACCOUNTS_SHARE = 0.08;

export type CashflowSyncStep = {
  connection: KrosConnection;
  needsFullSync: boolean;
  lastModifiedTimestamp?: string;
};

export async function planCashflowSteps(ctx: PlanContext): Promise<CashflowSyncStep[]> {
  const steps: CashflowSyncStep[] = [];

  for (const connection of ctx.connections) {
    const meta = await readCashflowSyncMeta(cashflowCompanyMetaKey(connection.companyId));
    const needsFullSync = !meta?.completedAt;
    if (!needsFullSync && !ctx.isManualRefresh) continue;
    steps.push({
      connection,
      needsFullSync,
      lastModifiedTimestamp: meta?.lastModifiedTimestamp
    });
  }

  return steps;
}

async function fetchAccounts(connection: KrosConnection, signal: AbortSignal) {
  const response = await fetch("/api/kros/payments/accounts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ companyIds: [connection.companyId] }),
    signal
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error("Nepodarilo sa načítať payments dáta.");
  }
  if (Array.isArray(payload?.errors) && payload.errors.length > 0) {
    throw new Error(payload.errors[0]?.message ?? "Niektoré firmy sa nepodarilo načítať.");
  }
  return Array.isArray(payload?.data) ? (payload.data as unknown[]) : [];
}

async function fetchPayments(
  body: { companyIds: number[]; lastModifiedTimestamp?: string },
  ctx: RunContext
) {
  const response = await fetch("/api/kros/payments", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: ctx.signal
  });

  if (!response.ok || !response.body) {
    throw new Error("Nepodarilo sa načítať payments dáta.");
  }

  // Dáta prídu posledným riadkom streamu, dovtedy chodí priebeh sťahovania.
  const collected: { result: PaymentsResultEvent | null } = { result: null };
  let fraction = 0;
  await readNdjsonStream(response.body, (raw) => {
    const event = raw as PaymentsStreamEvent;
    if (event?.type === "result") {
      collected.result = event;
      return;
    }
    if (event?.type !== "progress") return;

    const estimate = estimatePaymentSyncProgress(event, { previousFraction: fraction });
    fraction = estimate.fraction;
    ctx.onProgress(
      ACCOUNTS_SHARE + (1 - ACCOUNTS_SHARE) * fraction,
      [`pohyby ${event.loaded}`, estimate.periodLabel].filter(Boolean).join(" · ")
    );
  });

  const payload = collected.result;
  if (!payload) {
    throw new Error("Nepodarilo sa načítať payments dáta — sťahovanie sa nedokončilo.");
  }
  if (Array.isArray(payload.errors) && payload.errors.length > 0) {
    throw new Error(payload.errors[0]?.message ?? "Niektoré firmy sa nepodarilo načítať.");
  }
  return Array.isArray(payload.data) ? payload.data : [];
}

export const cashflowEngine: SyncEngine<CashflowSyncStep> = {
  key: "cashflow",

  async hydrate(companyIds) {
    const [accounts, transactions] = await Promise.all([
      getCachedPaymentAccounts(companyIds),
      getCachedPaymentTransactions(companyIds)
    ]);
    return { accounts, transactions };
  },

  plan: planCashflowSteps,

  describe(step) {
    return {
      key: `${step.connection.companyId}:payments`,
      group: step.connection.companyName,
      label: "bankové účty a pohyby"
    };
  },

  async run(step, ctx) {
    const { connection, needsFullSync, lastModifiedTimestamp } = step;
    ctx.onProgress(ACCOUNTS_SHARE / 2, "bankové účty");

    // Zoznam účtov a zostatky sú malé a menia sa — sťahujú sa vždy celé.
    const rawAccounts = await fetchAccounts(connection, ctx.signal);
    const companyAccounts = normalizePaymentAccounts(rawAccounts).filter(
      (account) =>
        account.companyId === connection.companyId ||
        account.companyName === connection.companyName
    );
    await replaceCachedPaymentAccounts(connection.companyId, companyAccounts);

    if (ctx.signal.aborted) return;
    ctx.onProgress(ACCOUNTS_SHARE, "pohyby na účtoch");

    const accountById = new Map(companyAccounts.map((account) => [account.id, account]));
    const rawPayments = await fetchPayments(
      {
        companyIds: [connection.companyId],
        ...(!needsFullSync && lastModifiedTimestamp
          ? { lastModifiedTimestamp: withLastModifiedOverlap(lastModifiedTimestamp) }
          : {})
      },
      ctx
    );
    const companyTransactions: NormalizedPaymentTransaction[] = normalizePaymentTransactions(
      rawPayments,
      accountById
    ).filter(
      (transaction) =>
        transaction.companyId === connection.companyId ||
        transaction.companyName === connection.companyName
    );
    await upsertCachedPaymentTransactions(connection.companyId, companyTransactions);
    await writeCashflowSyncMeta({
      key: cashflowCompanyMetaKey(connection.companyId),
      companyId: connection.companyId,
      completedAt: new Date().toISOString(),
      lastModifiedTimestamp: getMaxLastModified(companyTransactions, lastModifiedTimestamp)
    });
  }
};
```

- [ ] **Step 4: Spusti test a over, že prechádza**

Run: `npx vitest run src/lib/sync/cashflow-engine.test.ts`
Expected: PASS, 4 testy.

- [ ] **Step 5: Prepni `src/app/cashflow/page.tsx` na orchestrátor**

Odstráň typy `PaymentsStreamEvent`, `PaymentsResultEvent`, konštantu `ACCOUNTS_SHARE`, funkcie `getMaxLastModified` a `withLastModifiedOverlap`, stavy `liveAccounts`, `liveTransactions`, `liveError`, `isLoadingLiveData`, `refreshNonce`, `hasResolvedFirstData`, `handledRefreshNonceRef`, `useSyncProgress()` a celý sync `useEffect`.

Nad komponentom:

```ts
const CASHFLOW_ENGINES = [cashflowEngine];
```

V tele, za `const syncConnections = companyFilter.companies;`:

```ts
  const {
    data: { accounts: liveAccounts, transactions: liveTransactions },
    isSyncing: isLoadingLiveData,
    hasResolvedFirstData,
    error: liveError,
    refresh
  } = useSyncOrchestrator(CASHFLOW_ENGINES, {
    connections,
    syncConnections,
    granularity,
    enabled: hasLoadedPersistedFilters
  });
```

Financie ako jediné `liveError` naozaj čítajú (`shouldShowMockData`), preto sa tu preberá z orchestrátora. `onRefresh` prepni na `refresh`.

- [ ] **Step 6: Over typy a testy**

Run: `npx tsc --noEmit && npm test`
Expected: bez chýb, všetky testy PASS.

- [ ] **Step 7: Over v prehliadači, že ukazovateľ priebehu funguje pri všetkých troch moduloch**

Otvor postupne `/`, `/expenses`, `/cashflow` a v každom klikni na obnovenie. Over, že sa ukazovateľ priebehu ukáže, dobehne a zmizne — a že prechod medzi modulmi uprostred sťahovania menu nezasekne.

- [ ] **Step 8: Commitni**

```bash
git add src/lib/sync src/app/cashflow/page.tsx
git commit -m "refactor(sync): financie sťahuje engine, nie stránka"
```

---

## Fáza 2 — routing a menu

### Task 7: Routing `/prijmy` + päťpoložkové menu

Po tejto úlohe je `/` prázdna kostra Domova a Príjmy žijú na `/prijmy`. Domov ešte nič neukazuje — to je zámer, aby sa presun dal overiť samostatne.

**Files:**
- Move: `src/app/page.tsx` → `src/app/prijmy/page.tsx`
- Create: `src/app/prijmy/layout.tsx`
- Create: `src/app/page.tsx` (nová kostra Domova)
- Modify: `src/components/app-nav.tsx`
- Modify: `src/app/layout.tsx` (`metadata.title.default`)
- Modify: `src/app/globals.css` (riadok 278 a riadok 344)

**Interfaces:**
- Consumes: `DashboardShell` z `@/components/dashboard-shell`.
- Produces: route `/prijmy`; route `/` s komponentom `HomePage`, ktorý úlohy 15–19 napĺňajú.

- [ ] **Step 1: Presuň Príjmy na `/prijmy`**

```bash
mkdir -p src/app/prijmy
git mv src/app/page.tsx src/app/prijmy/page.tsx
```

- [ ] **Step 2: Daj Príjmom vlastný titulok**

Vytvor `src/app/prijmy/layout.tsx` (rovnaký tvar ako `src/app/expenses/layout.tsx` — pozri si ho):

```tsx
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Príjmy"
};

export default function PrijmyLayout({ children }: { children: React.ReactNode }) {
  return children;
}
```

- [ ] **Step 3: Prehoď predvolený titulok na Domov**

V `src/app/layout.tsx` zmeň `default: "KROS Príjmy"` na `default: "KROS Domov"` a v komentári nad ním nahraď vetu „čo je modul Príjmy" za „čo je modul Domov".

- [ ] **Step 4: Vytvor kostru Domova**

Nový `src/app/page.tsx`:

```tsx
"use client";

import { DashboardShell } from "@/components/dashboard-shell";

/**
 * Domov — výcuc z ostatných modulov. Zámerne nemá vlastné sťahovanie navyše:
 * číta tie isté enginy ako moduly, takže `syncMeta` v IndexedDB vylučuje, aby
 * čokoľvek stiahol druhýkrát. Sekcie dopĺňajú ďalšie úlohy plánu.
 */
export default function HomePage() {
  return (
    <DashboardShell title="Domov">
      <section className="dashboard-body">
        <article className="panel">
          <p className="tag-filter-help">Domov sa práve stavia.</p>
        </article>
      </section>
    </DashboardShell>
  );
}
```

- [ ] **Step 5: Doplň Domov do menu**

V `src/components/app-nav.tsx` zmeň `href` položky Príjmy z `"/"` na `"/prijmy"` a **pred ňu** vlož novú položku:

```tsx
  {
    href: "/",
    label: "Domov",
    icon: (
      <>
        <path d="M4.5 10.4 12 4l7.5 6.4V20a1 1 0 0 1-1 1H5.5a1 1 0 0 1-1-1v-9.6Z" />
        <path d="M9.5 21v-5.2a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1V21" />
      </>
    )
  },
```

Ikona domčeka patrí Domovu, nie Príjmom — Príjmy dostanú vlastnú. Nahraď ikonu položky Príjmy touto (stúpajúca krivka s hrotom, odlíšiteľná od stĺpcov vo Financiách):

```tsx
      <>
        <path d="M4 16.5 9.2 11l3.4 3.2L20 7" />
        <path d="M15.2 7H20v4.8" />
      </>
```

- [ ] **Step 6: Rozšír mriežku menu na päť položiek**

**Pozor: `.mobile-liquid-nav` je v `globals.css` definované DVAKRÁT.** Raz na najvyššej úrovni (cca riadok 260) a znova celé v `@media (max-width: 760px)` (blok začína na cca riadku 2061). Na mobile vyhráva ten v media query — zmeniť len prvý výskyt by znamenalo, že sa na 375px nič nezmení a piata položka vytečie. To isté platí pre `.mobile-liquid-label`.

Over si to najprv:

```bash
grep -n "grid-template-columns: repeat(4" src/app/globals.css
grep -n "mobile-liquid-label" src/app/globals.css
```

V **oboch** výskytoch `grid-template-columns: repeat(4, minmax(0, 1fr));` vnútri `.mobile-liquid-nav` zmeň `4` na `5`. K tomu na najvyššej úrovni pridaj komentár:

```css
  /* Päť modulov: Domov, Príjmy, Výdavky, Financie, Nastavenia. Na 375px vychádza
     ~71 px na položku, preto je popisok o kúsok menší než pri štyroch.
     Pravidlo je zámerne aj v @media (max-width: 760px) — tam ho treba držať v zhode. */
  grid-template-columns: repeat(5, minmax(0, 1fr));
```

V **oboch** výskytoch `.mobile-liquid-label` zmeň `font-size: 0.72rem;` na `font-size: 0.66rem;`.

Po zmene over, že v súbore už nie je žiadny `repeat(4` v pravidle menu ani `0.72rem` v `.mobile-liquid-label`.

- [ ] **Step 7: Over typy, testy a build**

Run: `npx tsc --noEmit && npm test && npm run lint`
Expected: bez chýb.

- [ ] **Step 8: Over menu na mobile v prehliadači**

Otvor appku, nastav `resize_window` na preset `mobile` (375×812) a urob screenshot spodného menu.

Over:
1. Všetkých päť popiskov je celých — žiadny nie je odseknutý ani zalomený.
2. Klik na Príjmy vedie na `/prijmy` a modul funguje presne ako predtým.
3. Klik na Domov vedie na `/` a ukáže kostru.

Ak sa niektorý popisok neúplne vojde, zmenši `font-size` po `0.02rem` a zopakuj — **nie** skratkou textu. „Nastav." namiesto „Nastavenia" je horšie riešenie než o dva pixely menšie písmo.

- [ ] **Step 9: Commitni**

```bash
git add src/app src/components/app-nav.tsx
git commit -m "feat(nav): Domov na koreni, Príjmy na /prijmy"
```

---

## Fáza 3 — normalizácia a bumpy cache

### Task 8: Faktúry — splatnosť, stav úhrady a DPH

**Predpoklad:** `docs/superpowers/plans/2026-09-06-domov-kros-polia.md` existuje a je vyplnený zo skutočných odpovedí KROS API. **Prečítaj si ho pred prvým krokom** — obsahuje presné cesty k poliam aj tri zistenia, ktoré menia pôvodný zámer tejto úlohy.

**Files:**
- Modify: `src/lib/kros-types.ts`
- Modify: `src/lib/expenses-live.ts` (premenovanie typu, import zdieľanej mapy)
- Create: `src/lib/document-payment-status.ts`
- Modify: `src/lib/dashboard-live.ts` (`normalizeInvoices`)
- Modify: `src/lib/invoice-cache.ts` (`DB_VERSION` 3 → 4)
- Test: `src/lib/dashboard-live.test.ts` (nový súbor)

**Interfaces:**
- Consumes: zistenia z `docs/superpowers/plans/2026-09-06-domov-kros-polia.md`.
- Produces:
  - `type DocumentPaymentStatus = "notPaid" | "fullyPaid" | "overPaid" | "partiallyPaid" | "undefined"` (premenovaný `ExpensePaymentStatus`)
  - `NormalizedInvoice` navyše: `dueDate?: string`, `paymentStatus: DocumentPaymentStatus`, `vatAmount?: number`
  - `PAYMENT_STATUS_BY_CODE: Record<number, DocumentPaymentStatus>` v `src/lib/document-payment-status.ts`

#### Čo sa oproti pôvodnému zámeru NEROBÍ

Pôvodne mala táto úloha pridať fallback zo sumy v `legislativePrices` na `documentPrices`, ako to robia výdavky. **To sa nesmie urobiť.** Vzorka dokázala, že `documentPrices` je v mene dokladu a `legislativePrices` v eurách (pomer sa presne rovná `prices.exchangeRate`), a doklady chodia v EUR, CZK, PLN, GBP aj USD. Fallback by pri českej faktúre pripočítal do eurového súčtu 67 919 namiesto 2 695.

Rovnako sa nepotvrdilo tvrdenie o „latentnej chybe": vo vzorke nie je ani jeden doklad s nulovou legislatívnou a nenulovou dokladovou sumou. Čítanie sumy teda ostáva ako je — **len z `legislativePrices`**.

Dobropisy (`invoiceType: 1`) chodia z KROSu **už so záporným `totalPrice` aj `vatTotalPrice`**, takže `normalizeInvoices` nepotrebuje žiadnu logiku znamienok.

- [ ] **Step 1: Premenuj `ExpensePaymentStatus` na `DocumentPaymentStatus`**

Typ už nepatrí len výdavkom — vzorka potvrdila, že faktúry používajú tie isté kódy. V `src/lib/kros-types.ts` premenuj typ a uprav jeho komentár; potom oprav všetky miesta, ktoré ho používajú:

```bash
grep -rn "ExpensePaymentStatus" src/
```

Očakávané výskyty: definícia a `NormalizedExpense.paymentStatus` v `kros-types.ts`, import a `EXPENSE_PAYMENT_STATUS_BY_CODE` v `expenses-live.ts`.

- [ ] **Step 2: Vytiahni mapovanie kódov do zdieľaného modulu**

Vytvor `src/lib/document-payment-status.ts` a presuň doň obsah `EXPENSE_PAYMENT_STATUS_BY_CODE` z `src/lib/expenses-live.ts` (doslovne, aj s hodnotami — sú to `0` notPaid, `1` fullyPaid, `2` overPaid, `3` partiallyPaid, `-1` undefined):

```ts
import type { DocumentPaymentStatus } from "./kros-types";

/**
 * Kódy stavu úhrady z KROS API. Vzorka odpovedí potvrdila, že faktúry aj výdavky
 * používajú to isté číselníkovanie, preto mapa žije mimo oboch modulov —
 * dve kópie by sa časom rozišli.
 */
export const PAYMENT_STATUS_BY_CODE: Record<number, DocumentPaymentStatus> = {
  // sem presuň obsah pôvodnej EXPENSE_PAYMENT_STATUS_BY_CODE
};
```

V `src/lib/expenses-live.ts` nahraď lokálnu konštantu importom `PAYMENT_STATUS_BY_CODE` a uprav miesto, kde sa používa.

- [ ] **Step 3: Rozšír `NormalizedInvoice`**

V `src/lib/kros-types.ts` doplň do `NormalizedInvoice`:

```ts
  /** Dátum splatnosti — bez neho sa faktúra nedá zaradiť medzi po splatnosti. */
  dueDate?: string;
  paymentStatus: DocumentPaymentStatus;
  /**
   * DPH z dokladu v EUR (`prices.legislativePrices.vatTotalPrice`). Dobropis ju
   * nesie už zápornú, takže sa nikde neotáča znamienko. `undefined` znamená,
   * že ju KROS nevrátil — a to je iná správa než nula.
   */
  vatAmount?: number;
```

- [ ] **Step 4: Napíš padajúci test normalizácie**

Vytvor `src/lib/dashboard-live.test.ts`. Tvary zodpovedajú skutočnej odpovedi KROS API:

```ts
import { describe, expect, it } from "vitest";
import { normalizeInvoices } from "./dashboard-live";

/** Hlavička faktúry v tvare, aký naozaj vracia KROS. */
function rawInvoice(overrides: Record<string, unknown> = {}) {
  return {
    id: "inv-1",
    issueDate: "2026-08-01T00:00:00",
    deliveryDate: "2026-08-01T00:00:00",
    dueDate: "2026-08-31T00:00:00",
    invoiceType: 0,
    paymentStatus: 1,
    __company: "Kros Trade",
    __companyId: 1,
    prices: {
      documentPrices: { totalPrice: 100, vatTotalPrice: 20 },
      legislativePrices: { totalPrice: 100, vatTotalPrice: 20 },
      exchangeRate: 1,
      currency: "EUR"
    },
    ...overrides
  };
}

describe("normalizeInvoices — suma a mena", () => {
  it("berie legislatívnu sumu, ktorá je v eurách", () => {
    expect(normalizeInvoices([rawInvoice()])[0].totalPrice).toBe(100);
  });

  it("cudziu menu NEPREPOČÍTAVA z documentPrices — tá je v mene dokladu", () => {
    // Česká faktúra: 67 919,39 CZK = 2 695 EUR. Do súčtu patrí eurová hodnota.
    const raw = rawInvoice({
      prices: {
        documentPrices: { totalPrice: 67919.39, vatTotalPrice: 0 },
        legislativePrices: { totalPrice: 2695, vatTotalPrice: 0 },
        exchangeRate: 25.202,
        currency: "CZK"
      }
    });
    expect(normalizeInvoices([raw])[0].totalPrice).toBe(2695);
  });

  it("doklad bez cien dá nulu, nie NaN", () => {
    expect(normalizeInvoices([rawInvoice({ prices: {} })])[0].totalPrice).toBe(0);
  });
});

describe("normalizeInvoices — splatnosť a stav úhrady", () => {
  it("prevezme dátum splatnosti", () => {
    expect(normalizeInvoices([rawInvoice()])[0].dueDate).toBe("2026-08-31T00:00:00");
  });

  it("mapuje kód stavu úhrady", () => {
    expect(normalizeInvoices([rawInvoice({ paymentStatus: 0 })])[0].paymentStatus).toBe("notPaid");
    expect(normalizeInvoices([rawInvoice({ paymentStatus: 1 })])[0].paymentStatus).toBe("fullyPaid");
    expect(normalizeInvoices([rawInvoice({ paymentStatus: 3 })])[0].paymentStatus).toBe(
      "partiallyPaid"
    );
  });

  it("faktúra bez stavu úhrady dostane 'undefined', nie 'notPaid'", () => {
    const raw = rawInvoice();
    delete (raw as Record<string, unknown>).paymentStatus;
    expect(normalizeInvoices([raw])[0].paymentStatus).toBe("undefined");
  });

  it("neznámy kód dostane 'undefined', nie tichý fallback na zaplatené", () => {
    expect(normalizeInvoices([rawInvoice({ paymentStatus: 99 })])[0].paymentStatus).toBe(
      "undefined"
    );
  });
});

describe("normalizeInvoices — DPH", () => {
  it("berie DPH z legislatívnych cien", () => {
    expect(normalizeInvoices([rawInvoice()])[0].vatAmount).toBe(20);
  });

  it("chýbajúca DPH ostane undefined, nie nula", () => {
    const raw = rawInvoice({
      prices: { legislativePrices: { totalPrice: 100 }, exchangeRate: 1, currency: "EUR" }
    });
    expect(normalizeInvoices([raw])[0].vatAmount).toBeUndefined();
  });

  it("nulová DPH je nula — oslobodené plnenie nie je chýbajúci údaj", () => {
    const raw = rawInvoice({
      prices: {
        legislativePrices: { totalPrice: 100, vatTotalPrice: 0 },
        exchangeRate: 1,
        currency: "EUR"
      }
    });
    expect(normalizeInvoices([raw])[0].vatAmount).toBe(0);
  });

  it("dobropis nesie zápornú sumu aj zápornú DPH — znamienko sa nikde neotáča", () => {
    const raw = rawInvoice({
      invoiceType: 1,
      prices: {
        legislativePrices: { totalPrice: -40.65, vatTotalPrice: -9.35 },
        exchangeRate: 1,
        currency: "EUR"
      }
    });
    const invoice = normalizeInvoices([raw])[0];
    expect(invoice.totalPrice).toBe(-40.65);
    expect(invoice.vatAmount).toBe(-9.35);
  });
});
```

- [ ] **Step 5: Spusti test a over, že padá**

Run: `npx vitest run src/lib/dashboard-live.test.ts`
Expected: FAIL — testy na `dueDate`, `paymentStatus` a `vatAmount` padnú, lebo tie polia dnes `normalizeInvoices` nečíta.

- [ ] **Step 6: Uprav `normalizeInvoices`**

V `src/lib/dashboard-live.ts` nahraď dnešné čítanie sumy jasnejším prístupom k cenovej skupine. Suma sa **naďalej berie len z `legislativePrices`** — pribúda len čitateľnosť a DPH:

```ts
/**
 * Cenová skupina dokladu. `legislativePrices` je v účtovnej mene (EUR),
 * `documentPrices` v mene dokladu — preto analytiky čítajú výhradne
 * legislatívnu skupinu. Fallback medzi nimi by miešal meny: česká faktúra
 * má v dokladových cenách 67 919 CZK tam, kde legislatívne 2 695 EUR.
 */
function legislativePrices(row: Record<string, unknown>) {
  const prices = row.prices;
  if (!prices || typeof prices !== "object") return undefined;
  const group = (prices as Record<string, unknown>).legislativePrices;
  return group && typeof group === "object" ? (group as Record<string, unknown>) : undefined;
}

function readNumber(value: unknown) {
  const parsed = Number(value);
  return value !== undefined && value !== null && Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * DPH z dokladu. `undefined` = KROS pole nevrátil; nula je platná hodnota
 * (oslobodené plnenie, prenesená daňová povinnosť) a nesmie sa s tým zamieňať.
 * Dobropis nesie hodnotu už zápornú, takže sa znamienko neotáča.
 */
function readInvoiceVatAmount(row: Record<string, unknown>) {
  return readNumber(legislativePrices(row)?.vatTotalPrice);
}

function readPaymentStatus(row: Record<string, unknown>): DocumentPaymentStatus {
  const code = readNumber(row.paymentStatus);
  if (code === undefined) return "undefined";
  return PAYMENT_STATUS_BY_CODE[code] ?? "undefined";
}
```

Výpočet `totalPrice` nahraď za `readNumber(legislativePrices(row)?.totalPrice) ?? 0` a do vráteného objektu doplň:

```ts
        dueDate: readString(row, ["dueDate"]) ?? undefined,
        paymentStatus: readPaymentStatus(row),
        vatAmount: readInvoiceVatAmount(row),
```

Nezabudni na importy `DocumentPaymentStatus` a `PAYMENT_STATUS_BY_CODE`.

- [ ] **Step 7: Spusti test a over, že prechádza**

Run: `npx vitest run src/lib/dashboard-live.test.ts`
Expected: PASS, 12 testov.

- [ ] **Step 8: Zvýš verziu cache faktúr — jedným editom**

V `src/lib/invoice-cache.ts` nahraď komentár aj konštantu **naraz, jednou úpravou súboru**. Rozdelený edit by pri bežiacom HMR nechal živú stránku vykonať medzistav a cache by sa premazala dvakrát.

```ts
// v4: faktúra nesie dátum splatnosti, stav úhrady a sumu DPH — staršie záznamy
// tie polia nemajú, upgrade preto starú cache premaže a stiahne sa nanovo.
const DB_VERSION = 4;
```

- [ ] **Step 9: Over všetko a commitni**

Run: `npx tsc --noEmit && npm test && npm run lint`
Expected: bez chýb, všetky testy PASS.

```bash
git add src/lib
git commit -m "feat(invoices): splatnosť, stav úhrady a DPH z legislatívnych cien"
```

---

### Task 9: Výdavky — DPH

**Predpoklad:** prečítaj `docs/superpowers/plans/2026-09-06-domov-kros-polia.md`.

**Files:**
- Modify: `src/lib/kros-types.ts` (`NormalizedExpense`)
- Modify: `src/lib/expenses-live.ts` (`normalizeExpenses`)
- Modify: `src/lib/expense-cache.ts` (`DB_VERSION` 8 → 9)
- Test: `src/lib/expenses-live.test.ts` (nový súbor)

**Interfaces:**
- Consumes: `NormalizedExpense` z `@/lib/kros-types`.
- Produces: `NormalizedExpense.vatAmount?: number`.

- [ ] **Step 1: Rozšír `NormalizedExpense`**

V `src/lib/kros-types.ts` doplň do `NormalizedExpense`:

```ts
  /**
   * DPH z hlavičky dokladu v EUR (`prices.legislativePrices.vatTotalPrice`).
   * Dobropis ju nesie už zápornú, rovnako ako sumu — znamienko sa nikde
   * neotáča. `undefined` = KROS ju nevrátil (iná správa než nula).
   */
  vatAmount?: number;
```

- [ ] **Step 2: Napíš padajúci test**

Vytvor `src/lib/expenses-live.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { normalizeExpenses } from "./expenses-live";

function rawExpense(overrides: Record<string, unknown> = {}) {
  return {
    id: "exp-1",
    issueDate: "2026-08-01T00:00:00",
    documentType: 10,
    __company: "Kros Trade",
    __companyId: 1,
    prices: {
      documentPrices: { totalPrice: 3.53, vatTotalPrice: 0.67 },
      legislativePrices: { totalPrice: 3.53, vatTotalPrice: 0.67 },
      exchangeRate: 1,
      currency: "EUR"
    },
    ...overrides
  };
}

describe("normalizeExpenses — DPH", () => {
  it("berie DPH z legislatívnych cien", () => {
    expect(normalizeExpenses([rawExpense()])[0].vatAmount).toBe(0.67);
  });

  it("chýbajúca DPH ostane undefined, nie nula", () => {
    const raw = rawExpense({
      prices: { legislativePrices: { totalPrice: 3.53 }, exchangeRate: 1, currency: "EUR" }
    });
    expect(normalizeExpenses([raw])[0].vatAmount).toBeUndefined();
  });

  it("nulová DPH je nula, nie chýbajúci údaj", () => {
    const raw = rawExpense({
      prices: {
        legislativePrices: { totalPrice: 3.53, vatTotalPrice: 0 },
        exchangeRate: 1,
        currency: "EUR"
      }
    });
    expect(normalizeExpenses([raw])[0].vatAmount).toBe(0);
  });

  it("dobropis nesie zápornú sumu aj zápornú DPH tak, ako prišli z KROSu", () => {
    const raw = rawExpense({
      documentType: 17,
      prices: {
        legislativePrices: { totalPrice: -55.12, vatTotalPrice: -12.68 },
        exchangeRate: 1,
        currency: "EUR"
      }
    });
    const expense = normalizeExpenses([raw])[0];
    expect(expense.totalPrice).toBe(-55.12);
    expect(expense.vatAmount).toBe(-12.68);
  });
});
```

- [ ] **Step 3: Spusti test a over, že padá**

Run: `npx vitest run src/lib/expenses-live.test.ts`
Expected: FAIL — `vatAmount` neexistuje.

- [ ] **Step 4: Doplň čítanie DPH**

V `src/lib/expenses-live.ts` pridaj vedľa `readHeaderTotalPrice`:

```ts
/**
 * DPH z hlavičky dokladu, z legislatívnych cien (EUR). Na rozdiel od súm sa
 * NESKLADÁ z riadkov zaúčtovania — daň sa priraďuje dokladu ako celku
 * a rozpočítať ju na štítky by bol odhad, ktorý by sa tváril ako číslo
 * z účtovníctva. Znamienko sa neotáča: dobropis prichádza už záporný.
 */
function readHeaderVatAmount(row: Record<string, unknown>) {
  const prices = row.prices;
  if (!prices || typeof prices !== "object") return undefined;
  const group = (prices as Record<string, unknown>).legislativePrices;
  if (!group || typeof group !== "object") return undefined;
  const raw = (group as Record<string, unknown>).vatTotalPrice;
  const parsed = Number(raw);
  return raw !== undefined && raw !== null && Number.isFinite(parsed) ? parsed : undefined;
}
```

Do vráteného objektu v `normalizeExpenses` doplň `vatAmount: readHeaderVatAmount(row),` — **mimo** `applySign`.

- [ ] **Step 5: Spusti test a over, že prechádza**

Run: `npx vitest run src/lib/expenses-live.test.ts`
Expected: PASS, 4 testy.

- [ ] **Step 6: Zvýš verziu cache výdavkov — jedným editom**

V `src/lib/expense-cache.ts` nahraď komentár aj konštantu **naraz**:

```ts
// v9: doklad nesie sumu DPH — staršie záznamy ju nemajú, upgrade preto starú
// cache premaže a stiahne sa nanovo.
const DB_VERSION = 9;
```

- [ ] **Step 7: Over všetko a commitni**

Run: `npx tsc --noEmit && npm test && npm run lint`
Expected: bez chýb, všetky testy PASS.

```bash
git add src/lib
git commit -m "feat(expenses): doklad nesie sumu DPH"
```

---
### Task 10: Séria a KPI zisku

**Files:**
- Create: `src/lib/home-live.ts`
- Test: `src/lib/home-live.test.ts`

**Interfaces:**
- Consumes: `computeRevenueSeries` z `@/lib/dashboard-live`; `computeExpenseSeries` z `@/lib/expenses-live`; `getDeltaPct` z `@/lib/format`; `Granularity` z `@/lib/mock-data`; `NormalizedInvoice`, `NormalizedExpense` z `@/lib/kros-types`.
- Produces:
  - `type ProfitPoint = { label: string; income: number; expense: number; profit: number; previousIncome: number; previousExpense: number; previousProfit: number }`
  - `computeProfitSeries(input: { invoices; expenses; granularity; selectedTags: string[]; selectedCompanies: string[] }): ProfitPoint[]`
  - `type ProfitKpiValue = { current: number; previous: number; deltaPct: number | null }`
  - `type ProfitKpis = { periodLabel: string | null; profit: ProfitKpiValue; income: ProfitKpiValue; expense: ProfitKpiValue }`
  - `computeProfitKpis(points: ProfitPoint[], focusedPeriod?: string | null): ProfitKpis`

- [ ] **Step 1: Napíš padajúci test**

Vytvor `src/lib/home-live.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { computeProfitKpis, computeProfitSeries, type ProfitPoint } from "./home-live";
import type { NormalizedExpense, NormalizedInvoice } from "./kros-types";

const NOW = new Date();
const CURRENT_YEAR = NOW.getFullYear();

/** Prvý deň mesiaca — vždy dnes alebo v minulosti, takže nespadne za orez „do dnes". */
function firstDayOf(year: number, month: number) {
  return `${year}-${String(month + 1).padStart(2, "0")}-01`;
}

function invoice(date: string, totalPrice: number): NormalizedInvoice {
  return {
    id: `inv-${date}-${totalPrice}`,
    companyName: "Kros Trade",
    issueDate: date,
    deliveryDate: date,
    totalPrice,
    paymentStatus: "fullyPaid",
    tags: ["Retail"]
  };
}

function expense(date: string, totalPrice: number): NormalizedExpense {
  return {
    id: `exp-${date}-${totalPrice}`,
    companyName: "Kros Trade",
    documentType: 10,
    issueDate: date,
    deliveryDate: date,
    totalPrice,
    paymentStatus: "fullyPaid",
    hasAttachments: false,
    tags: ["Retail"],
    allocations: [{ tags: ["Retail"], amount: totalPrice }]
  };
}

function seriesInput(invoices: NormalizedInvoice[], expenses: NormalizedExpense[]) {
  return {
    invoices,
    expenses,
    granularity: "month" as const,
    selectedTags: [],
    selectedCompanies: []
  };
}

describe("computeProfitSeries", () => {
  it("zisk je príjmy mínus výdavky v tom istom stĺpci", () => {
    const date = firstDayOf(CURRENT_YEAR, 0);
    const points = computeProfitSeries(seriesInput([invoice(date, 1000)], [expense(date, 400)]));
    const january = points[0];
    expect(january.income).toBe(1000);
    expect(january.expense).toBe(400);
    expect(january.profit).toBe(600);
  });

  it("výdavky nad príjmami dajú záporný zisk — graf ho musí vedieť nakresliť", () => {
    const date = firstDayOf(CURRENT_YEAR, 0);
    const points = computeProfitSeries(seriesInput([invoice(date, 300)], [expense(date, 900)]));
    expect(points[0].profit).toBe(-600);
  });

  it("počíta aj vlaňajší zisk pre porovnanie", () => {
    const thisYear = firstDayOf(CURRENT_YEAR, 0);
    const lastYear = firstDayOf(CURRENT_YEAR - 1, 0);
    const points = computeProfitSeries(
      seriesInput(
        [invoice(thisYear, 1000), invoice(lastYear, 800)],
        [expense(thisYear, 400), expense(lastYear, 500)]
      )
    );
    expect(points[0].profit).toBe(600);
    expect(points[0].previousProfit).toBe(300);
  });

  it("stĺpce sú tie isté a v tom istom poradí ako v moduloch", () => {
    const points = computeProfitSeries(seriesInput([], []));
    expect(points.length).toBeGreaterThan(0);
    expect(points.every((point) => point.profit === 0)).toBe(true);
  });
});

describe("computeProfitKpis", () => {
  function point(label: string, income: number, expenseValue: number, prevProfit = 0): ProfitPoint {
    return {
      label,
      income,
      expense: expenseValue,
      profit: income - expenseValue,
      previousIncome: 0,
      previousExpense: 0,
      previousProfit: prevProfit
    };
  }

  it("bez focusu berie posledný stĺpec", () => {
    const kpis = computeProfitKpis([point("jan", 100, 40), point("feb", 200, 50)]);
    expect(kpis.periodLabel).toBe("feb");
    expect(kpis.profit.current).toBe(150);
  });

  it("focus stĺpca prepne hlavné číslo na ten stĺpec", () => {
    const kpis = computeProfitKpis([point("jan", 100, 40), point("feb", 200, 50)], "jan");
    expect(kpis.periodLabel).toBe("jan");
    expect(kpis.profit.current).toBe(60);
  });

  it("focus na neexistujúci stĺpec padne späť na posledný, nie na nulu", () => {
    const kpis = computeProfitKpis([point("jan", 100, 40)], "december");
    expect(kpis.periodLabel).toBe("jan");
    expect(kpis.profit.current).toBe(60);
  });

  it("bez vlaňajška je delta null, nie 100 % — nedá sa deliť nulou", () => {
    const kpis = computeProfitKpis([point("jan", 100, 40, 0)]);
    expect(kpis.profit.deltaPct).toBeNull();
  });

  it("prázdna séria dá nuly a nespadne", () => {
    const kpis = computeProfitKpis([]);
    expect(kpis.periodLabel).toBeNull();
    expect(kpis.profit.current).toBe(0);
  });
});
```

- [ ] **Step 2: Spusti test a over, že padá**

Run: `npx vitest run src/lib/home-live.test.ts`
Expected: FAIL — `Failed to resolve import "./home-live"`.

- [ ] **Step 3: Vytvor `src/lib/home-live.ts`**

```ts
import { computeRevenueSeries } from "./dashboard-live";
import { computeExpenseSeries } from "./expenses-live";
import { getDeltaPct } from "./format";
import type { Granularity } from "./mock-data";
import type { NormalizedExpense, NormalizedInvoice } from "./kros-types";

/**
 * Jeden stĺpec grafu Domova. Na rozdiel od modulov nenesie „tento rok vs. vlani",
 * ale príjmy a výdavky toho istého obdobia — porovnanie s vlaňajškom sa presunulo
 * do KPI a do tooltipu.
 */
export type ProfitPoint = {
  label: string;
  income: number;
  expense: number;
  profit: number;
  previousIncome: number;
  previousExpense: number;
  previousProfit: number;
};

type ProfitSeriesInput = {
  invoices: NormalizedInvoice[];
  expenses: NormalizedExpense[];
  granularity: Granularity;
  selectedTags: string[];
  selectedCompanies: string[];
};

/**
 * Príjmy aj výdavky bucketujú tie isté `buildBuckets`, takže sa dajú spojiť podľa
 * názvu stĺpca. Spájame podľa názvu, nie podľa indexu — index by tichým rozdielom
 * v jednej z dvoch sérií posunul celý graf o obdobie.
 */
export function computeProfitSeries({
  invoices,
  expenses,
  granularity,
  selectedTags,
  selectedCompanies
}: ProfitSeriesInput): ProfitPoint[] {
  const incomePoints = computeRevenueSeries({
    invoices,
    granularity,
    selectedTags,
    selectedCompanies
  });
  const expensePoints = computeExpenseSeries({
    expenses,
    granularity,
    selectedTags,
    selectedCompanies
  });
  const expenseByLabel = new Map(expensePoints.map((point) => [point.label, point]));

  return incomePoints.map((point) => {
    const spend = expenseByLabel.get(point.label);
    const expense = spend?.current ?? 0;
    const previousExpense = spend?.previous ?? 0;
    return {
      label: point.label,
      income: point.current,
      expense,
      profit: point.current - expense,
      previousIncome: point.previous,
      previousExpense,
      previousProfit: point.previous - previousExpense
    };
  });
}

export type ProfitKpiValue = {
  current: number;
  previous: number;
  /** `null` = vlani bola nula, percento by nedávalo zmysel. */
  deltaPct: number | null;
};

export type ProfitKpis = {
  /** Stĺpec, z ktorého sú čísla; `null` pri prázdnej sérii. */
  periodLabel: string | null;
  profit: ProfitKpiValue;
  income: ProfitKpiValue;
  expense: ProfitKpiValue;
};

function kpiValue(current: number, previous: number): ProfitKpiValue {
  return { current, previous, deltaPct: getDeltaPct(current, previous) };
}

/**
 * Hlavné čísla nad grafom. Klik do grafu ich prepne na vybraný stĺpec — inak by
 * číslo ukazovalo posledné obdobie, kým graf aj sekcie pod ním to focusnuté.
 */
export function computeProfitKpis(
  points: ProfitPoint[],
  focusedPeriod?: string | null
): ProfitKpis {
  const focused = focusedPeriod
    ? points.find((point) => point.label === focusedPeriod) ?? null
    : null;
  const point = focused ?? (points.length > 0 ? points[points.length - 1] : null);

  if (!point) {
    const empty = kpiValue(0, 0);
    return { periodLabel: null, profit: empty, income: empty, expense: empty };
  }

  return {
    periodLabel: point.label,
    profit: kpiValue(point.profit, point.previousProfit),
    income: kpiValue(point.income, point.previousIncome),
    expense: kpiValue(point.expense, point.previousExpense)
  };
}
```

- [ ] **Step 4: Spusti test a over, že prechádza**

Run: `npx vitest run src/lib/home-live.test.ts`
Expected: PASS, 9 testov.

- [ ] **Step 5: Commitni**

```bash
git add src/lib/home-live.ts src/lib/home-live.test.ts
git commit -m "feat(home): séria a KPI zisku"
```

---

### Task 11: Pohľadávky a záväzky

**Files:**
- Modify: `src/lib/home-live.ts`
- Modify: `src/lib/home-live.test.ts`

**Interfaces:**
- Consumes: `isExpenseUnpaid`, `countsTowardsSpend` z `@/lib/expenses-live`; `parseDocumentDate` z `@/lib/document-date`; `ProfitPoint` z Task 10.
- Produces:
  - `type DueBand = { key: "due" | "overdue" | "overdue60"; label: string; total: number; count: number }`
  - `type DuePosition = { total: number; count: number; bands: DueBand[] }`
  - `type DuePositions = { net: number; receivables: DuePosition; payables: DuePosition; receivablesAvailable: boolean }`
  - `computeDuePositions(input: { invoices; expenses; selectedTags: string[]; selectedCompanies: string[]; referenceDate?: Date }): DuePositions`

- [ ] **Step 1: Napíš padajúci test**

Doplň do `src/lib/home-live.test.ts` (pomocné funkcie `invoice` a `expense` z Task 10 rozšír o `overrides`, aby sa dal nastaviť `dueDate` a `paymentStatus`):

```ts
import { computeDuePositions } from "./home-live";

const REFERENCE = new Date("2026-09-06T12:00:00Z");

function unpaidInvoice(dueDate: string, totalPrice: number): NormalizedInvoice {
  return {
    id: `inv-${dueDate}-${totalPrice}`,
    companyName: "Kros Trade",
    issueDate: "2026-01-01",
    dueDate,
    totalPrice,
    paymentStatus: "notPaid",
    tags: ["Retail"]
  };
}

function unpaidExpense(dueDate: string, totalPrice: number): NormalizedExpense {
  return {
    id: `exp-${dueDate}-${totalPrice}`,
    companyName: "Kros Trade",
    documentType: 10,
    issueDate: "2026-01-01",
    dueDate,
    totalPrice,
    paymentStatus: "notPaid",
    hasAttachments: false,
    tags: ["Retail"],
    allocations: [{ tags: ["Retail"], amount: totalPrice }]
  };
}

function positions(invoices: NormalizedInvoice[], expenses: NormalizedExpense[]) {
  return computeDuePositions({
    invoices,
    expenses,
    selectedTags: [],
    selectedCompanies: [],
    referenceDate: REFERENCE
  });
}

describe("computeDuePositions", () => {
  it("uhradené doklady sa nerátajú", () => {
    const paid = { ...unpaidInvoice("2026-09-30", 500), paymentStatus: "fullyPaid" as const };
    expect(positions([paid], []).receivables.total).toBe(0);
  });

  it("faktúra pred splatnosťou ide do pásma 'v splatnosti'", () => {
    const result = positions([unpaidInvoice("2026-09-30", 500)], []);
    expect(result.receivables.total).toBe(500);
    expect(result.receivables.bands.find((band) => band.key === "due")?.total).toBe(500);
  });

  it("faktúra 10 dní po splatnosti ide do pásma 'po splatnosti', nie do 60+", () => {
    const result = positions([unpaidInvoice("2026-08-27", 500)], []);
    expect(result.receivables.bands.find((band) => band.key === "overdue")?.total).toBe(500);
    expect(result.receivables.bands.find((band) => band.key === "overdue60")?.total).toBe(0);
  });

  it("faktúra viac než 60 dní po splatnosti ide do vlastného pásma", () => {
    const result = positions([unpaidInvoice("2026-06-01", 500)], []);
    expect(result.receivables.bands.find((band) => band.key === "overdue60")?.total).toBe(500);
    expect(result.receivables.bands.find((band) => band.key === "overdue")?.total).toBe(0);
  });

  it("presne 60 dní ešte nie je 60+ — hranica sa nesmie prekrývať", () => {
    const result = positions([unpaidInvoice("2026-07-08", 500)], []);
    expect(result.receivables.bands.find((band) => band.key === "overdue60")?.total).toBe(0);
  });

  it("faktúra bez splatnosti sa ráta do celku, ale ako 'v splatnosti'", () => {
    const noDue = { ...unpaidInvoice("2026-09-30", 500), dueDate: undefined };
    const result = positions([noDue], []);
    expect(result.receivables.total).toBe(500);
    expect(result.receivables.bands.find((band) => band.key === "due")?.total).toBe(500);
  });

  it("záväzky majú len dve pásma — 60+ je otázka pre pohľadávky, nie pre vlastné dlhy", () => {
    const result = positions([], [unpaidExpense("2026-06-01", 300)]);
    expect(result.payables.bands.map((band) => band.key)).toEqual(["due", "overdue"]);
    expect(result.payables.total).toBe(300);
  });

  it("čistá pozícia je dostať mínus zaplatiť", () => {
    const result = positions([unpaidInvoice("2026-09-30", 900)], [unpaidExpense("2026-09-30", 400)]);
    expect(result.net).toBe(500);
  });

  it("faktúry bez stavu úhrady znamenajú nedostupné pohľadávky, nie nulové", () => {
    const unknown = { ...unpaidInvoice("2026-09-30", 500), paymentStatus: "undefined" as const };
    const result = positions([unknown], []);
    expect(result.receivablesAvailable).toBe(false);
  });

  it("aspoň jedna faktúra so známym stavom stačí na to, aby sa pohľadávky ukázali", () => {
    const unknown = { ...unpaidInvoice("2026-09-30", 500), paymentStatus: "undefined" as const };
    const result = positions([unknown, unpaidInvoice("2026-09-30", 200)], []);
    expect(result.receivablesAvailable).toBe(true);
    expect(result.receivables.total).toBe(200);
  });
});
```

- [ ] **Step 2: Spusti test a over, že padá**

Run: `npx vitest run src/lib/home-live.test.ts -t computeDuePositions`
Expected: FAIL — `computeDuePositions is not a function`.

- [ ] **Step 3: Doplň `computeDuePositions` do `src/lib/home-live.ts`**

```ts
import { countsTowardsSpend, isExpenseUnpaid } from "./expenses-live";
import { parseDocumentDate } from "./document-date";

const OVERDUE_60_DAYS_MS = 60 * 24 * 60 * 60 * 1000;

export type DueBand = {
  key: "due" | "overdue" | "overdue60";
  label: string;
  total: number;
  count: number;
};

export type DuePosition = {
  total: number;
  count: number;
  bands: DueBand[];
};

export type DuePositions = {
  /** Dostať mínus zaplatiť — „čiastka po vyrovnaní". */
  net: number;
  receivables: DuePosition;
  payables: DuePosition;
  /**
   * `false` znamená, že žiadna faktúra nenesie stav úhrady — teda že KROS to pole
   * nevracia. Sekcia potom ukáže „Údaj z KROS nedostupný", nie nulu: neuhradené
   * pohľadávky a chýbajúci údaj sú dve rôzne správy.
   */
  receivablesAvailable: boolean;
};

function bandFor(dueDate: string | undefined, referenceDate: Date, allowOverdue60: boolean) {
  const due = dueDate ? parseDocumentDate(dueDate) : null;
  // Doklad bez splatnosti nevieme označiť za omeškaný — do celku patrí, do
  // omeškania nie. Radšej ho podhodnotíme, než by sme niekoho obvinili z dlhu.
  if (!due || due >= referenceDate) return "due" as const;
  if (allowOverdue60 && referenceDate.getTime() - due.getTime() > OVERDUE_60_DAYS_MS) {
    return "overdue60" as const;
  }
  return "overdue" as const;
}

const BAND_LABELS: Record<DueBand["key"], string> = {
  due: "V splatnosti",
  overdue: "Po splatnosti",
  overdue60: "Po splatnosti nad 60 dní"
};

function toPosition(
  items: { amount: number; dueDate?: string }[],
  referenceDate: Date,
  bandKeys: DueBand["key"][]
): DuePosition {
  const allowOverdue60 = bandKeys.includes("overdue60");
  const totals = new Map<DueBand["key"], { total: number; count: number }>(
    bandKeys.map((key) => [key, { total: 0, count: 0 }])
  );

  for (const item of items) {
    const key = bandFor(item.dueDate, referenceDate, allowOverdue60);
    const bucket = totals.get(key);
    if (!bucket) continue;
    bucket.total += item.amount;
    bucket.count += 1;
  }

  const bands = bandKeys.map((key) => ({
    key,
    label: BAND_LABELS[key],
    total: Math.round(totals.get(key)?.total ?? 0),
    count: totals.get(key)?.count ?? 0
  }));

  return {
    total: bands.reduce((sum, band) => sum + band.total, 0),
    count: bands.reduce((sum, band) => sum + band.count, 0),
    bands
  };
}

type DuePositionsInput = {
  invoices: NormalizedInvoice[];
  expenses: NormalizedExpense[];
  selectedTags: string[];
  selectedCompanies: string[];
  referenceDate?: Date;
};

/**
 * Stav k dnešku, nie tok za obdobie: prepínač obdobia ani focus stĺpca sem
 * nezasahujú. Dlžoba nezaniká tým, že vznikla vlani.
 */
export function computeDuePositions({
  invoices,
  expenses,
  selectedTags,
  selectedCompanies,
  referenceDate = new Date()
}: DuePositionsInput): DuePositions {
  const tagSet = new Set(selectedTags);
  const companySet = new Set(selectedCompanies);
  const passes = (companyName: string, tags: string[]) =>
    (companySet.size === 0 || companySet.has(companyName)) &&
    (tagSet.size === 0 || tags.some((tag) => tagSet.has(tag)));

  const scopedInvoices = invoices.filter((invoice) =>
    passes(invoice.companyName, invoice.tags)
  );
  const receivablesAvailable = scopedInvoices.some(
    (invoice) => invoice.paymentStatus !== "undefined"
  );

  const receivables = toPosition(
    scopedInvoices
      .filter(
        (invoice) =>
          invoice.paymentStatus === "notPaid" || invoice.paymentStatus === "partiallyPaid"
      )
      .map((invoice) => ({ amount: invoice.totalPrice, dueDate: invoice.dueDate })),
    referenceDate,
    ["due", "overdue", "overdue60"]
  );

  const payables = toPosition(
    expenses
      .filter(
        (expense) =>
          countsTowardsSpend(expense) &&
          isExpenseUnpaid(expense) &&
          passes(expense.companyName, expense.tags)
      )
      .map((expense) => ({ amount: expense.totalPrice, dueDate: expense.dueDate })),
    referenceDate,
    ["due", "overdue"]
  );

  return {
    net: receivables.total - payables.total,
    receivables,
    payables,
    receivablesAvailable
  };
}
```

Poznámka k `isExpenseOverdue` z `expenses-live`: zámerne sa tu nepoužíva a v `Interfaces` preto nie je. Pásma potrebujú aj hranicu 60 dní, ktorú tá funkcia nepozná; `bandFor` je jediná definícia omeškania na Domove a rozhoduje pre pohľadávky aj záväzky rovnako.

- [ ] **Step 4: Spusti test a over, že prechádza**

Run: `npx vitest run src/lib/home-live.test.ts`
Expected: PASS, 19 testov.

- [ ] **Step 5: Commitni**

```bash
git add src/lib/home-live.ts src/lib/home-live.test.ts
git commit -m "feat(home): pohľadávky a záväzky po pásmach splatnosti"
```

---

### Task 12: Odhad DPH

**Predpoklad:** prečítaj `docs/superpowers/plans/2026-09-06-domov-kros-polia.md`, najmä bod o znamienkach.

**Files:**
- Modify: `src/lib/home-live.ts`
- Modify: `src/lib/home-live.test.ts`

**Interfaces:**
- Consumes: `getInvoiceAnalyticsDate` z `@/lib/dashboard-live`; `getExpenseAnalyticsDate`, `countsTowardsSpend` z `@/lib/expenses-live`; `parseDocumentDate` z `@/lib/document-date`; `monthKeyFromDate` z `@/lib/invoice-cache`.
- Produces:
  - `type VatMonthEstimate = { monthKey: string; amount: number | null; outputVat: number; inputVat: number }`
  - `type VatEstimate = { previousMonth: VatMonthEstimate; currentMonth: VatMonthEstimate }`
  - `computeVatEstimate(input: { invoices; expenses; selectedCompanies: string[]; referenceDate?: Date }): VatEstimate`

#### Znamienka: nič sa neotáča

Pôvodný zámer bol pri dobropise odpočítať DPH cez `-expense.vatAmount`. **To by bola chyba.** Vzorka odpovedí KROS API dokázala, že dobropis nesie zápornú DPH už z API (výdavkový dobropis: `totalPrice -55.12`, `vatTotalPrice -12.68`; faktúrový: `-40.65` / `-9.35`). Otočenie znamienka by zápornú daň zmenilo na kladnú a vstupnú DPH pri dobropise **zvýšilo** namiesto zníženia.

DPH sa preto len sčítava. Žiadny `isExpenseCreditNote`, žiadna práca so znamienkom.

- [ ] **Step 1: Napíš padajúci test**

Doplň do `src/lib/home-live.test.ts`:

```ts
import { computeVatEstimate } from "./home-live";

/** 6. september 2026 — „tento mesiac" je 2026-09, „minulý" 2026-08. */
const VAT_REFERENCE = new Date(2026, 8, 6);

function vatInvoice(deliveryDate: string, vatAmount: number | undefined): NormalizedInvoice {
  return {
    id: `inv-vat-${deliveryDate}-${vatAmount}`,
    companyName: "Kros Trade",
    issueDate: deliveryDate,
    deliveryDate,
    totalPrice: 1000,
    paymentStatus: "fullyPaid",
    vatAmount,
    tags: ["Retail"]
  };
}

function vatExpense(
  deliveryDate: string,
  vatAmount: number | undefined,
  documentType = 10
): NormalizedExpense {
  return {
    id: `exp-vat-${deliveryDate}-${vatAmount}-${documentType}`,
    companyName: "Kros Trade",
    documentType,
    issueDate: deliveryDate,
    deliveryDate,
    totalPrice: documentType === 17 ? -500 : 500,
    paymentStatus: "fullyPaid",
    hasAttachments: false,
    vatAmount,
    tags: ["Retail"],
    allocations: [{ tags: ["Retail"], amount: documentType === 17 ? -500 : 500 }]
  };
}

function vat(invoices: NormalizedInvoice[], expenses: NormalizedExpense[]) {
  return computeVatEstimate({
    invoices,
    expenses,
    selectedCompanies: [],
    referenceDate: VAT_REFERENCE
  });
}

describe("computeVatEstimate", () => {
  it("odhad je DPH na výstupe mínus DPH na vstupe", () => {
    const result = vat([vatInvoice("2026-09-02", 200)], [vatExpense("2026-09-03", 60)]);
    expect(result.currentMonth.outputVat).toBe(200);
    expect(result.currentMonth.inputVat).toBe(60);
    expect(result.currentMonth.amount).toBe(140);
  });

  it("triedi podľa dátumu dodania, nie vystavenia — DPH sa podáva podľa DUZP", () => {
    const result = vat([vatInvoice("2026-08-31", 100), vatInvoice("2026-09-01", 300)], []);
    expect(result.previousMonth.outputVat).toBe(100);
    expect(result.currentMonth.outputVat).toBe(300);
  });

  it("doklady mimo oboch mesiacov sa nerátajú", () => {
    const result = vat([vatInvoice("2026-07-15", 999)], []);
    expect(result.currentMonth.outputVat).toBe(0);
    expect(result.previousMonth.outputVat).toBe(0);
  });

  it("dobropis vstupnú daň znižuje — prichádza už so záporným znamienkom", () => {
    // KROS vracia pri dobropise zápornú DPH, takže stačí sčítať. Otočenie
    // znamienka by daň pripočítalo namiesto odpočítania.
    const result = vat([], [vatExpense("2026-09-03", 60), vatExpense("2026-09-04", -20, 17)]);
    expect(result.currentMonth.inputVat).toBe(40);
  });

  it("faktúrový dobropis znižuje daň na výstupe", () => {
    const result = vat([vatInvoice("2026-09-02", 200), vatInvoice("2026-09-05", -50)], []);
    expect(result.currentMonth.outputVat).toBe(150);
  });

  it("bez jediného dokladu s DPH je odhad null, nie nula", () => {
    const result = vat([vatInvoice("2026-09-02", undefined)], [vatExpense("2026-09-03", undefined)]);
    expect(result.currentMonth.amount).toBeNull();
  });

  it("nulová DPH na doklade je platný odhad nula", () => {
    const result = vat([vatInvoice("2026-09-02", 0)], []);
    expect(result.currentMonth.amount).toBe(0);
  });

  it("mesiace sú kalendárne bez ohľadu na prepínač obdobia", () => {
    const result = vat([], []);
    expect(result.previousMonth.monthKey).toBe("2026-08");
    expect(result.currentMonth.monthKey).toBe("2026-09");
  });

  it("január vracia december predchádzajúceho roka", () => {
    const result = computeVatEstimate({
      invoices: [],
      expenses: [],
      selectedCompanies: [],
      referenceDate: new Date(2026, 0, 10)
    });
    expect(result.previousMonth.monthKey).toBe("2025-12");
  });
});
```

- [ ] **Step 3: Spusti test a over, že padá**

Run: `npx vitest run src/lib/home-live.test.ts -t computeVatEstimate`
Expected: FAIL — `computeVatEstimate is not a function`.

- [ ] **Step 4: Doplň `computeVatEstimate` do `src/lib/home-live.ts`**

```ts
import { getInvoiceAnalyticsDate } from "./dashboard-live";
import { getExpenseAnalyticsDate } from "./expenses-live";
import { monthKeyFromDate } from "./invoice-cache";

export type VatMonthEstimate = {
  /** `2026-09` */
  monthKey: string;
  /**
   * Odhad dane. `null` znamená, že ani jeden doklad mesiaca nenesie sumu DPH —
   * teda že sa nedá spočítať, nie že vyšla nula.
   */
  amount: number | null;
  outputVat: number;
  inputVat: number;
};

export type VatEstimate = {
  previousMonth: VatMonthEstimate;
  currentMonth: VatMonthEstimate;
};

type VatInput = {
  invoices: NormalizedInvoice[];
  expenses: NormalizedExpense[];
  selectedCompanies: string[];
  referenceDate?: Date;
};

/**
 * Odhad DPH za kalendárne mesiace — vždy, bez ohľadu na prepínač obdobia.
 * Priznanie sa podáva po mesiacoch a po týždňoch alebo rokoch by to číslo
 * nemalo význam.
 *
 * Doklady sa zaraďujú podľa dátumu dodania (DUZP), rovnako ako v grafoch.
 * Filter štítkov sa nepoužíva: daň sa priraďuje dokladu ako celku a rozpočítať
 * ju na štítky by bol odhad tváriaci sa ako číslo z účtovníctva.
 */
export function computeVatEstimate({
  invoices,
  expenses,
  selectedCompanies,
  referenceDate = new Date()
}: VatInput): VatEstimate {
  const companySet = new Set(selectedCompanies);
  const inCompany = (companyName: string) =>
    companySet.size === 0 || companySet.has(companyName);

  const currentKey = monthKeyFromDate(referenceDate);
  const previousKey = monthKeyFromDate(
    new Date(referenceDate.getFullYear(), referenceDate.getMonth() - 1, 1)
  );

  const totals = new Map<string, { output: number; input: number; hasAny: boolean }>([
    [previousKey, { output: 0, input: 0, hasAny: false }],
    [currentKey, { output: 0, input: 0, hasAny: false }]
  ]);

  const bucketFor = (rawDate: string | undefined, companyName: string) => {
    if (!inCompany(companyName)) return null;
    const date = rawDate ? parseDocumentDate(rawDate) : null;
    if (!date) return null;
    return totals.get(monthKeyFromDate(date)) ?? null;
  };

  for (const invoice of invoices) {
    const bucket = bucketFor(getInvoiceAnalyticsDate(invoice), invoice.companyName);
    if (!bucket || invoice.vatAmount === undefined) continue;
    bucket.output += invoice.vatAmount;
    bucket.hasAny = true;
  }

  for (const expense of expenses) {
    if (!countsTowardsSpend(expense)) continue;
    const bucket = bucketFor(getExpenseAnalyticsDate(expense), expense.companyName);
    if (!bucket || expense.vatAmount === undefined) continue;
    // Bez otáčania znamienka: dobropis nesie zápornú DPH už z KROSu.
    bucket.input += expense.vatAmount;
    bucket.hasAny = true;
  }

  const toEstimate = (monthKey: string): VatMonthEstimate => {
    const bucket = totals.get(monthKey) ?? { output: 0, input: 0, hasAny: false };
    return {
      monthKey,
      outputVat: Math.round(bucket.output * 100) / 100,
      inputVat: Math.round(bucket.input * 100) / 100,
      amount: bucket.hasAny ? Math.round((bucket.output - bucket.input) * 100) / 100 : null
    };
  };

  return { previousMonth: toEstimate(previousKey), currentMonth: toEstimate(currentKey) };
}
```

- [ ] **Step 5: Spusti test a over, že prechádza**

Run: `npx vitest run src/lib/home-live.test.ts`
Expected: PASS, 27 testov.

- [ ] **Step 6: Commitni**

```bash
git add src/lib/home-live.ts src/lib/home-live.test.ts src/lib/expenses-live.ts
git commit -m "feat(home): odhad DPH za kalendárne mesiace"
```

---

### Task 13: Zisk podľa štítkov a podľa firiem

**Files:**
- Modify: `src/lib/home-live.ts`
- Modify: `src/lib/home-live.test.ts`

**Interfaces:**
- Consumes: `computeTagBreakdown`, `computeCompanyBreakdown` z `@/lib/dashboard-live`; `computeExpenseTagBreakdown`, `computeExpenseCompanyBreakdown` z `@/lib/expenses-live`; `PeriodWindow` z `@/lib/period-buckets`.
- Produces:
  - `type ProfitBreakdownPoint = { name: string; income: number; expense: number; profit: number; previousProfit: number }`
  - `computeProfitTagBreakdown(input: { invoices; expenses; selectedCompanies: string[]; period?: PeriodWindow }): ProfitBreakdownPoint[]`
  - `computeProfitCompanyBreakdown(input: { invoices; expenses; selectedTags: string[]; selectedCompanies: string[]; period?: PeriodWindow }): ProfitBreakdownPoint[]`

- [ ] **Step 1: Napíš padajúci test**

Doplň do `src/lib/home-live.test.ts`. Pomocné `invoice`/`expense` z Task 10 rozšír o štvrtý parameter na štítky a firmu:

```ts
import { computeProfitCompanyBreakdown, computeProfitTagBreakdown } from "./home-live";

function taggedInvoice(date: string, totalPrice: number, tags: string[]): NormalizedInvoice {
  return { ...invoice(date, totalPrice), id: `inv-${date}-${tags.join("-")}`, tags };
}

function taggedExpense(date: string, totalPrice: number, tags: string[]): NormalizedExpense {
  return {
    ...expense(date, totalPrice),
    id: `exp-${date}-${tags.join("-")}`,
    tags,
    allocations: [{ tags, amount: totalPrice }]
  };
}

describe("computeProfitTagBreakdown", () => {
  const date = firstDayOf(CURRENT_YEAR, NOW.getMonth());

  it("zisk štítku je jeho príjmy mínus jeho výdavky", () => {
    const points = computeProfitTagBreakdown({
      invoices: [taggedInvoice(date, 1000, ["Retail"])],
      expenses: [taggedExpense(date, 300, ["Retail"])],
      selectedCompanies: []
    });
    const retail = points.find((point) => point.name === "Retail");
    expect(retail).toMatchObject({ income: 1000, expense: 300, profit: 700 });
  });

  it("štítok len s výdavkami má záporný zisk a v zozname ostáva", () => {
    const points = computeProfitTagBreakdown({
      invoices: [],
      expenses: [taggedExpense(date, 400, ["Réžia"])],
      selectedCompanies: []
    });
    expect(points.find((point) => point.name === "Réžia")).toMatchObject({
      income: 0,
      expense: 400,
      profit: -400
    });
  });

  it("štítok len s príjmami sa nestratí", () => {
    const points = computeProfitTagBreakdown({
      invoices: [taggedInvoice(date, 500, ["Projekty"])],
      expenses: [],
      selectedCompanies: []
    });
    expect(points.find((point) => point.name === "Projekty")?.profit).toBe(500);
  });

  it("faktúra s dvoma štítkami sa započíta celá do oboch — priznaná nepresnosť", () => {
    const points = computeProfitTagBreakdown({
      invoices: [taggedInvoice(date, 600, ["Retail", "Projekty"])],
      expenses: [],
      selectedCompanies: []
    });
    expect(points.find((point) => point.name === "Retail")?.income).toBe(600);
    expect(points.find((point) => point.name === "Projekty")?.income).toBe(600);
  });

  it("zoradené od najziskovejšieho", () => {
    const points = computeProfitTagBreakdown({
      invoices: [taggedInvoice(date, 1000, ["A"]), taggedInvoice(date, 200, ["B"])],
      expenses: [],
      selectedCompanies: []
    });
    expect(points.map((point) => point.name)).toEqual(["A", "B"]);
  });
});

describe("computeProfitCompanyBreakdown", () => {
  const date = firstDayOf(CURRENT_YEAR, NOW.getMonth());

  it("zisk firmy je jej príjmy mínus jej výdavky", () => {
    const points = computeProfitCompanyBreakdown({
      invoices: [invoice(date, 900)],
      expenses: [expense(date, 200)],
      selectedTags: [],
      selectedCompanies: []
    });
    expect(points.find((point) => point.name === "Kros Trade")).toMatchObject({
      income: 900,
      expense: 200,
      profit: 700
    });
  });

  it("firma len s výdavkami sa v zozname objaví", () => {
    const onlySpend: NormalizedExpense = { ...expense(date, 300), companyName: "Kros Servis" };
    const points = computeProfitCompanyBreakdown({
      invoices: [],
      expenses: [onlySpend],
      selectedTags: [],
      selectedCompanies: []
    });
    expect(points.find((point) => point.name === "Kros Servis")?.profit).toBe(-300);
  });
});
```

- [ ] **Step 2: Spusti test a over, že padá**

Run: `npx vitest run src/lib/home-live.test.ts -t Breakdown`
Expected: FAIL — `computeProfitTagBreakdown is not a function`.

- [ ] **Step 3: Doplň obe funkcie do `src/lib/home-live.ts`**

```ts
import { computeCompanyBreakdown, computeTagBreakdown } from "./dashboard-live";
import { computeExpenseCompanyBreakdown, computeExpenseTagBreakdown } from "./expenses-live";
import type { PeriodWindow } from "./period-buckets";
import type { AggregatedBreakdownPoint } from "./kros-types";

/**
 * Jeden riadok rozpisu zisku. Nesie aj obe zložky, lebo samotný zisk sa bez nich
 * nedá prečítať — „−400 €" je iná správa pri štítku bez príjmov než pri štítku,
 * ktorý zarobil 10 000 a minul 10 400.
 */
export type ProfitBreakdownPoint = {
  name: string;
  income: number;
  expense: number;
  profit: number;
  previousProfit: number;
};

/**
 * Spojí príjmovú a výdavkovú stranu podľa názvu. Zjednotenie, nie prienik: štítok
 * alebo firma, ktorá má len jednu stranu, musí byť v zozname vidieť — inak by
 * čisté nákladové stredisko z prehľadu zmizlo.
 */
function mergeBreakdowns(
  incomePoints: AggregatedBreakdownPoint[],
  expensePoints: AggregatedBreakdownPoint[]
): ProfitBreakdownPoint[] {
  const incomeByName = new Map(incomePoints.map((point) => [point.name, point]));
  const expenseByName = new Map(expensePoints.map((point) => [point.name, point]));
  const names = new Set([...incomeByName.keys(), ...expenseByName.keys()]);

  return Array.from(names)
    .map((name) => {
      const income = incomeByName.get(name);
      const expense = expenseByName.get(name);
      const incomeAmount = income?.amount ?? 0;
      const expenseAmount = expense?.amount ?? 0;
      return {
        name,
        income: incomeAmount,
        expense: expenseAmount,
        profit: incomeAmount - expenseAmount,
        previousProfit: (income?.previousAmount ?? 0) - (expense?.previousAmount ?? 0)
      };
    })
    .sort((a, b) => b.profit - a.profit);
}

/**
 * Zisk na štítok.
 *
 * POZOR na asymetriu, ktorú tu nemáme ako odstrániť: faktúra s viacerými štítkami
 * sa započíta CELÁ do každého z nich (tak počíta `computeTagBreakdown`), kým výdavok
 * sa rozdelí podľa rozúčtovania. Súčet riadkov preto nedá celkový zisk a pri
 * viacštítkových faktúrach je nadhodnotený. Sekcia to musí povedať textom —
 * predstierať presnosť, ktorú dáta nemajú, je horšie než ju priznať.
 */
export function computeProfitTagBreakdown({
  invoices,
  expenses,
  selectedCompanies,
  period
}: {
  invoices: NormalizedInvoice[];
  expenses: NormalizedExpense[];
  selectedCompanies: string[];
  period?: PeriodWindow;
}): ProfitBreakdownPoint[] {
  return mergeBreakdowns(
    computeTagBreakdown(invoices, selectedCompanies, period),
    computeExpenseTagBreakdown(expenses, selectedCompanies, period)
  );
}

export function computeProfitCompanyBreakdown({
  invoices,
  expenses,
  selectedTags,
  selectedCompanies,
  period
}: {
  invoices: NormalizedInvoice[];
  expenses: NormalizedExpense[];
  selectedTags: string[];
  selectedCompanies: string[];
  period?: PeriodWindow;
}): ProfitBreakdownPoint[] {
  return mergeBreakdowns(
    computeCompanyBreakdown(invoices, selectedTags, selectedCompanies, period),
    computeExpenseCompanyBreakdown(expenses, selectedTags, selectedCompanies, period)
  );
}
```

- [ ] **Step 4: Spusti test a over, že prechádza**

Run: `npx vitest run src/lib/home-live.test.ts`
Expected: PASS, 34 testov.

- [ ] **Step 5: Over celý balík a commitni**

Run: `npx tsc --noEmit && npm test && npm run lint`
Expected: bez chýb.

```bash
git add src/lib/home-live.ts src/lib/home-live.test.ts
git commit -m "feat(home): zisk podľa štítkov a podľa firiem"
```

---

## Fáza 5 — obrazovka

### Task 14: Komponent grafu zisku

Nový komponent s vlastnými CSS triedami. Triedy `.bar-*` sa **nemenia** — visia na nich Príjmy aj Výdavky a ich stĺpce znamenajú niečo iné (tento rok vs. vlani). Prerábať ich by znamenalo meniť dva fungujúce moduly kvôli tretiemu.

**Files:**
- Create: `src/components/profit-chart.tsx`
- Modify: `src/app/globals.css` (nový blok na konci, pred prípadné media queries)

**Interfaces:**
- Consumes: `ProfitPoint` z `@/lib/home-live`; `formatCurrency` z `@/lib/format`.
- Produces: `<ProfitChart points={ProfitPoint[]} focusedPeriod={string | null} onFocusedPeriodChange={(label: string | null) => void} />`

- [ ] **Step 1: Vytvor `src/components/profit-chart.tsx`**

```tsx
"use client";

import type { ProfitPoint } from "@/lib/home-live";
import { formatCurrency } from "@/lib/format";

type Props = {
  points: ProfitPoint[];
  focusedPeriod: string | null;
  onFocusedPeriodChange?: (label: string | null) => void;
};

/**
 * Stĺpce sú príjmy a výdavky toho istého obdobia, čiara nad nimi je zisk.
 *
 * Všetko na JEDNEJ škále v eurách. Dve osi pre rovnaké jednotky by boli spôsob,
 * ako číslami klamať — čiara zisku by mohla vyzerať vysoko nad stĺpcami, aj keby
 * bol zisk zlomok príjmov. Cena za poctivosť je, že pri zápornom zisku sa nulová
 * čiara odlepí od spodku grafu; presne to je aj zmysel: stratový mesiac má byť
 * vidieť na prvý pohľad.
 */
export function ProfitChart({ points, focusedPeriod, onFocusedPeriodChange }: Props) {
  if (points.length === 0) {
    return <p className="tag-filter-help">Pre toto obdobie nemáme žiadne doklady.</p>;
  }

  const values = points.flatMap((point) => [point.income, point.expense, point.profit]);
  // Nula je vždy v škále, aj keď sú všetky hodnoty kladné — inak by stĺpce
  // začínali „odniekiaľ" a ich výška by nič neznamenala.
  const max = Math.max(0, ...values);
  const min = Math.min(0, ...values);
  const span = max - min || 1;
  /** Kde leží nula, merané odspodu grafu. */
  const zeroPct = ((0 - min) / span) * 100;

  const heightPct = (value: number) => (Math.abs(value) / span) * 100;
  const bottomPct = (value: number) => (value >= 0 ? zeroPct : zeroPct - heightPct(value));

  // Čiara zisku je jedno SVG cez celú mriežku. `preserveAspectRatio="none"` ju
  // roztiahne presne na šírku stĺpcov, takže body sedia na stredy stĺpcov bez
  // ohľadu na to, koľko ich je.
  const stepX = 100;
  const viewBoxWidth = points.length * stepX;
  const lineY = (value: number) => ((max - value) / span) * 100;
  const linePoints = points
    .map((point, index) => `${index * stepX + stepX / 2},${lineY(point.profit)}`)
    .join(" ");

  return (
    <div className="profit-chart-wrap">
      <svg
        className="profit-chart-line"
        viewBox={`0 0 ${viewBoxWidth} 100`}
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <line
          className="profit-chart-zero"
          x1="0"
          x2={viewBoxWidth}
          y1={lineY(0)}
          y2={lineY(0)}
          vectorEffect="non-scaling-stroke"
        />
        <polyline points={linePoints} vectorEffect="non-scaling-stroke" />
        {points.map((point, index) => (
          <circle
            key={point.label}
            cx={index * stepX + stepX / 2}
            cy={lineY(point.profit)}
            r="2"
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </svg>

      <div
        className={focusedPeriod ? "profit-chart has-period-focus" : "profit-chart"}
        role="group"
        aria-label="Príjmy, výdavky a zisk po obdobiach"
      >
        {points.map((point, index) => {
          const isFocused = focusedPeriod === point.label;
          return (
            <button
              type="button"
              key={point.label}
              className={`profit-bar-item${isFocused ? " is-period-focused" : ""}`}
              style={{ "--bar-index": index } as React.CSSProperties}
              aria-pressed={isFocused}
              aria-label={`${point.label}: zisk ${formatCurrency(point.profit)}`}
              onClick={() => onFocusedPeriodChange?.(isFocused ? null : point.label)}
            >
              {isFocused ? (
                <div className="chart-tooltip chart-tooltip-inline" aria-live="polite">
                  <strong>{point.label}</strong>
                  <span>Príjmy: {formatCurrency(point.income)}</span>
                  <span>Výdavky: {formatCurrency(point.expense)}</span>
                  <span>Zisk: {formatCurrency(point.profit)}</span>
                  <span className="profit-tooltip-previous">
                    Vlani: {formatCurrency(point.previousProfit)}
                  </span>
                </div>
              ) : null}

              <div className="profit-bar-stack">
                <div
                  className="profit-bar income"
                  style={{ height: `${heightPct(point.income)}%`, bottom: `${bottomPct(point.income)}%` }}
                />
                <div
                  className="profit-bar expense"
                  style={{
                    height: `${heightPct(point.expense)}%`,
                    bottom: `${bottomPct(point.expense)}%`
                  }}
                />
              </div>
              <p>{point.label}</p>
            </button>
          );
        })}
      </div>

      <ul className="profit-chart-legend">
        <li className="income">Príjmy</li>
        <li className="expense">Výdavky</li>
        <li className="profit">Zisk</li>
      </ul>
    </div>
  );
}
```

- [ ] **Step 2: Doplň CSS**

Na koniec `src/app/globals.css` pridaj (`.bar-*` triedy nechaj bez zmeny):

```css
/*
 * Graf Domova: stĺpce Príjmy/Výdavky a čiara zisku na jednej škále. Stĺpce sa
 * polohujú od NULOVEJ ČIARY, nie od spodku — pri zápornom zisku sa nula odlepí
 * od dna a čiara klesne pod ňu. Preto vlastné triedy a nie `.bar-*`: tie držia
 * Príjmy aj Výdavky, kde stĺpce znamenajú tento rok vs. vlani.
 */
.profit-chart-wrap {
  position: relative;
}

.profit-chart {
  display: flex;
  flex-wrap: nowrap;
  padding: 0.32rem 0.5rem;
  width: 100%;
}

.profit-bar-item {
  align-items: center;
  background: transparent;
  border: 0;
  color: inherit;
  cursor: pointer;
  display: flex;
  flex: 1 1 0;
  flex-direction: column;
  gap: 0.4rem;
  min-width: 32px;
  padding: 0;
  position: relative;
  animation: revenue-bar-in 520ms cubic-bezier(0.2, 0.8, 0.2, 1) both;
  animation-delay: calc(var(--bar-index, 0) * 55ms);
}

.profit-bar-item p {
  color: var(--muted);
  font-size: 0.78rem;
  margin: 0;
}

.profit-bar-item.is-period-focused {
  z-index: 30;
}

.profit-bar-item.is-period-focused p {
  color: #eff2ff;
}

.profit-bar-stack {
  display: flex;
  gap: 0.2rem;
  height: clamp(170px, 33vw, 220px);
  justify-content: center;
  position: relative;
  width: 100%;
}

.profit-bar {
  border-radius: 8px;
  position: absolute;
  width: 13px;
}

.profit-bar.income {
  background: linear-gradient(180deg, #9cb4ff 0%, #7b99ff 38%, #5d78e6 100%);
  box-shadow: 0 5px 12px rgba(92, 125, 242, 0.38);
  right: calc(50% + 0.1rem);
}

.profit-bar.expense {
  background: linear-gradient(180deg, #fcd34d 0%, #f6b73c 40%, #d98b18 100%);
  box-shadow: 0 5px 12px rgba(217, 139, 24, 0.32);
  left: calc(50% + 0.1rem);
}

/* Čiara zisku leží NAD stĺpcami, ale nesmie brať kliky — tie patria stĺpcom. */
.profit-chart-line {
  height: clamp(170px, 33vw, 220px);
  left: 0.5rem;
  pointer-events: none;
  position: absolute;
  top: 0.32rem;
  width: calc(100% - 1rem);
  z-index: 10;
}

.profit-chart-line polyline {
  fill: none;
  stroke: #f0f4ff;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 2;
}

.profit-chart-line circle {
  fill: #f0f4ff;
  stroke: none;
}

.profit-chart-zero {
  stroke: rgba(226, 234, 255, 0.28);
  stroke-dasharray: 3 4;
  stroke-width: 1;
}

.profit-chart.has-period-focus .profit-bar-item:not(.is-period-focused) .profit-bar-stack,
.profit-chart.has-period-focus .profit-bar-item:not(.is-period-focused) p {
  opacity: 0.42;
}

.profit-chart-legend {
  display: flex;
  gap: 0.9rem;
  justify-content: center;
  list-style: none;
  margin: 0.4rem 0 0;
  padding: 0;
}

.profit-chart-legend li {
  align-items: center;
  color: var(--muted);
  display: flex;
  font-size: 0.72rem;
  gap: 0.32rem;
}

.profit-chart-legend li::before {
  border-radius: 3px;
  content: "";
  height: 8px;
  width: 8px;
}

.profit-chart-legend li.income::before {
  background: #7b99ff;
}

.profit-chart-legend li.expense::before {
  background: #f6b73c;
}

.profit-chart-legend li.profit::before {
  background: #f0f4ff;
}

.profit-tooltip-previous {
  color: var(--muted);
}
```

- [ ] **Step 3: Over typy a lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: bez chýb.

- [ ] **Step 4: Commitni**

```bash
git add src/components/profit-chart.tsx src/app/globals.css
git commit -m "feat(home): graf zisku s nulovou osou a čiarou zisku"
```

---

### Task 15: Stránka Domov + panel Zisk firmy

**Files:**
- Modify: `src/lib/preferences/registry.ts` (nové kľúče)
- Modify: `src/lib/use-persisted-collapsed.ts` (ak obmedzuje typ kľúča na zoznam)
- Modify: `src/app/page.tsx`
- Create: `src/components/profit-dashboard.tsx`

**Interfaces:**
- Consumes: `useSyncOrchestrator` a všetky tri enginy zo `@/lib/sync/*`; `computeProfitSeries`, `computeProfitKpis` z `@/lib/home-live`; `ProfitChart` z `@/components/profit-chart`; `usePreference`, `useKrosConnections`, `applyCompanyFilter`, `getBucketPeriodWindow`, `DashboardShell`, `ModuleSkeleton`, `DemoDataBanner`, `FilterMismatchNotice`.
- Produces:
  - predvoľby `home.tagFilters`, `home.companies`, `ui.homeHiddenSections`, `ui.collapsed.homeCompanies`, `ui.collapsed.homeReceivables`, `ui.collapsed.homeAccounts`, `ui.collapsed.homeVat`
  - `HOME_SECTIONS` v `src/app/page.tsx`
  - `<ProfitDashboard kpis points focusedPeriod onFocusedPeriodChange />`

- [ ] **Step 1: Pridaj predvoľby do registra**

V `src/lib/preferences/registry.ts` doplň do `PreferenceValueMap`:

```ts
  /** Filter štítkov Domova — vlastný, nie zdieľaný s modulmi: zmena tu nesmie prestaviť Príjmy. */
  "home.tagFilters": Record<string, string[]>;
  "home.companies": string[];
  "ui.homeHiddenSections": string[];
  "ui.collapsed.homeCompanies": boolean;
  "ui.collapsed.homeReceivables": boolean;
  "ui.collapsed.homeAccounts": boolean;
  "ui.collapsed.homeVat": boolean;
```

a do `PREFERENCE_KEYS`:

```ts
  "home.tagFilters": {
    level: "tenant",
    storageKey: "kros_dashboard_home_selected_tags",
    default: {},
    isValid: isTagFilters,
    normalize: normalizeTagFilters
  },
  "home.companies": {
    level: "tenant",
    storageKey: "kros_dashboard_home_selected_companies",
    default: [],
    isValid: isStringArray
  },
  "ui.homeHiddenSections": {
    level: "user",
    storageKey: "kros_dashboard_home_hidden_sections",
    default: [],
    isValid: isStringArray
  },
  "ui.collapsed.homeCompanies": collapsedPanel("kros_dashboard_home_collapsed_companies"),
  "ui.collapsed.homeReceivables": collapsedPanel("kros_dashboard_home_collapsed_receivables"),
  "ui.collapsed.homeAccounts": collapsedPanel("kros_dashboard_home_collapsed_accounts"),
  "ui.collapsed.homeVat": collapsedPanel("kros_dashboard_home_collapsed_vat"),
```

Úrovne sú zámerné: filtre patria firme (tenant), skrývanie a zbaľovanie jednému človeku (user). Test v `src/lib/preferences/resolve.test.ts` to stráži.

- [ ] **Step 2: Over, že existujúce testy predvolieb prechádzajú**

Run: `npx vitest run src/lib/preferences`
Expected: PASS. Ak `resolve.test.ts` padne na tom, že ergonomický kľúč prepadol na firemnú úroveň, oprav `level` podľa jeho hlášky.

- [ ] **Step 3: Vytvor `src/components/profit-dashboard.tsx`**

```tsx
"use client";

import { ProfitChart } from "@/components/profit-chart";
import type { ProfitKpiValue, ProfitKpis, ProfitPoint } from "@/lib/home-live";
import { formatCurrency, formatDelta } from "@/lib/format";

type Props = {
  kpis: ProfitKpis;
  points: ProfitPoint[];
  focusedPeriod: string | null;
  onFocusedPeriodChange?: (label: string | null) => void;
};

function DeltaBadge({ value }: { value: ProfitKpiValue }) {
  // Bez vlaňajška percento neexistuje. Prázdny odznak je lepší než „+100 %",
  // ktoré by tvrdilo rast tam, kde sa nie je s čím porovnať.
  if (value.deltaPct === null) return null;
  return (
    <span className={value.deltaPct >= 0 ? "delta-badge up" : "delta-badge down"}>
      {formatDelta(value.deltaPct)}
    </span>
  );
}

export function ProfitDashboard({ kpis, points, focusedPeriod, onFocusedPeriodChange }: Props) {
  return (
    <section className="dashboard-body">
      <article className="panel">
        <header className="panel-head">
          <h3>Zisk firmy</h3>
        </header>

        <p className="profit-headline">{formatCurrency(kpis.profit.current)}</p>
        <p className="profit-headline-meta">
          {kpis.periodLabel ?? "—"} <DeltaBadge value={kpis.profit} />
        </p>

        <ProfitChart
          points={points}
          focusedPeriod={focusedPeriod}
          onFocusedPeriodChange={onFocusedPeriodChange}
        />

        <div className="profit-kpi-row">
          <div>
            <span className="profit-kpi-label">Príjmy</span>
            <strong>{formatCurrency(kpis.income.current)}</strong>
            <DeltaBadge value={kpis.income} />
          </div>
          <div>
            <span className="profit-kpi-label">Výdavky</span>
            <strong>{formatCurrency(kpis.expense.current)}</strong>
            <DeltaBadge value={kpis.expense} />
          </div>
        </div>
      </article>
    </section>
  );
}
```

Ak trieda `delta-badge` v `globals.css` neexistuje pod týmto názvom, nájdi si, ako zelený/červený odznak rieši `revenue-dashboard.tsx`, a použi tú istú triedu — nový vzhľad pre to isté nevymýšľaj.

Doplň do `globals.css`:

```css
.profit-headline {
  font-size: 2.1rem;
  font-weight: 700;
  letter-spacing: -0.02em;
  margin: 0.2rem 0 0;
}

.profit-headline-meta {
  align-items: center;
  color: var(--muted);
  display: flex;
  font-size: 0.8rem;
  gap: 0.4rem;
  margin: 0.1rem 0 0.6rem;
}

.profit-kpi-row {
  display: grid;
  gap: 0.8rem;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  margin-top: 0.7rem;
}

.profit-kpi-row > div {
  align-items: baseline;
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
}

.profit-kpi-label {
  color: var(--muted);
  flex-basis: 100%;
  font-size: 0.76rem;
}
```

- [ ] **Step 4: Napíš stránku Domov**

Nahraď obsah `src/app/page.tsx`:

```tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { DashboardShell } from "@/components/dashboard-shell";
import { ModuleSkeleton } from "@/components/module-skeleton";
import { DemoDataBanner } from "@/components/demo-data-banner";
import { FilterMismatchNotice } from "@/components/filter-mismatch-notice";
import { ProfitDashboard } from "@/components/profit-dashboard";
import type { VisibilityOption } from "@/components/category-visibility-button";
import { computeProfitKpis, computeProfitSeries } from "@/lib/home-live";
import { getBucketPeriodWindow } from "@/lib/period-buckets";
import { useKrosConnections } from "@/lib/use-kros-connections";
import { usePreference } from "@/lib/use-preference";
import { applyCompanyFilter } from "@/lib/preferences/company-filter";
import { documentMatchesTagFilters } from "@/lib/tag-categories";
import { useSyncOrchestrator } from "@/lib/sync/use-sync-orchestrator";
import { invoiceEngine } from "@/lib/sync/invoice-engine";
import { expenseEngine } from "@/lib/sync/expense-engine";
import { cashflowEngine } from "@/lib/sync/cashflow-engine";

/**
 * Domov ťahá VŠETKY tri domény. Nie je to sťahovanie navyše: enginy sú tie isté,
 * aké používajú moduly, a `syncMeta` v IndexedDB je jediný zdroj pravdy o tom, čo
 * je hotové — čo dotiahne Domov, to už modul nesťahuje, a naopak.
 *
 * Pole je modulová konštanta, nie literál v tele komponentu: inak by sa efekt
 * orchestrátora spustil pri každom rendere odznova.
 */
const HOME_ENGINES = [invoiceEngine, expenseEngine, cashflowEngine];

/** Id pevných sekcií pre prepínač zobrazenia — prefix `section:` ako v ostatných moduloch. */
export const HOME_SECTIONS = {
  accounts: "section:accounts",
  receivables: "section:receivables",
  vat: "section:vat",
  companies: "section:companies"
} as const;

export default function HomePage() {
  const [granularity, setGranularity] = usePreference("ui.granularity");
  const [categoryFilters] = usePreference("home.tagFilters");
  const [selectedCompanies, setSelectedCompanies] = usePreference("home.companies");
  const [hiddenSections, setHiddenSections] = usePreference("ui.homeHiddenSections");
  const [focusedPeriod, setFocusedPeriod] = useState<string | null>(null);
  const [hasLoadedPersistedFilters, setHasLoadedPersistedFilters] = useState(false);
  const { connections, isLoading: isLoadingConnections } = useKrosConnections();

  useEffect(() => {
    setHasLoadedPersistedFilters(true);
  }, []);

  const companyFilter = useMemo(
    () => applyCompanyFilter(connections, selectedCompanies, (connection) => connection.companyName),
    [connections, selectedCompanies]
  );
  const syncConnections = companyFilter.companies;

  const {
    data: { invoices, expenses },
    isSyncing,
    hasResolvedFirstData,
    refresh
  } = useSyncOrchestrator(HOME_ENGINES, {
    connections,
    syncConnections,
    granularity,
    enabled: hasLoadedPersistedFilters
  });

  const scopedInvoices = useMemo(
    () => invoices.filter((invoice) => documentMatchesTagFilters(invoice.tags, categoryFilters)),
    [invoices, categoryFilters]
  );
  const scopedExpenses = useMemo(
    () => expenses.filter((expense) => documentMatchesTagFilters(expense.tags, categoryFilters)),
    [expenses, categoryFilters]
  );

  const points = useMemo(
    () =>
      computeProfitSeries({
        invoices: scopedInvoices,
        expenses: scopedExpenses,
        granularity,
        selectedTags: [],
        selectedCompanies
      }),
    [scopedInvoices, scopedExpenses, granularity, selectedCompanies]
  );

  const kpis = useMemo(() => computeProfitKpis(points, focusedPeriod), [points, focusedPeriod]);

  // Sekcie pod grafom sa počítajú v okne focusnutého stĺpca. Po prepnutí obdobia
  // (mesiace → týždne) focusnutý stĺpec zanikne — filter, ktorý sa nemá čoho držať,
  // patrí zahodiť, nie ho ticho nechať visieť.
  const periodWindow = useMemo(
    () => (focusedPeriod ? getBucketPeriodWindow(granularity, focusedPeriod) : null),
    [focusedPeriod, granularity]
  );
  useEffect(() => {
    if (focusedPeriod && !periodWindow) setFocusedPeriod(null);
  }, [focusedPeriod, periodWindow]);

  const sectionOptions = useMemo<VisibilityOption[]>(
    () => [
      { id: HOME_SECTIONS.receivables, label: "Pohľadávky a záväzky" },
      { id: HOME_SECTIONS.accounts, label: "Peniaze na účtoch" },
      { id: HOME_SECTIONS.vat, label: "Predpokladaná DPH" },
      { id: HOME_SECTIONS.companies, label: "Zisk podľa firiem", filterCount: selectedCompanies.length }
    ],
    [selectedCompanies]
  );

  const hasLiveMode = connections.length > 0;
  const isPreparingModule = isLoadingConnections || !hasResolvedFirstData;

  return (
    <DashboardShell
      title="Domov"
      isSyncing={isSyncing}
      syncNote="Domov skladá čísla zo všetkých modulov, preto prvé načítanie trvá najdlhšie. Ostanú uložené v zariadení a moduly ich už nesťahujú znova."
      onRefresh={hasLiveMode ? refresh : undefined}
      categoryVisibility={{
        categoryOptions: [],
        sectionOptions,
        hiddenIds: hiddenSections,
        onHiddenIdsChange: setHiddenSections,
        granularity,
        onGranularityChange: setGranularity
      }}
    >
      {isPreparingModule ? <ModuleSkeleton label="Skladám prehľad…" /> : null}
      {isPreparingModule ? null : (
        <>
          {!hasLiveMode ? <DemoDataBanner /> : null}
          {companyFilter.noneAvailable ? (
            <FilterMismatchNotice onShowAll={() => setSelectedCompanies([])} />
          ) : null}
          <ProfitDashboard
            kpis={kpis}
            points={points}
            focusedPeriod={hasLiveMode ? focusedPeriod : null}
            onFocusedPeriodChange={hasLiveMode ? setFocusedPeriod : undefined}
          />
        </>
      )}
    </DashboardShell>
  );
}
```

Dve veci sú tu zámerne rozrobené a dokončia ich neskoršie úlohy:

- `categoryFilters` je zatiaľ bez settera a `categoryOptions` je prázdne pole — filter štítkov nemá čo nastavovať, kým neexistuje sekcia štítkov. Dopĺňa to Task 19.
- Demo režim ukáže prázdny graf s bannerom. Doklady preň dopĺňa Task 20 — kým sekcie nie sú hotové, nebolo by čo skladať.

- [ ] **Step 5: Over typy, testy a lint**

Run: `npx tsc --noEmit && npm test && npm run lint`
Expected: bez chýb, všetky testy PASS.

- [ ] **Step 6: Over v prehliadači**

Otvor `/`. Over:
1. Ukáže sa hlavné číslo zisku, graf so stĺpcami a čiarou a dve KPI.
2. Klik na stĺpec ho zvýrazní, ostatné stlmí a hlavné číslo sa prepne na ten stĺpec; druhý klik focus zruší.
3. Prepínač obdobia v hlavičke prekreslí graf.
4. `read_console_messages` — žiadne chyby.

Ak sú v dátach mesiace so záporným ziskom, over screenshotom, že nulová čiara nie je na dne a čiara zisku pod ňu naozaj klesá. Ak žiadny taký mesiac nie je, over to dočasným prepnutím `min` v `ProfitChart` na `-max` a screenshotom — a potom to **vráť späť**.

- [ ] **Step 7: Commitni**

```bash
git add src/app/page.tsx src/components/profit-dashboard.tsx src/lib/preferences/registry.ts src/app/globals.css
git commit -m "feat(home): stránka Domov s panelom Zisk firmy"
```

---

### Task 16: Karta Peniaze na účtoch

Prvá z troch kariet, ktoré ukazujú **stav k dnešku** — prepínač obdobia ani focus stĺpca ich nemenia a musia to povedať textom, inak by pôsobili, že sa nezmenili omylom.

**Files:**
- Modify: `src/lib/cashflow-live.ts` (export typu `CashflowAccountPoint`, ak ešte nie je exportovaný)
- Create: `src/components/home-accounts-card.tsx`
- Modify: `src/app/page.tsx`
- Modify: `src/app/globals.css`

**Interfaces:**
- Consumes: `computeCashflowOverviewFromLiveData` z `@/lib/cashflow-live`; `DonutLegend` z `@/components/donut-legend`; `usePersistedCollapsed` z `@/lib/use-persisted-collapsed`; `formatCurrency` z `@/lib/format`.
- Produces: `<HomeAccountsCard accounts={CashflowAccountPoint[]} isPeriodFocused={boolean} />`

- [ ] **Step 1: Sprístupni typ účtu**

V `src/lib/cashflow-live.ts` over, či je `CashflowAccountPoint` exportovaný:

```bash
grep -n "CashflowAccountPoint" src/lib/cashflow-live.ts src/lib/cashflow-mock-data.ts
```

Ak nie je, doplň mu `export`. Nový typ nevytváraj — dve definície toho istého účtu by sa časom rozišli.

- [ ] **Step 2: Vytvor `src/components/home-accounts-card.tsx`**

Donut skopíruj štruktúrou z `src/components/cashflow-dashboard.tsx` (sekcia, ktorá kreslí `accounts` cez `conic-gradient` a `DonutLegend`) — Domov nemá vymýšľať druhý vzhľad pre ten istý údaj.

```tsx
"use client";

import Link from "next/link";
import { DonutLegend } from "@/components/donut-legend";
import type { CashflowAccountPoint } from "@/lib/cashflow-live";
import { formatCurrency } from "@/lib/format";
import { usePersistedCollapsed } from "@/lib/use-persisted-collapsed";

type Props = {
  accounts: CashflowAccountPoint[];
  /** Je aktívny focus stĺpca? Karta ho ignoruje a musí to priznať. */
  isPeriodFocused: boolean;
};

/** Farby výsekov — rovnaké poradie ako v legende, aby sa dali spárovať očami. */
const SLICE_COLORS = ["#7b99ff", "#f6b73c", "#34d399", "#a78bfa", "#f472b6", "#38bdf8", "#fb923c"];

export function HomeAccountsCard({ accounts, isPeriodFocused }: Props) {
  const [collapsed, setCollapsed] = usePersistedCollapsed("ui.collapsed.homeAccounts");
  const total = accounts.reduce((sum, account) => sum + account.amount, 0);
  // Do donutu idú len kladné zostatky — záporný výsek sa nedá nakresliť a
  // prečerpaný účet by tichým orezaním zväčšil podiely ostatných.
  const positive = accounts.filter((account) => account.amount > 0);
  const positiveTotal = positive.reduce((sum, account) => sum + account.amount, 0);

  let cursor = 0;
  const stops = positive.map((account, index) => {
    const start = (cursor / positiveTotal) * 100;
    cursor += account.amount;
    const end = (cursor / positiveTotal) * 100;
    const color = SLICE_COLORS[index % SLICE_COLORS.length];
    return `${color} ${start}% ${end}%`;
  });

  return (
    <section className="dashboard-body">
      <article className={`panel${collapsed ? " panel-collapsed" : ""}`}>
        <header className="panel-head">
          <button
            type="button"
            className="panel-collapse-toggle"
            onClick={() => setCollapsed(!collapsed)}
            aria-expanded={!collapsed}
            aria-label={collapsed ? "Rozbaliť Peniaze na účtoch" : "Zbaliť Peniaze na účtoch"}
          >
            <span className={`panel-collapse-chevron${collapsed ? " collapsed" : ""}`} aria-hidden="true">
              ▾
            </span>
            <h3>Peniaze na účtoch</h3>
          </button>
        </header>

        {collapsed ? null : (
          <>
            <p className="profit-headline">{formatCurrency(total)}</p>
            <p className="profit-headline-meta">
              Celkovo {accounts.length}{" "}
              {accounts.length === 1 ? "účet" : accounts.length < 5 ? "účty" : "účtov"}
              {isPeriodFocused ? " · k dnešku, nezávisle od vybraného obdobia" : ""}
            </p>

            {accounts.length === 0 ? (
              <p className="tag-filter-help">Zatiaľ nemáme žiadne účty.</p>
            ) : (
              <>
                <div
                  className="home-donut"
                  style={{ background: `conic-gradient(${stops.join(", ")})` }}
                  role="img"
                  aria-label={`Rozdelenie zostatkov na ${positive.length} účtoch`}
                />
                <DonutLegend ariaLabel="Zostatky na účtoch">
                  {accounts.map((account, index) => (
                    <li key={account.id} className="donut-legend-item">
                      <span
                        className="donut-legend-dot"
                        style={{ background: SLICE_COLORS[index % SLICE_COLORS.length] }}
                        aria-hidden="true"
                      />
                      <span className="donut-legend-name">{account.name}</span>
                      <strong>{formatCurrency(account.amount)}</strong>
                    </li>
                  ))}
                </DonutLegend>
              </>
            )}

            <Link href="/cashflow" className="home-card-link">
              Financie →
            </Link>
          </>
        )}
      </article>
    </section>
  );
}
```

Triedy `donut-legend-item`, `donut-legend-dot` a `donut-legend-name` použi tie, ktoré už existujú v `globals.css` pre legendu Financií — pozri si `cashflow-dashboard.tsx`, ako sa volajú, a nevymýšľaj nové. Ak `.home-donut` a `.home-card-link` neexistujú, doplň:

```css
.home-donut {
  aspect-ratio: 1;
  border-radius: 50%;
  margin: 0.6rem auto;
  mask: radial-gradient(circle, transparent 56%, #000 57%);
  width: min(190px, 52vw);
}

.home-card-link {
  color: #a9bcff;
  display: inline-block;
  font-size: 0.82rem;
  font-weight: 600;
  margin-top: 0.7rem;
  text-decoration: none;
}
```

- [ ] **Step 3: Zapoj kartu do `src/app/page.tsx`**

Doplň import `computeCashflowOverviewFromLiveData`, `HomeAccountsCard` a do komponentu:

```ts
  const selectedCompanyIds = useMemo(() => {
    if (selectedCompanies.length === 0) return [];
    const selected = new Set(selectedCompanies);
    return connections
      .filter((connection) => selected.has(connection.companyName))
      .map((connection) => connection.companyId);
  }, [selectedCompanies, connections]);

  // Účty a pohyby sú stav k dnešku, nie tok za obdobie: granularita sem ide len
  // preto, že ju prehľad Financií vyžaduje na svoje vlastné série, ktoré Domov
  // nepoužíva. Focus stĺpca sa sem zámerne neposiela.
  const accounts = useMemo(
    () =>
      computeCashflowOverviewFromLiveData({
        accounts: cashflowAccounts,
        transactions,
        granularity,
        selectedCompanies,
        selectedCompanyIds
      }).accountBreakdown,
    [cashflowAccounts, transactions, granularity, selectedCompanies, selectedCompanyIds]
  );
```

Z orchestrátora si vypýtaj aj účty a pohyby:

```ts
  const {
    data: { invoices, expenses, accounts: cashflowAccounts, transactions },
    ...
  } = useSyncOrchestrator(HOME_ENGINES, { ... });
```

A do renderu, za `<ProfitDashboard />`:

```tsx
          {hiddenSections.includes(HOME_SECTIONS.accounts) ? null : (
            <HomeAccountsCard accounts={accounts} isPeriodFocused={Boolean(focusedPeriod)} />
          )}
```

- [ ] **Step 4: Over typy, lint a prehliadač**

Run: `npx tsc --noEmit && npm run lint && npm test`
Expected: bez chýb.

V prehliadači otvor `/` a over, že donut sedí s legendou, súčet zodpovedá zostatkom a preklik `Financie →` vedie na `/cashflow`.

- [ ] **Step 5: Commitni**

```bash
git add src/components/home-accounts-card.tsx src/app/page.tsx src/app/globals.css src/lib/cashflow-live.ts
git commit -m "feat(home): karta Peniaze na účtoch"
```

---

### Task 17: Karta Pohľadávky a záväzky

**Files:**
- Create: `src/components/home-due-card.tsx`
- Modify: `src/app/page.tsx`
- Modify: `src/app/globals.css`

**Interfaces:**
- Consumes: `computeDuePositions`, `DuePositions`, `DuePosition` z `@/lib/home-live`; `formatCurrency` z `@/lib/format`; `usePersistedCollapsed`.
- Produces: `<HomeDueCard positions={DuePositions} isPeriodFocused={boolean} />`

- [ ] **Step 1: Vytvor `src/components/home-due-card.tsx`**

```tsx
"use client";

import type { DuePosition, DuePositions } from "@/lib/home-live";
import { formatCurrency } from "@/lib/format";
import { usePersistedCollapsed } from "@/lib/use-persisted-collapsed";

type Props = {
  positions: DuePositions;
  isPeriodFocused: boolean;
};

const BAND_CLASS: Record<string, string> = {
  due: "due",
  overdue: "overdue",
  overdue60: "overdue60"
};

function DueRow({ title, position }: { title: string; position: DuePosition }) {
  const total = position.total || 1;

  return (
    <div className="due-row">
      <div className="due-row-head">
        <span className="profit-kpi-label">{title}</span>
        <strong>{formatCurrency(position.total)}</strong>
      </div>
      <div className="due-bar" role="img" aria-label={`${title}: ${formatCurrency(position.total)}`}>
        {position.bands
          .filter((band) => band.total > 0)
          .map((band) => (
            <span
              key={band.key}
              className={`due-bar-segment ${BAND_CLASS[band.key]}`}
              style={{ width: `${(band.total / total) * 100}%` }}
            />
          ))}
      </div>
      <ul className="due-bands">
        {position.bands.map((band) => (
          <li key={band.key} className={BAND_CLASS[band.key]}>
            <span>{band.label}</span>
            <strong>{formatCurrency(band.total)}</strong>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function HomeDueCard({ positions, isPeriodFocused }: Props) {
  const [collapsed, setCollapsed] = usePersistedCollapsed("ui.collapsed.homeReceivables");

  return (
    <section className="dashboard-body">
      <article className={`panel${collapsed ? " panel-collapsed" : ""}`}>
        <header className="panel-head">
          <button
            type="button"
            className="panel-collapse-toggle"
            onClick={() => setCollapsed(!collapsed)}
            aria-expanded={!collapsed}
            aria-label={collapsed ? "Rozbaliť Pohľadávky a záväzky" : "Zbaliť Pohľadávky a záväzky"}
          >
            <span className={`panel-collapse-chevron${collapsed ? " collapsed" : ""}`} aria-hidden="true">
              ▾
            </span>
            <h3>Pohľadávky a záväzky</h3>
          </button>
        </header>

        {collapsed ? null : (
          <>
            <p className="profit-headline">{formatCurrency(positions.net)}</p>
            <p className="profit-headline-meta">
              čiastka po vyrovnaní
              {isPeriodFocused ? " · k dnešku, nezávisle od vybraného obdobia" : ""}
            </p>

            {positions.receivablesAvailable ? (
              <DueRow title="Mám dostať" position={positions.receivables} />
            ) : (
              <div className="due-row">
                <span className="profit-kpi-label">Mám dostať</span>
                {/* Chýbajúci údaj a nula sú dve rôzne správy. Pri peniazoch sa
                    zamieňať nesmú — radšej priznáme, že to nevieme. */}
                <p className="tag-filter-help">
                  Údaj z KROS nedostupný — faktúry nenesú stav úhrady.
                </p>
              </div>
            )}

            <DueRow title="Mám zaplatiť" position={positions.payables} />
          </>
        )}
      </article>
    </section>
  );
}
```

- [ ] **Step 2: Doplň CSS**

```css
.due-row {
  margin-top: 0.9rem;
}

.due-row-head {
  align-items: baseline;
  display: flex;
  gap: 0.5rem;
  justify-content: space-between;
}

.due-bar {
  background: rgba(226, 234, 255, 0.12);
  border-radius: 999px;
  display: flex;
  gap: 2px;
  height: 8px;
  margin: 0.4rem 0;
  overflow: hidden;
}

.due-bar-segment.due {
  background: #7b99ff;
}

.due-bar-segment.overdue {
  background: #f6b73c;
}

.due-bar-segment.overdue60 {
  background: #f87171;
}

.due-bands {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem 1rem;
  list-style: none;
  margin: 0;
  padding: 0;
}

.due-bands li {
  border-left: 3px solid transparent;
  display: flex;
  flex-direction: column;
  padding-left: 0.45rem;
}

.due-bands li span {
  color: var(--muted);
  font-size: 0.72rem;
}

.due-bands li.due {
  border-left-color: #7b99ff;
}

.due-bands li.overdue {
  border-left-color: #f6b73c;
}

.due-bands li.overdue60 {
  border-left-color: #f87171;
}
```

- [ ] **Step 3: Zapoj kartu do `src/app/page.tsx`**

```ts
  // Neuhradené doklady k dnešku. Zámerne BEZ `periodWindow` — dlžoba nezaniká tým,
  // že vznikla vlani, a zúžiť ju na jeden stĺpec grafu by dalo číslo, ktoré nikoho
  // nezaujíma.
  const duePositions = useMemo(
    () =>
      computeDuePositions({
        invoices: scopedInvoices,
        expenses: scopedExpenses,
        selectedTags: [],
        selectedCompanies
      }),
    [scopedInvoices, scopedExpenses, selectedCompanies]
  );
```

a do renderu, za `<ProfitDashboard />` a pred kartu účtov:

```tsx
          {hiddenSections.includes(HOME_SECTIONS.receivables) ? null : (
            <HomeDueCard positions={duePositions} isPeriodFocused={Boolean(focusedPeriod)} />
          )}
```

- [ ] **Step 4: Over a commitni**

Run: `npx tsc --noEmit && npm run lint && npm test`
Expected: bez chýb.

V prehliadači over, že sa pásiky sčítajú do celku a že pri chýbajúcom stave úhrady je vidieť hlášku, nie nula.

```bash
git add src/components/home-due-card.tsx src/app/page.tsx src/app/globals.css
git commit -m "feat(home): karta Pohľadávky a záväzky"
```

---

### Task 18: Karta Odhad DPH

**Files:**
- Create: `src/components/home-vat-card.tsx`
- Modify: `src/app/page.tsx`

**Interfaces:**
- Consumes: `computeVatEstimate`, `VatEstimate`, `VatMonthEstimate` z `@/lib/home-live`; `formatCurrencyPrecise` z `@/lib/format`; `formatMonthKeyLabel` z `@/lib/use-sync-progress`; `usePersistedCollapsed`.
- Produces: `<HomeVatCard estimate={VatEstimate} isPeriodFocused={boolean} />`

- [ ] **Step 1: Vytvor `src/components/home-vat-card.tsx`**

```tsx
"use client";

import type { VatEstimate, VatMonthEstimate } from "@/lib/home-live";
import { formatCurrencyPrecise } from "@/lib/format";
import { formatMonthKeyLabel } from "@/lib/use-sync-progress";
import { usePersistedCollapsed } from "@/lib/use-persisted-collapsed";

type Props = {
  estimate: VatEstimate;
  /** Je aktívny focus stĺpca? Karta ho ignoruje a musí to priznať. */
  isPeriodFocused: boolean;
};

function VatMonth({ title, month }: { title: string; month: VatMonthEstimate }) {
  return (
    <div className="vat-month">
      <span className="profit-kpi-label">
        {title} · {formatMonthKeyLabel(month.monthKey)}
      </span>
      {month.amount === null ? (
        // Nula by tvrdila, že firma nemá čo odviesť. To je iná veta než „nevieme".
        <p className="tag-filter-help">Údaj z KROS nedostupný — doklady nenesú sumu DPH.</p>
      ) : (
        <strong>{formatCurrencyPrecise(month.amount)}</strong>
      )}
    </div>
  );
}

export function HomeVatCard({ estimate, isPeriodFocused }: Props) {
  const [collapsed, setCollapsed] = usePersistedCollapsed("ui.collapsed.homeVat");

  return (
    <section className="dashboard-body">
      <article className={`panel${collapsed ? " panel-collapsed" : ""}`}>
        <header className="panel-head">
          <button
            type="button"
            className="panel-collapse-toggle"
            onClick={() => setCollapsed(!collapsed)}
            aria-expanded={!collapsed}
            aria-label={collapsed ? "Rozbaliť Odhad DPH" : "Zbaliť Odhad DPH"}
          >
            <span className={`panel-collapse-chevron${collapsed ? " collapsed" : ""}`} aria-hidden="true">
              ▾
            </span>
            <h3>Predpokladaná DPH</h3>
          </button>
        </header>

        {collapsed ? null : (
          <>
            <VatMonth title="Minulý mesiac" month={estimate.previousMonth} />
            <VatMonth title="Tento mesiac" month={estimate.currentMonth} />
            {/*
              Stav podania appka nevie a vymyslený odznak „Neuhradené / Prebieha"
              pri sume dane by bol horší než žiadny. Namiesto neho veta, ktorá
              povie presne, čo to číslo je a čo nie je.
            */}
            <p className="tag-filter-help">
              Predpokladaná DPH vypočítaná z dokladov v systéme, vždy za kalendárne mesiace.
              Skutočnú sumu potvrdí účtovníčka po spracovaní.
              {isPeriodFocused ? " Vybrané obdobie z grafu sa sem neprenáša." : ""}
            </p>
          </>
        )}
      </article>
    </section>
  );
}
```

Doplň do `globals.css`:

```css
.vat-month {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  margin-top: 0.8rem;
}

.vat-month strong {
  font-size: 1.35rem;
}
```

- [ ] **Step 2: Zapoj kartu do `src/app/page.tsx`**

```ts
  // Kalendárne mesiace vždy — bez ohľadu na prepínač obdobia. DPH sa podáva po
  // mesiacoch a po týždňoch alebo rokoch je to číslo nezmysel.
  const vatEstimate = useMemo(
    () =>
      computeVatEstimate({
        invoices,
        expenses,
        selectedCompanies
      }),
    [invoices, expenses, selectedCompanies]
  );
```

Pozor: **`invoices` a `expenses`, nie `scopedInvoices`/`scopedExpenses`** — filter štítkov sa na DPH neaplikuje, daň sa priraďuje dokladu ako celku.

```tsx
          {hiddenSections.includes(HOME_SECTIONS.vat) ? null : (
            <HomeVatCard estimate={vatEstimate} isPeriodFocused={Boolean(focusedPeriod)} />
          )}
```

- [ ] **Step 3: Over a commitni**

Run: `npx tsc --noEmit && npm run lint && npm test`
Expected: bez chýb.

```bash
git add src/components/home-vat-card.tsx src/app/page.tsx src/app/globals.css
git commit -m "feat(home): karta Predpokladaná DPH"
```

---

### Task 19: Zisk podľa štítkov a podľa firiem

`CategorizedTagsDashboard` už rieši kategórie, filtre štítkov, focus aj zbaľovanie a berie `AggregatedBreakdownPoint[]`. Domov ho použije — vlastná kópia by znamenala druhé miesto, kde sa filtre správajú inak. Chýba mu jediné: riadok pod číslom s oboma zložkami zisku. Doplní sa ako **voliteľný prop**, ktorý ostatné moduly nemusia použiť.

**Files:**
- Modify: `src/components/filterable-breakdown-section.tsx` (nový voliteľný prop `renderMeta`)
- Modify: `src/components/categorized-tags-dashboard.tsx` (prepošle `renderMeta`)
- Modify: `src/app/page.tsx`
- Modify: `src/app/globals.css`

**Interfaces:**
- Consumes: `computeProfitTagBreakdown`, `computeProfitCompanyBreakdown`, `ProfitBreakdownPoint` z `@/lib/home-live`; `useTagCategoryIndex` z `@/lib/use-tag-categories`; `categoryForTag`, `hasRealCategories`, `sortTagCategories`, `TagCategoryFilters` z `@/lib/tag-categories`; `CategorizedTagsDashboard`; `CompaniesDashboard`; `formatCurrency`.
- Produces: `renderMeta?: (item: { name: string; amount: number; previousAmount: number }) => ReactNode` na `FilterableBreakdownSection` aj `CategorizedTagsDashboard`.

- [ ] **Step 1: Pridaj `renderMeta` do `FilterableBreakdownSection`**

V `src/components/filterable-breakdown-section.tsx` doplň do `Props`:

```ts
  /**
   * Doplnkový riadok pod sumou. Domov ním ukazuje, z čoho zisk vznikol
   * („24 850 € − 17 320 €"); moduly, ktoré ukazujú jednu veličinu, ho neposielajú.
   */
  renderMeta?: (item: BreakdownItem) => React.ReactNode;
```

Rozbaľ ho v parametroch komponentu (`renderMeta`) a v mieste, kde sa vykresľuje suma položky, pridaj hneď pod ňu:

```tsx
                  {renderMeta ? <small className="breakdown-meta">{renderMeta(item)}</small> : null}
```

Nájdi si, ako sa premenná položky v `.map()` naozaj volá, a použi ju — meno `item` je tu len ilustračné.

- [ ] **Step 2: Prepošli `renderMeta` cez `CategorizedTagsDashboard`**

V `src/components/categorized-tags-dashboard.tsx` doplň do `Props` ten istý voliteľný prop, rozbaľ ho v parametroch a odovzdaj do každého `<FilterableBreakdownSection ... renderMeta={renderMeta} />`.

- [ ] **Step 3: Doplň CSS**

```css
.breakdown-meta {
  color: var(--muted);
  display: block;
  font-size: 0.7rem;
}
```

- [ ] **Step 4: Over, že sa moduly nezmenili**

Run: `npx tsc --noEmit && npm run lint && npm test`
Expected: bez chýb. Prop je voliteľný, takže Príjmy ani Výdavky sa nemenia — otvor `/prijmy` a `/expenses` a over screenshotom, že zoznamy štítkov vyzerajú ako predtým.

- [ ] **Step 5: Commitni medzikrok**

```bash
git add src/components/filterable-breakdown-section.tsx src/components/categorized-tags-dashboard.tsx src/app/globals.css
git commit -m "feat(ui): voliteľný doplnkový riadok pod sumou v rozpise"
```

- [ ] **Step 6: Zapoj obe sekcie do `src/app/page.tsx`**

Doplň stavy a výpočty:

```ts
  const [focusedTag, setFocusedTag] = useState<string | null>(null);
  const [focusedCompany, setFocusedCompany] = useState<string | null>(null);
  const [tagRefreshNonce, setTagRefreshNonce] = useState(0);
  const tagCategoryIndex = useTagCategoryIndex(connections, tagRefreshNonce);

  const handleRefresh = () => {
    setTagRefreshNonce((value) => value + 1);
    refresh();
  };

  // Rozklik firmy zúži graf a KPI, ale nie zoznam firiem — rovnako ako v moduloch.
  const effectiveCompanies = useMemo(
    () => (focusedCompany ? [focusedCompany] : selectedCompanies),
    [focusedCompany, selectedCompanies]
  );

  const tagPoints = useMemo(
    () =>
      computeProfitTagBreakdown({
        invoices: scopedInvoices,
        expenses: scopedExpenses,
        selectedCompanies: effectiveCompanies,
        period: periodWindow ?? undefined
      }),
    [scopedInvoices, scopedExpenses, effectiveCompanies, periodWindow]
  );

  const companyPoints = useMemo(
    () =>
      computeProfitCompanyBreakdown({
        invoices: scopedInvoices,
        expenses: scopedExpenses,
        selectedTags: [],
        selectedCompanies,
        period: periodWindow ?? undefined
      }),
    [scopedInvoices, scopedExpenses, selectedCompanies, periodWindow]
  );

  /** Zisk štítku ako bod rozpisu — `CategorizedTagsDashboard` číta `amount`. */
  const tagBreakdownPoints = useMemo(
    () =>
      tagPoints.map((point) => ({
        name: point.name,
        amount: point.profit,
        previousAmount: point.previousProfit
      })),
    [tagPoints]
  );

  /** Zložky zisku podľa štítku — pre doplnkový riadok pod sumou. */
  const tagPartsByName = useMemo(
    () => new Map(tagPoints.map((point) => [point.name, point])),
    [tagPoints]
  );
```

`focusedTag` zapoj do `scopedInvoices` a `scopedExpenses` tak, ako to robia moduly — `documentMatchesTagFilters` berie rozkliknuté štítky tretím parametrom:

```ts
  const scopedInvoices = useMemo(
    () =>
      invoices.filter((invoice) =>
        documentMatchesTagFilters(invoice.tags, categoryFilters, focusedTag ? [focusedTag] : [])
      ),
    [invoices, categoryFilters, focusedTag]
  );
```

a rovnako pre `scopedExpenses`.

`usePreference("home.tagFilters")` musí mať aj setter — v Task 15 bol zapísaný bez neho:

```ts
  const [categoryFilters, setCategoryFilters] = usePreference("home.tagFilters");

  const handleCategoryFiltersChange = (next: TagCategoryFilters) => {
    setCategoryFilters(next);
    // Rozkliknutý štítok, ktorý filter práve vylúčil, by ostal visieť na odznaku
    // a zužoval čísla, hoci ho v zozname už nevidno.
    if (focusedTag && !isTagAllowedByFilters(focusedTag, next, tagCategoryIndex)) {
      setFocusedTag(null);
    }
  };
```

Do `categoryOptions` (dnes prázdne pole) daj kategórie zo VŠETKÝCH štítkov, nie z odfiltrovaných — inak by sa vypnutá kategória z prepínača stratila a nedala by sa vrátiť:

```ts
  const categoryOptions = useMemo<VisibilityOption[]>(() => {
    if (!hasRealCategories(tagCategoryIndex)) return [];
    const categories = new Set(
      tagPoints.map((point) => categoryForTag(tagCategoryIndex, point.name))
    );
    return sortTagCategories(Array.from(categories)).map((category) => ({
      id: category,
      label: category,
      filterCount: categoryFilters[category]?.length ?? 0
    }));
  }, [tagPoints, tagCategoryIndex, categoryFilters]);
```

a v `categoryVisibility` nahraď `categoryOptions: []` za `categoryOptions`. `onRefresh` prepni z `refresh` na `handleRefresh`.

Vo výpočtoch `points`, `duePositions` a `accounts` nahraď `selectedCompanies` za `effectiveCompanies`. Vo `vatEstimate` a v `companyPoints` ostáva `selectedCompanies` — DPH ide za firmu ako celok a zoznam firiem sa vlastným focusom nezužuje.

Do renderu na koniec:

```tsx
          <CategorizedTagsDashboard
            baseTitle="Zisk podľa štítkov"
            ariaLabelPrefix="Filtrovať prehľad podľa štítku"
            tags={tagBreakdownPoints}
            availableTags={tagBreakdownPoints}
            categoryIndex={tagCategoryIndex}
            categoryFilters={categoryFilters}
            hiddenCategories={hiddenSections}
            focusedTags={focusedTag ? [focusedTag] : []}
            onCategoryFiltersChange={handleCategoryFiltersChange}
            // Zisk ostáva na jednom rozkliknutom štítku — z klikov berieme posledný.
            onFocusedTagsChange={(tags) => setFocusedTag(tags[tags.length - 1] ?? null)}
            renderMeta={(item) => {
              const parts = tagPartsByName.get(item.name);
              if (!parts) return null;
              return `${formatCurrency(parts.income)} − ${formatCurrency(parts.expense)}`;
            }}
          />
          {/*
            Priznaná nepresnosť: príjmová a výdavková strana priraďujú štítky rôzne.
            Predstierať presnosť, ktorú dáta nemajú, by bolo horšie než ju povedať.
          */}
          <section className="dashboard-body">
            <p className="tag-filter-help">
              Faktúra s viacerými štítkami sa započíta celá do každého z nich, výdavok sa
              rozdelí podľa rozúčtovania. Súčet riadkov preto nedá celkový zisk.
            </p>
          </section>

          {hiddenSections.includes(HOME_SECTIONS.companies) ? null : (
            <CompaniesDashboard
              title="Zisk podľa firiem"
              companies={companyPoints.map((point) => ({
                name: point.name,
                amount: point.profit,
                previousAmount: point.previousProfit
              }))}
              selectedCompanies={selectedCompanies}
              availableCompanyNames={connections.map((connection) => connection.companyName)}
              focusedCompany={focusedCompany}
              onSelectionChange={(companies) => {
                setSelectedCompanies(companies);
                if (focusedCompany && !companies.includes(focusedCompany)) setFocusedCompany(null);
              }}
              onFocusedCompanyChange={setFocusedCompany}
              collapsedKey="ui.collapsed.homeCompanies"
            />
          )}
```

Over, či `CompaniesDashboard` prop `collapsedKey` prijíma (`grep -n "collapsedKey" src/components/companies-dashboard.tsx`) a ako sa presne volá jeho prop pre názov sekcie. Kľúč `ui.collapsed.homeCompanies` je v registri už z Task 15.

- [ ] **Step 7: Over typy, testy, lint**

Run: `npx tsc --noEmit && npm test && npm run lint`
Expected: bez chýb, všetky testy PASS.

- [ ] **Step 8: Over celý Domov v prehliadači**

Otvor `/` na presete `mobile` (375×812). Over po poradí:
1. Sekcie idú zhora: Zisk firmy, Pohľadávky a záväzky, Peniaze na účtoch, Odhad DPH, Zisk podľa štítkov, Zisk podľa firiem.
2. Klik na stĺpec grafu prepočíta hlavné KPI, štítky aj firmy — a **neprepočíta** pohľadávky, účty ani DPH, ktoré namiesto toho pripíšu, že sú k dnešku.
3. Filter štítkov (ikona filtra v sekcii štítkov) sa dá otvoriť, uložiť a zmena prežije reload stránky.
4. Rozklik štítku zúži graf a KPI; zoznam štítkov v tej kategórii sa nezúži.
5. Prepínač zobrazených sekcií skryje a vráti každú sekciu vrátane kategórií štítkov.
6. Rozklik firmy zúži graf a KPI, zoznam firiem ostane celý.
7. `read_console_messages` — žiadne chyby.
8. Screenshot celej obrazovky pošli používateľovi cez SendUserFile.

- [ ] **Step 9: Commitni**

```bash
git add src/app/page.tsx src/app/globals.css
git commit -m "feat(home): zisk podľa štítkov a podľa firiem"
```

---

### Task 20: Demo režim Domova

Bez prepojenia s KROS ukazujú ostatné moduly mock dáta a `DemoDataBanner`. Domov to musí vedieť tiež — inak by prvá obrazovka appky pre neprepojeného človeka bola prázdna a vyzerala by ako chyba.

Mock zdroje modulov (`mock-data.ts`, `expenses-mock-data.ts`, `cashflow-mock-data.ts`) vracajú **hotové agregáty**, nie doklady, takže `computeProfitSeries` ani `computeDuePositions` ich nemajú z čoho počítať. Domov preto dostane vlastnú malú sadu **dokladov**, ktorá prejde tými istými funkciami ako živé dáta — demo tak overuje aj výpočty, nie len vzhľad.

**Files:**
- Create: `src/lib/home-mock-data.ts`
- Test: `src/lib/home-mock-data.test.ts`
- Modify: `src/app/page.tsx`

**Interfaces:**
- Consumes: `NormalizedInvoice`, `NormalizedExpense`, `NormalizedPaymentAccount`, `NormalizedPaymentTransaction` z `@/lib/kros-types`.
- Produces: `getHomeMockData(referenceDate?: Date): { invoices; expenses; accounts; transactions }`

- [ ] **Step 1: Napíš padajúci test**

Vytvor `src/lib/home-mock-data.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { getHomeMockData } from "./home-mock-data";
import { computeDuePositions, computeProfitSeries, computeVatEstimate } from "./home-live";

const REFERENCE = new Date(2026, 8, 6);

describe("getHomeMockData", () => {
  it("dáva doklady v aktuálnom aj minulom roku, nech je čo porovnávať", () => {
    const data = getHomeMockData(REFERENCE);
    const years = new Set(data.invoices.map((invoice) => invoice.issueDate.slice(0, 4)));
    expect(years.size).toBeGreaterThan(1);
  });

  it("demo zisk je nenulový v aspoň jednom stĺpci", () => {
    const data = getHomeMockData(REFERENCE);
    const points = computeProfitSeries({
      invoices: data.invoices,
      expenses: data.expenses,
      granularity: "month",
      selectedTags: [],
      selectedCompanies: []
    });
    expect(points.some((point) => point.profit !== 0)).toBe(true);
  });

  it("demo pohľadávky sú dostupné a nenulové — inak by karta hlásila chýbajúci údaj", () => {
    const data = getHomeMockData(REFERENCE);
    const positions = computeDuePositions({
      invoices: data.invoices,
      expenses: data.expenses,
      selectedTags: [],
      selectedCompanies: [],
      referenceDate: REFERENCE
    });
    expect(positions.receivablesAvailable).toBe(true);
    expect(positions.receivables.total).toBeGreaterThan(0);
    expect(positions.payables.total).toBeGreaterThan(0);
  });

  it("demo doklady nesú DPH, takže odhad nie je null", () => {
    const data = getHomeMockData(REFERENCE);
    const estimate = computeVatEstimate({
      invoices: data.invoices,
      expenses: data.expenses,
      selectedCompanies: [],
      referenceDate: REFERENCE
    });
    expect(estimate.currentMonth.amount).not.toBeNull();
    expect(estimate.previousMonth.amount).not.toBeNull();
  });

  it("demo má aspoň dva účty a dve firmy", () => {
    const data = getHomeMockData(REFERENCE);
    expect(data.accounts.length).toBeGreaterThanOrEqual(2);
    expect(new Set(data.invoices.map((invoice) => invoice.companyName)).size).toBeGreaterThanOrEqual(2);
  });
});
```

- [ ] **Step 2: Spusti test a over, že padá**

Run: `npx vitest run src/lib/home-mock-data.test.ts`
Expected: FAIL — `Failed to resolve import "./home-mock-data"`.

- [ ] **Step 3: Vytvor `src/lib/home-mock-data.ts`**

```ts
import type {
  NormalizedExpense,
  NormalizedInvoice,
  NormalizedPaymentAccount,
  NormalizedPaymentTransaction
} from "./kros-types";

/**
 * Demo dáta Domova ako DOKLADY, nie ako hotové súčty.
 *
 * Mock zdroje modulov vracajú agregáty, z ktorých sa zisk, splatnosti ani DPH
 * nedajú spočítať. Doklady prejdú tými istými funkciami ako živé dáta, takže demo
 * ukazuje aj to, či výpočty fungujú — nie len či sa niečo vykreslí.
 *
 * Dátumy sú relatívne k `referenceDate`, aby demo nezostarlo: pevné dátumy by po
 * pár mesiacoch vypadli z okna grafu a demo by sa ukázalo prázdne.
 */
const COMPANIES = ["Kros Trade", "Kros Servis"] as const;
const TAGS = ["Retail", "Projekty", "Réžia"] as const;

function isoDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate()
  ).padStart(2, "0")}`;
}

function shiftMonths(reference: Date, months: number, day: number) {
  return new Date(reference.getFullYear(), reference.getMonth() + months, day);
}

export function getHomeMockData(referenceDate: Date = new Date()) {
  const invoices: NormalizedInvoice[] = [];
  const expenses: NormalizedExpense[] = [];

  // 18 mesiacov späť: tento rok aj vlaňajšok, nech má graf čo porovnávať.
  for (let offset = 17; offset >= 0; offset -= 1) {
    for (const [companyIndex, companyName] of COMPANIES.entries()) {
      const date = isoDate(shiftMonths(referenceDate, -offset, 12));
      const tag = TAGS[(offset + companyIndex) % TAGS.length];
      const income = 8000 + ((offset * 7 + companyIndex * 13) % 9) * 850;
      const spend = 5200 + ((offset * 5 + companyIndex * 11) % 7) * 720;

      invoices.push({
        id: `demo-inv-${offset}-${companyIndex}`,
        companyId: companyIndex + 1,
        companyName,
        invoiceNumber: `2026${String(offset).padStart(3, "0")}`,
        partnerName: `Odberateľ ${companyIndex + 1}`,
        issueDate: date,
        deliveryDate: date,
        totalPrice: income,
        vatAmount: Math.round(income * 0.2),
        paymentStatus: "fullyPaid",
        tags: [tag]
      });

      expenses.push({
        id: `demo-exp-${offset}-${companyIndex}`,
        companyId: companyIndex + 1,
        companyName,
        documentNumber: `D2026${String(offset).padStart(3, "0")}`,
        documentType: 10,
        partnerName: `Dodávateľ ${companyIndex + 1}`,
        issueDate: date,
        deliveryDate: date,
        totalPrice: spend,
        vatAmount: Math.round(spend * 0.2),
        paymentStatus: "fullyPaid",
        hasAttachments: false,
        tags: [tag],
        allocations: [{ tags: [tag], amount: spend }]
      });
    }
  }

  // Neuhradené doklady v troch pásmach splatnosti, nech je karta Pohľadávky
  // a záväzky vidieť celá — vrátane pásma nad 60 dní.
  const unpaid: { days: number; amount: number }[] = [
    { days: -20, amount: 4200 },
    { days: 12, amount: 3100 },
    { days: 95, amount: 1800 }
  ];
  for (const [index, item] of unpaid.entries()) {
    const due = new Date(referenceDate);
    due.setDate(due.getDate() - item.days);
    invoices.push({
      id: `demo-inv-unpaid-${index}`,
      companyId: 1,
      companyName: COMPANIES[0],
      partnerName: `Odberateľ ${index + 1}`,
      issueDate: isoDate(shiftMonths(referenceDate, -1, 5)),
      deliveryDate: isoDate(shiftMonths(referenceDate, -1, 5)),
      dueDate: isoDate(due),
      totalPrice: item.amount,
      vatAmount: Math.round(item.amount * 0.2),
      paymentStatus: "notPaid",
      tags: [TAGS[index % TAGS.length]]
    });
  }

  for (const [index, item] of unpaid.slice(0, 2).entries()) {
    const due = new Date(referenceDate);
    due.setDate(due.getDate() - item.days);
    expenses.push({
      id: `demo-exp-unpaid-${index}`,
      companyId: 1,
      companyName: COMPANIES[0],
      documentType: 10,
      partnerName: `Dodávateľ ${index + 1}`,
      issueDate: isoDate(shiftMonths(referenceDate, -1, 5)),
      deliveryDate: isoDate(shiftMonths(referenceDate, -1, 5)),
      dueDate: isoDate(due),
      totalPrice: Math.round(item.amount * 0.6),
      vatAmount: Math.round(item.amount * 0.12),
      paymentStatus: "notPaid",
      hasAttachments: false,
      tags: [TAGS[index % TAGS.length]],
      allocations: [{ tags: [TAGS[index % TAGS.length]], amount: Math.round(item.amount * 0.6) }]
    });
  }

  const accounts: NormalizedPaymentAccount[] = [
    {
      id: "demo-acc-1",
      companyId: 1,
      companyName: COMPANIES[0],
      name: "Slovenská sporiteľňa — bežný",
      type: "bank",
      currency: "EUR",
      startingBalance: 11480
    },
    {
      id: "demo-acc-2",
      companyId: 1,
      companyName: COMPANIES[0],
      name: "VÚB — sporiaci",
      type: "bank",
      currency: "EUR",
      startingBalance: 5260
    },
    {
      id: "demo-acc-3",
      companyId: 2,
      companyName: COMPANIES[1],
      name: "Pokladňa — hotovosť",
      type: "cash",
      currency: "EUR",
      startingBalance: 890
    }
  ];

  const transactions: NormalizedPaymentTransaction[] = [];

  return { invoices, expenses, accounts, transactions };
}
```

- [ ] **Step 4: Spusti test a over, že prechádza**

Run: `npx vitest run src/lib/home-mock-data.test.ts`
Expected: PASS, 5 testov. Ak niektorý padne (napr. pohľadávky vyjdú nulové), uprav **dáta**, nie test — test popisuje, čo demo musí ukázať.

- [ ] **Step 5: Zapoj demo do `src/app/page.tsx`**

Za dáta z orchestrátora vlož prepnutie zdroja:

```ts
  const hasLiveMode = connections.length > 0;
  // Bez prepojenia ide demo tými istými funkciami ako živé dáta — nie vlastnou
  // vetvou výpočtov, ktorá by sa časom rozišla s tou skutočnou.
  const demoData = useMemo(() => (hasLiveMode ? null : getHomeMockData()), [hasLiveMode]);
  const invoices = demoData?.invoices ?? liveInvoices;
  const expenses = demoData?.expenses ?? liveExpenses;
  const cashflowAccounts = demoData?.accounts ?? liveAccounts;
  const transactions = demoData?.transactions ?? liveTransactions;
```

a premenuj dáta z orchestrátora na `liveInvoices`, `liveExpenses`, `liveAccounts`, `liveTransactions`:

```ts
  const {
    data: {
      invoices: liveInvoices,
      expenses: liveExpenses,
      accounts: liveAccounts,
      transactions: liveTransactions
    },
    isSyncing,
    hasResolvedFirstData,
    refresh
  } = useSyncOrchestrator(HOME_ENGINES, {
    connections,
    syncConnections,
    granularity,
    enabled: hasLoadedPersistedFilters
  });
```

Zvyšok stránky sa nemení — `scopedInvoices` a spol. už čítajú `invoices` a `expenses`.

- [ ] **Step 6: Over v prehliadači bez prepojenia**

Otvor `/` v prehliadači, kde nie je prepojená žiadna firma (alebo dočasne odpoj firmu v `/settings`). Over, že sa ukáže `DemoDataBanner` a **všetkých šesť sekcií má čísla** — vrátane pohľadávok a DPH, ktoré nesmú hlásiť „Údaj z KROS nedostupný": v demo režime žiadny KROS nie je a tá hláška by bola zavádzajúca.

- [ ] **Step 7: Over všetko a commitni**

Run: `npx tsc --noEmit && npm test && npm run lint && npm run build`
Expected: bez chýb.

```bash
git add src/lib/home-mock-data.ts src/lib/home-mock-data.test.ts src/app/page.tsx
git commit -m "feat(home): demo dáta ako doklady, nie ako hotové súčty"
```

---

## Po dokončení

- [ ] Spusti celý balík naposledy: `npx tsc --noEmit && npm test && npm run lint && npm run build`
- [ ] Odstráň diagnostiku z Task 1, ak už netreba (`KROS_LOG_SAMPLE_PAYLOAD` v oboch route handleroch a v `.env.example`)
- [ ] Aktualizuj `README.md`: zoznam dashboardov na začiatku súboru dnes menuje tri; doplň Domov ako hlavnú obrazovku a spomeň, že moduly zdieľajú sťahovanie cez `src/lib/sync/`
- [ ] Použi skill `superpowers:finishing-a-development-branch`

## Známe obmedzenia po dokončení

Toto sú vedomé rozhodnutia zo špecifikácie, nie nedorobky:

- **Zisk na štítok je pri viacštítkových faktúrach nadhodnotený** — príjmová strana priraďuje celý doklad každému štítku, výdavková ho rozdeľuje. Priznané textom pod zoznamom.
- **Žiadne zápisy do KROS** — tlačidlá „Pripomenúť" a „Zaplatiť" zo screenshotu neexistujú, lebo API na ne nemá endpoint.
- **Stav podania DPH priznania appka nevie**, preto pri odhade nie sú odznaky „Neuhradené / Prebieha".
