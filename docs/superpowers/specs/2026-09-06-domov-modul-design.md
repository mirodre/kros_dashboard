# Modul Domov — návrh

Dátum: 2026-09-06

## Problém

Appka má tri moduly (Príjmy, Výdavky, Financie) a každý odpovedá na svoju otázku.
Neodpovedá na tú prvú, ktorú si človek kladie po otvorení appky: *ako sme na tom?*
Zisk, dlžoby, hotovosť a DPH sú dnes rozhádzané po troch obrazovkách a niektoré
z nich (zisk, čistá pozícia pohľadávok a záväzkov) nikde neexistujú, lebo vznikajú
až spojením dvoch modulov.

Domov je nová hlavná obrazovka, ktorá tie odpovede dá na jeden pohľad. Je to
**výcuc z existujúcich dát, nie nový zdroj dát.**

## Zásada, ktorá riadi celý návrh

Domov nesmie sťahovať nič, čo už niektorý modul stiahol. Nie preto, že by sa na to
dávalo pozor pri písaní kódu, ale preto, že to má byť konštrukčne nemožné.

Zdrojom pravdy o tom, čo je stiahnuté, je `syncMeta` v IndexedDB — nie stav stránky.
Keď Domov dotiahne august faktúr, plánovač faktúr na `/prijmy` ten mesiac už
nezaradí a stránka len prečíta cache. Platí to aj opačne a aj medzi kartami prehliadača.

## Architektúra dát

### Dnešný stav

Každá z troch stránok je klientský komponent, ktorý si sám drží filtre
(`usePreference`), prepojenia (`useKrosConnections`) a **vlastný sync efekt
s ~200 riadkami** (plán krokov → fetch → normalizácia → IndexedDB → `syncMeta` →
progress bar). Tri kópie toho istého tvaru, žiadna nie je testovaná — sync je
zapletený do komponentu a nedá sa zavolať samostatne.

`sync-progress-store` má navyše **jediného vlastníka**: keby Domov spustil tri
syncy naraz, každý by druhému prepisoval ukazovateľ priebehu.

### Cieľový stav

Nová vrstva `src/lib/sync/`:

```
src/lib/sync/
  types.ts                  SyncEngine, PlanContext, RunContext
  invoice-engine.ts         presunuté z src/app/page.tsx
  expense-engine.ts         presunuté z src/app/expenses/page.tsx
  cashflow-engine.ts        presunuté z src/app/cashflow/page.tsx
  use-sync-orchestrator.ts  jeden plán, jeden progress, hydratácia z cache
```

```ts
type SyncEngine<TStep, TData> = {
  /** Prečíta IndexedDB cache — bez siete. Beží pri mounte a po každom kroku. */
  hydrate(companyIds: number[]): Promise<TData>;
  /** Čo treba stiahnuť. Raz pred prvým fetchom, aby progress bar poznal celok. */
  plan(ctx: PlanContext): Promise<TStep[]>;
  /** Krok tak, ako ho vidí človek na obrazovke sťahovania. */
  describe(step: TStep): SyncStep;
  /** fetch → normalizácia → zápis do cache → syncMeta. */
  run(step: TStep, ctx: RunContext): Promise<void>;
};
```

`RunContext` nesie `signal` a `onProgress(fraction, detail)`. To druhé potrebujú
Financie kvôli NDJSON streamu (dnešný `advanceStep`), faktúry a výdavky nie.
Engine tak nevie nič o `sync-progress-store` — hlási len zlomok svojho kroku.

**Orchestrátor** dostane pole enginov, zreťazí ich plány za seba (faktúry →
výdavky → účty) a spustí **jeden** `beginSync` nad spoločným zoznamom krokov.
`sync-progress-store` sa preto nemení ani o riadok: jeho vlastníkom je orchestrátor,
nie doména.

```ts
// Domov
const { invoices, expenses, accounts, transactions, isSyncing, refresh, hasResolvedFirstData } =
  useSyncOrchestrator([invoiceEngine, expenseEngine, cashflowEngine], { connections, granularity });

// /prijmy — ten istý hook, jeden engine
const { invoices, ... } = useSyncOrchestrator([invoiceEngine], { connections, granularity });
```

Pravidlo pre `immersive` (celá obrazovka sťahovania vs. lišta v hlavičke) ostáva
dnešné — prázdna cache alebo ≥ 3 kroky — len sa počíta raz nad zlúčeným plánom
namiesto trikrát nad tromi.

### Čo sa mení a čo nie

Mení sa: tri stránky stratia sync efekt a nahradia ho jedným volaním orchestrátora.
`useMemo` výpočty a render ostávajú nedotknuté.

Nemení sa: `sync-progress-store`, `DashboardShell`, `use-preference`, API routes,
cache moduly.

### Priznaná cena

- **Refaktor troch fungujúcich modulov bez záchrannej siete.** Sync efekt dnes nemá
  ani jeden test. Preto sa extrahuje po jednom module, každý dostane test `plan()`
  nad falošnou cache a overí sa v prehliadači, kým je s čím porovnávať.
- **Pamäť.** Domov drží naraz faktúry, výdavky (vrátane rozúčtovania na štítky)
  a pohyby. Prepočty idú cez `startTransition` ako dnes, ale pri veľkej firme
  to bude najťažšia obrazovka appky. Ak sa to ukáže ako problém, riešením je
  predpočítať agregáty pri zápise do cache — nerieši sa dopredu.

## Routing a menu

| Cesta | Modul |
|---|---|
| `/` | **Domov** (nový) |
| `/prijmy` | Príjmy (presun z `/`) |
| `/expenses` | Výdavky (bez zmeny) |
| `/cashflow` | Financie (bez zmeny) |
| `/settings` | Nastavenia (bez zmeny) |

Domov je koreň, lebo to je obrazovka, ktorú človek dostane po prihlásení a ktorú
si uloží na plochu ako PWA.

Spodné menu má päť položiek: `grid-template-columns: repeat(5, minmax(0, 1fr))`
a zmenšený popisok. Overiť na 375px, či sa „Nastavenia" a „Financie" dajú prečítať
a trafiť prstom.

## Obsah obrazovky

Poradie zhora nadol.

### 1. Zisk firmy (hlavný panel)

Veľké číslo je zisk za vybrané obdobie s deltou oproti vlaňajšku. Graf má na
obdobie **dva stĺpce — Príjmy a Výdavky za to isté obdobie** — a nad nimi **čiaru
zisku** (rozdiel). Pod grafom dve KPI: Príjmy a Výdavky, každé s deltou.

**Jedna škála v eurách pre stĺpce aj čiaru.** Dve osi pre rovnaké jednotky by boli
spôsob, ako číslami klamať. Keď je v niektorom období zisk záporný, nulová čiara
sa odlepí od spodku grafu: stĺpce rastú od nej hore, čiara zisku pod ňu klesá.
Stratový mesiac tak vidno na prvý pohľad.

Dôsledok pre CSS: dnešný graf je poskladaný z `div`-ov (`.bar-stack`, výška v %
od spodku). Prerobí sa na „výška od nulovej čiary" a pribudne SVG vrstva pre čiaru
zisku, ktorú dnes nemá čo kresliť.

Porovnanie s vlaňajškom sa z grafu stráca (dnes sú to práve tie dva stĺpce
v Príjmoch) a presúva sa do KPI odznakov a do tooltipu — ten ukáže Príjmy /
Výdavky / Zisk a pri každom vlaňajšiu hodnotu.

Klik na stĺpec zafiltruje všetky sekcie pod ním, rovnako ako v Príjmoch
(`getBucketPeriodWindow`, focus stĺpca nie je uložený filter).

Zdroj: `computeRevenueSeries` a `computeExpenseSeries` zlúčené podľa `label` —
obe už vracajú tie isté buckety.

*AI karta zo screenshotu („Váš priemerný mesiac dělá 4567 E") sa nerobí — appka
nemá AI vrstvu.*

### 2. Pohľadávky a záväzky

Veľké číslo je čistá pozícia (dostať − zaplatiť), „čiastka po vyrovnaní". Pod tým
dva riadky s pásikmi:

- **Mám dostať** — neuhradené vydané faktúry: v splatnosti / po splatnosti /
  po splatnosti nad 60 dní
- **Mám zaplatiť** — neuhradené výdavky: v splatnosti / po splatnosti

Zdroj: existujúci `computeExpenseDueWatchlist` rozšírený o 60-dňové pásmo,
plus nový `computeReceivablesWatchlist` nad faktúrami.

*Tlačidlá „Pripomenúť →" a „Zaplatiť →" zo screenshotu sa nerobia — KROS API nemá
zápis, bolo by to tlačidlo, ktoré nič nerobí.*

### 3. Peniaze na účtoch

Súčet zostatkov, „Celkovo N účtov", donut s legendou, v rohu preklik `Financie →`.

Zdroj: `computeCashflowOverviewFromLiveData`, `donut-legend.tsx`,
`use-donut-entrance.ts` — všetko hotové.

### 4. Predpokladaná DPH

Minulý mesiac a tento mesiac. DPH na výstupe (faktúry) − DPH na vstupe (výdavky),
plus vysvetľujúca veta, že ide o odhad z dokladov v systéme.

*Odznaky „Neuhradené" / „Prebieha" sa nerobia — stav podania appka nevie
a vymyslený stav pri sume DPH je horší než žiadny.*

### 5. Zisk podľa štítkov

Kategórie a štítky ako na ostatných moduloch. Pri štítku stojí **zisk**, pod ním
malým písmom obe zložky (napr. `24 850 − 17 320`).

**Známa asymetria, ktorú treba priznať v UI.** Faktúra s dvoma štítkami sa započíta
celá do oboch (`computeTagBreakdown`), kým výdavok sa rozdelí podľa rozúčtovania
(`scopeExpenseAmountsToTagFilters`). Zisk na štítok teda nie je súčet, ktorý by dal
celkový zisk, a pri viacštítkových faktúrach bude nadhodnotený. Prerobiť aj príjmovú
stranu na rozúčtovanie je vlastný projekt, nie súčasť tohto.

**Zmena po nasadení (2026-09-06):** pôvodne tu stálo, že pod zoznam patrí jedna veta,
ktorá tú nepresnosť povie, a tá veta sa aj naozaj vykresľovala. Používateľ si ju
vyžiadal zmazať. Asymetria tým nezmizla — Domov ju len už nepomenúva na obrazovke;
zostáva zapísaná v komentári nad tou sekciou v `src/app/page.tsx`.

### 6. Zisk podľa firiem

Vzor `CompaniesDashboard` (berie `collapsedKey` ako prop, takže sa dá použiť
s novým kľúčom), rozklik firmy = focus.

### Hlavička

`CategoryVisibilityButton` ako na ostatných moduloch: skrývanie sekcií, prepínač
obdobia, počty aktívnych filtrov.

### Čo ktorý filter ovplyvňuje

Sekcie Domova nie sú rovnaké druhy čísla a nesmú na filtre reagovať rovnako.
Sekcie 1, 5 a 6 sú **tok za obdobie**; sekcie 2, 3 a 4 sú **stav k dnešku**.

| Sekcia | Obdobie (prepínač) | Focus stĺpca | Filter štítkov | Filter firiem |
|---|---|---|---|---|
| 1. Zisk firmy | áno | áno | áno | áno |
| 2. Pohľadávky a záväzky | nie | nie | áno | áno |
| 3. Peniaze na účtoch | nie | nie | nie | áno |
| 4. Odhad DPH | nie | nie | nie | áno |
| 5. Zisk podľa štítkov | áno | áno | áno | áno |
| 6. Zisk podľa firiem | áno | áno | áno | áno |

Dôvody, kde to nie je zrejmé:

- **Pohľadávky a záväzky** sú neuhradené doklady k dnešku. Zúžiť ich na jeden
  mesiac grafu by dalo číslo, ktoré nikoho nezaujíma — dlžoba nezaniká tým,
  že vznikla vlani.
- **Peniaze na účtoch** sú zostatok teraz. Účet nemá štítky, takže filter štítkov
  naň nemá ako pôsobiť; firma áno, lebo účet firme patrí.
- **Odhad DPH** je vždy za kalendárne mesiace (minulý a tento), bez ohľadu na to,
  či je prepínač obdobia na týždňoch alebo rokoch. DPH sa podáva po mesiacoch
  a inak ako po mesiacoch je to číslo nezmysel.

Keď je focus stĺpca aktívny, sekcie 2–4 to musia priznať — inak by pôsobili,
že sa nezmenili omylom. Krátky text v hlavičke panela: *„k dnešku, nezávisle
od vybraného obdobia".*

## Nové súbory a kľúče

`src/lib/home-live.ts` — čisté funkcie nad poľami dokladov:
`computeProfitSeries`, `computeProfitKpis`, `computeProfitTagBreakdown`,
`computeProfitCompanyBreakdown`, `computeReceivablesWatchlist`, `computeVatEstimate`.

Predvoľby v `src/lib/preferences/registry.ts`:

| Kľúč | Úroveň | Význam |
|---|---|---|
| `home.tagFilters` | tenant | filter štítkov Domova, aplikuje sa na obe strany |
| `home.companies` | tenant | filter firiem Domova |
| `ui.homeHiddenSections` | user | skryté sekcie |
| `ui.collapsed.homeCompanies` | user | zbalenie panela firiem |
| `ui.collapsed.homeReceivables` | user | zbalenie panela pohľadávok |
| `ui.collapsed.homeAccounts` | user | zbalenie panela účtov |
| `ui.collapsed.homeVat` | user | zbalenie panela DPH |

Domov má **vlastné** filtre, nie zdieľané s modulmi: zmena na Domove nesmie
prestaviť Príjmy ani Výdavky. `ui.granularity` a `ui.collapsed.tagCategories`
sú naopak spoločné, ako doteraz naprieč modulmi.

## Zmeny v normalizácii a cache

`NormalizedInvoice` dostane `paymentStatus`, `dueDate` a sumu DPH.
`NormalizedExpense` dostane sumu DPH.

**Oprava z 2026-09-06:** pôvodne tu stálo, že sa opraví „latentná chyba" —
že `normalizeInvoices` číta sumu len z `legislativePrices` a mal by mať fallback
na `documentPrices`, ako ho majú výdavky. Skutočné odpovede KROS API to vyvrátili
(pozri [2026-09-06-domov-kros-polia.md](../plans/2026-09-06-domov-kros-polia.md)):

- Vo vzorke 100 faktúr a 100 výdavkov **nie je ani jeden doklad**, kde by bola
  legislatívna suma nulová a dokladová nenulová. Chyba nemá oporu.
- `documentPrices` je v **mene dokladu**, `legislativePrices` v **eurách** — podiel
  sa presne rovná `prices.exchangeRate`. Doklady chodia v EUR, CZK, PLN, GBP a USD.
  Fallback by pri českej faktúre pripočítal do eurového súčtu 67 919 namiesto 2 695.

Suma sa preto naďalej číta **výhradne z `legislativePrices`** a fallback sa nerobí.
To isté platí pre DPH (`legislativePrices.vatTotalPrice`).

Dobropisy chodia z KROSu **už so záporným znamienkom** na oboch stranách, vrátane
DPH. Normalizácia ani odhad DPH preto so znamienkami nič nerobia.

Verzie cache: faktúry `DB_VERSION` 3 → 4, výdavky 8 → 9. Obidve sa menia **jedným
atomickým editom na súbor** — pri HMR by rozdelený edit nechal živú stránku vykonať
medzistav a cache by sa premazala dvakrát.

Dôsledok pre ľudí: jednorazový plný re-sync po nasadení. Je to vedomá cena za
pohľadávky a DPH.

## Neistota v dátach — vyriešená 2026-09-06

Názvy polí sú overené na skutočných odpovediach KROS API, ktoré dodal používateľ.
Zistenia: [2026-09-06-domov-kros-polia.md](../plans/2026-09-06-domov-kros-polia.md).

Všetky tri potrebné polia existujú: `dueDate` (na faktúrach 100/100, na výdavkoch
chýba v 17/100), `paymentStatus` ako číselný kód s **rovnakým číselníkom** ako
výdavky, a DPH ako `prices.legislativePrices.vatTotalPrice` (nie `vatAmount`,
ako plán pôvodne predpokladal).

Vetva „**Údaj z KROS nedostupný**" v sekciách Pohľadávky a DPH ostáva — vzorka je
z jednej firmy a prvej stránky, takže je to obrana, nie mŕtvy kód. Chýbajúci údaj
a nulová suma sú dve rôzne správy a zamieňať ich pri peniazoch sa nesmie.

To isté platí pre demo režim: Domov bez prepojenia ukáže `DemoDataBanner`
a poskladá prehľad z troch existujúcich mock zdrojov (`mock-data.ts`,
`expenses-mock-data.ts`, `cashflow-mock-data.ts`).

## Poradie prác

**Fáza 0 — zistiť skutočný tvar dát.** Dočasné logovanie prvej položky každej
stránky za env prepínačom. Jeden refresh na živom prepojení, potom sa z logu
prečítajú skutočné názvy polí. Bez tohto by sa fázy 3–5 písali naslepo.

**Fáza 1 — extrakcia sync vrstvy, bez zmeny správania.** Engine po engine:
faktúry → výdavky → Financie. Každý dostane test `plan()` nad falošnou cache
a overí sa v prehliadači.

**Fáza 2 — routing a menu.** `src/app/page.tsx` → `src/app/prijmy/page.tsx`,
na `/` prázdny Domov. Menu na päť položiek, overiť na 375px.

**Fáza 3 — normalizácia a bumpy cache** podľa zistení z fázy 0.

**Fáza 4 — `home-live.ts`.** Čisté funkcie, takže testy idú pred kódom: znamienka
dobropisov, prázdne obdobia, faktúra bez `dueDate`, záporný zisk.

**Fáza 5 — obrazovka**, sekcia po sekcii v poradí: Zisk firmy → Peniaze na účtoch
→ Pohľadávky a záväzky → DPH → Zisk podľa štítkov → Zisk podľa firiem. Každá sekcia
je samostatne pozerateľná.

## Čo do tohto projektu nepatrí

- Prerobenie príjmovej strany na rozúčtovanie na štítky (viď asymetria v sekcii 5)
- Akékoľvek zápisy do KROS (upomienky, platby)
- Stav podania DPH priznania
- AI odporúčania a predikcie
- Predpočítané agregáty v cache (až keď sa pamäť ukáže ako skutočný problém)
