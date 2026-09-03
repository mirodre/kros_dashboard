# Nastavenia viazané na firmu (tenanta) — implementačný plán fáz 0 a 1

> **Pre agentov:** kroky sú checkboxy (`- [ ]`) kvôli sledovaniu postupu. Rovnako ako plán
> fázy SSO sa vykonáva po úlohách — každá úloha je samostatne recenzovateľná a samostatne
> nasaditeľná.

**Cieľ:** appka dostane Postgres a začne si pamätať filtre a nastavenia na serveri — firemne
(zdieľané medzi ľuďmi v tenante) s osobným prepísaním. Prepojenia na KROS sa **v týchto fázach
nemenia**, tie sú fáza 2.

**Spec:** `docs/superpowers/specs/2026-09-03-per-user-nastavenia-cross-device-navrh.md`

**Architektúra:** `tenant_preference` (firemná úroveň) + `user_preference` (osobná vrstva),
vyhodnotenie `osobné ?? firemné ?? default`. Úroveň každého kľúča je v jednom registri v kóde.
`localStorage` zostáva ako cache pre okamžitý paint a offline; server je zdroj pravdy.
Rozhodovacia logika (zlúčenie úrovní, migrácia, prienik s firmami) žije v čistých funkciách
mimo Reactu aj mimo route handlerov, aby sa dala testovať bez Next runtime — rovnaký vzor ako
`src/lib/token-lifecycle.ts` vo fáze SSO.

**Tech stack:** Next.js 16.2.6 (App Router), React 19, TypeScript 5.8 (`strict`), Postgres cez
`pg`, Vitest, Node 20 (nixpacks).

## Globálne obmedzenia

- **`tenant_id`, `sub` aj `role` VÝHRADNE zo session claimov.** Nikdy z tela requestu, nikdy
  z query. Tenant je jediná hranica medzi firmami — rola sa nekontroluje (rozhodnutie
  z 3.9.2026), takže na tejto jednej veci stojí všetko.
- **Appka musí fungovať aj bez databázy.** Nedostupný Postgres alebo chýbajúci `DATABASE_URL`
  znamená 503 z `/api/preferences` a ďalej beh na lokálnom stave — nie rozbitý dashboard.
  Appka je PWA a offline režim je vlastnosť, nie výnimka.
- **Nikdy sa nečaká na sieť pred prvým paintom.** Filtre sa čítajú z `localStorage` okamžite,
  server ich len dorovná.
- **Migrácia z `localStorage` ide do OSOBNEJ úrovne.** Do firemnej nikdy — inak prvý človek po
  nasadení prestaví dashboard celej firme.
- **Zbalenie sekcií a granularita sú osobné.** Register úrovní je jediné miesto pravdy a musí
  na to mať test.
- **`pg`, nie ORM.** Dotazov je pár a sú triviálne; ORM by pridal migračný nástroj, generátor
  a lifecycle bez úžitku.
- **Slovenčina v hláškach, komentáre vysvetľujú *prečo*, nie *čo*.**
- **Každá asercia typu „X sa stalo" sa dokazuje mutáciou** — dočasne odstráň kód, ktorý to robí,
  over že test padne, vráť, over že prejde. Tautologický test je horší než žiadny.
- **Overovacie príkazy:** `npm test`, `npx tsc --noEmit`, `npm run lint`, `npm run build`.

---

## Úloha 1: Postgres — pripojenie a migrácie

**Súbory:**
- Vytvoriť: `src/lib/db/pool.ts`, `src/lib/db/migrate.ts`, `src/lib/db/migrations/001_preferences.sql`,
  `src/instrumentation.ts`, `src/lib/db/migrate.test.ts`
- Upraviť: `package.json`, `.env.example`, `README.md`

**Rozhrania:** `getPool(): Pool | null` (null keď `DATABASE_URL` chýba), `runMigrations(): Promise<void>`.

- [ ] **Krok 1:** `npm install pg` a `npm install -D @types/pg`.
- [ ] **Krok 2:** `pool.ts` — pool ako singleton cez `globalThis`. Bez toho ho hot reload v dev
      režime vyrobí pri každej zmene znova a Postgres vyčerpá spojenia. Chýbajúci `DATABASE_URL`
      vráti `null` a **hlasno zaloguje raz**, nehodí výnimku (viď globálne obmedzenia).
- [ ] **Krok 3:** `001_preferences.sql` — tabuľky `tenant_preference` a `user_preference` podľa
      spec-u, plus `schema_migrations (name text primary key, applied_at timestamptz)`.
- [ ] **Krok 4:** `migrate.ts` — načíta `migrations/*.sql` v abecednom poradí, preskočí už
      aplikované, každú aplikuje v transakcii. Celý beh obalí `pg_advisory_lock`: jedna replika
      je dnes podmienka, nie zámok, a migrácie sú presne to miesto, kde by jej porušenie
      spôsobilo tichú škodu.
- [ ] **Krok 5:** test — dvojitý beh `runMigrations()` neaplikuje nič druhýkrát; zlyhanie
      v strede súboru nenechá polovičnú schému (transakcia).
- [ ] **Krok 6:** `instrumentation.ts` s `register()` — migrácie pri štarte servera, len
      v `nodejs` runtime. Deploy je `npm run build && npm run start` (README), takže migračný
      krok navyše by sa raz zabudol. Pridaj aj `npm run migrate` na ručné spustenie.
- [ ] **Krok 7:** `.env.example` + `README.md` — `DATABASE_URL`, poznámka že po zmene premennej
      je potrebný **redeploy, nie restart** (rovnako ako pri SSO premenných).
- [ ] **Krok 8:** overenie — `npm test`, `npx tsc --noEmit`, `npm run lint`, `npm run build`.

---

## Úloha 2 (fáza 0): tenant v claimoch a v hlavičke

Bez tohto ľudia nevedia, ktorej firmy nastavenia menia — a firemné filtre sa bez toho nedajú
zaviesť zodpovedne.

**Súbory:**
- Upraviť: `src/lib/sso-claims.ts`, `src/lib/sso-claims.test.ts`, `src/auth-callbacks.ts`,
  `src/components/dashboard-shell.tsx`
- Vytvoriť: `src/lib/preferences/scope.ts`, `src/lib/preferences/scope.test.ts`

**Rozhrania:** `preferenceScope(claims) → { tenantId, userSub, isPersonalFallback }`.

- [ ] **Krok 1:** test — `claimsFromMe` si zachová celý zoznam organizácií (`id`, `name`, `role`),
      nielen aktívnu. Dnes ho zahadzuje.
- [ ] **Krok 2:** rozšíriť `SsoClaims` o `organizations` a naplniť ho. Komentár nech povie, že
      zoznam je pre budúci prepínač a pre kontrolu, do ktorej firmy zápis patrí.
- [ ] **Krok 3:** test — `preferenceScope` vráti `tenantId = organizationId`, keď je; a
      `user:<sub>` s `isPersonalFallback: true`, keď `active_organization` je `null` **alebo**
      ukazuje na firmu mimo zoznamu (na oba prípady existuje test v `sso-claims.test.ts`).
- [ ] **Krok 4:** implementovať `scope.ts`. Je to jediné miesto, kde sa rozhoduje, čo je tenant —
      nikde inde sa `organizationId` nečíta priamo.
- [ ] **Krok 5:** `DashboardShell` ukáže názov firmy v hlavičke; pri osobnom fallbacku nič,
      žiadne „(bez firmy)".
- [ ] **Krok 6:** overenie ako v úlohe 1. Cookie po pridaní zoznamu narástla — pozri jej veľkosť
      v prehliadači, limit je 4 kB na doménu.

---

## Úloha 3: register kľúčov a vyhodnotenie úrovní (čisté funkcie)

Srdce celej fázy. Žiadna databáza, žiadny React — len funkcie a testy.

**Súbory:**
- Vytvoriť: `src/lib/preferences/registry.ts`, `src/lib/preferences/resolve.ts`,
  `src/lib/preferences/resolve.test.ts`, `src/lib/preferences/legacy-keys.ts`,
  `src/lib/preferences/legacy-keys.test.ts`

**Rozhrania:**
- `PREFERENCE_KEYS: Record<PreferenceKey, { level: "tenant" | "user"; default: unknown }>`
- `resolvePreferences({ tenant, user }) → { values, personalKeys }`
- `migrationFromLocalStorage(localValues, serverValues) → Partial<Values>`

- [ ] **Krok 1:** test — kľúč s osobnou aj firemnou hodnotou vráti osobnú; bez osobnej firemnú;
      bez oboch default z registra; `personalKeys` obsahuje presne tie, čo sú prepísané.
- [ ] **Krok 2:** test — **zbalenie sekcie ani granularita sa nikdy nezapíšu na firemnú úroveň.**
      Toto je test na register, nie na route: keď niekto neskôr pridá kľúč, musí sa rozhodnúť.
- [ ] **Krok 3:** implementovať `registry.ts` s piatimi `tenant` kľúčmi (filtre) a siedmimi
      `user` (5× zbalenie, granularita, a rezerva na ergonómiu) podľa tabuľky v spec-e.
- [ ] **Krok 4:** test migrácie — lokálna hodnota sa nahrá, len keď server pre kľúč **nemá nič**;
      keď server hodnotu má, lokálna sa ignoruje (inak by zmazaný filter vstal z mŕtvych).
- [ ] **Krok 5:** implementovať `legacy-keys.ts` — mapovanie 11 dnešných `kros_dashboard_*`
      kľúčov na nové mená, na jednom mieste. Staré kľúče sa **nemažú**: keby sa nasadenie
      vrátilo, appka o nastavenia nepríde.
- [ ] **Krok 6:** overenie.

---

## Úloha 4: úložisko a API

**Súbory:**
- Vytvoriť: `src/lib/preferences/repository.ts`, `src/app/api/preferences/route.ts`,
  `src/app/api/preferences/tenant/route.ts`, `src/app/api/preferences/route.test.ts`
- Upraviť: `src/lib/public-paths.test.ts` (regresia deny-by-default)

**Rozhrania:**
- `GET /api/preferences` → `{ values, personalKeys, tenantUpdatedBy }`
- `PATCH /api/preferences` `{ [key]: value }` → osobná úroveň
- `PUT /api/preferences/tenant` `{ [key]: value }` → firemná úroveň
- `DELETE /api/preferences` `{ keys: string[] }` → zmaže osobné prepísanie („vrátiť sa na firemné")

- [ ] **Krok 1:** test — bez session vracia 401 (nie redirect, je to `/api/`).
- [ ] **Krok 2:** test — **`tenant_id` z tela requestu sa ignoruje**; človek z tenanta A
      nedostane hodnoty tenanta B a nezapíše doň. Najdôležitejší test celej úlohy: rola sa
      nekontroluje, takže tenant zo session je jediná hranica.
- [ ] **Krok 3:** test — neznámy kľúč (nie je v registri) sa odmietne 400. Bez toho je
      `user_preference` otvorené úložisko ľubovoľného JSON-u na cudzí účet.
- [ ] **Krok 4:** test — `PATCH` na kľúč úrovne `user` prejde; `PUT /tenant` na taký kľúč
      vráti 400.
- [ ] **Krok 5:** implementovať repository (`insert … on conflict do update`) a oba handlery.
      `updated_by_sub` sa zapisuje pri každom firemnom zápise.
- [ ] **Krok 6:** test — pri nedostupnej databáze handler vráti 503 a **nezhodí** proces.
- [ ] **Krok 7:** regresia — nová route je chránená bez zásahu do `middleware.ts`.
- [ ] **Krok 8:** overenie.

---

## Úloha 5: klientský store a napojenie stránok

Najväčšia úloha na počet dotknutých súborov, ale bez rozhodovania — to je v úlohách 3 a 4.

**Súbory:**
- Vytvoriť: `src/lib/preferences/store.ts`, `src/lib/preferences/store.test.ts`,
  `src/lib/use-preference.ts`
- Upraviť: `src/app/page.tsx`, `src/app/expenses/page.tsx`, `src/app/cashflow/page.tsx`,
  `src/lib/use-persisted-collapsed.ts`, `src/components/categorized-tags-dashboard.tsx`

- [ ] **Krok 1:** test store-u (čistý modul, `useSyncExternalStore` až nad ním) — zápis
      aktualizuje stav aj `localStorage` synchrónne; odpoveď servera prepíše stav; zlyhanie
      zápisu stav nezmení a nevyhodí chybu do UI.
- [ ] **Krok 2:** test — zápisy sa zlučujú s debounce ~800 ms do jedného `PATCH` (rýchle
      klikanie vo filtri nesmie poslať dvadsať requestov).
- [ ] **Krok 3:** implementovať store: načítanie z `localStorage` → okamžitý stav, `GET`
      na pozadí, zlúčenie cez `resolvePreferences`, jednorazová migrácia s príznakom
      `kros_dashboard_prefs_migrated_v1`.
- [ ] **Krok 4:** `useSyncExternalStore` hook `usePreference(key)`; nahradiť ním priame
      `localStorage` čítania a zápisy v troch stránkach a v `usePersistedCollapsed`.
      Kľúč `storageKey` v komponentoch zostáva rovnaký reťazec — mapuje ho `legacy-keys.ts`.
- [ ] **Krok 5:** granularita prestáva žiť v `globalThis.__krosDashboardGranularity`
      a stáva sa osobným kľúčom `ui.granularity`. Deklaráciu `declare global` odstrániť.
- [ ] **Krok 6:** overiť ručne v prehliadači: filtre nastavené v jednom okne sa po reloade
      v druhom (iná session toho istého konta) zobrazia; pri vypnutom serveri appka funguje.
- [ ] **Krok 7:** overenie príkazmi.

---

## Úloha 6: prienik s dostupnými firmami

Bez tejto úlohy sa zdieľané filtre prejavia ako prázdny dashboard u človeka, ktorý má
prepojené iné firmy — a to je do fázy 2 bežný stav, nie výnimka.

**Súbory:**
- Vytvoriť: `src/lib/preferences/company-filter.ts`, `src/lib/preferences/company-filter.test.ts`
- Upraviť: `src/app/page.tsx`, `src/app/expenses/page.tsx`, `src/app/cashflow/page.tsx`

- [ ] **Krok 1:** test — prázdny výber = všetky dostupné firmy (dnešné správanie); neprázdny
      výber sa oreže na dostupné; **neprázdny výber s prázdnym prienikom vráti príznak
      `noneAvailable`**, nie tichú nulu.
- [ ] **Krok 2:** implementovať čistú funkciu a nahradiť ňou tri kópie tejto logiky
      (`syncConnections` v každej stránke robí dnes takmer to isté, len cashflow inak).
- [ ] **Krok 3:** UI hláška pri `noneAvailable`: „Uložený filter obsahuje firmy, ktoré na tomto
      zariadení nie sú prepojené." s odkazom na Nastavenia.
- [ ] **Krok 4:** overenie.

---

## Úloha 7: zdieľanie a návrat k firemnému

**Súbory:**
- Upraviť: `src/app/settings/page.tsx`
- Vytvoriť: `src/app/settings/settings.test.ts` (ak dá zmysel bez jsdom, inak len čisté funkcie)

- [ ] **Krok 1:** v Nastaveniach panel „Firemné predvolené" s dvoma akciami: *Nastaviť aktuálne
      filtre ako firemné* (`PUT /api/preferences/tenant`) a *Vrátiť sa na firemné* (`DELETE`).
- [ ] **Krok 2:** ukázať `tenantUpdatedBy` a čas — keďže to smie meniť hocikto, stopa je jediné,
      čo zostáva. Bez nej sa nedá zistiť, kto firemný filter prestavil.
- [ ] **Krok 3:** text dialógu pri zdieľaní musí povedať, že sa to prejaví **všetkým vo firme**.
- [ ] **Krok 4:** **test regresie: „Vymazať cache dát" nezmaže filtre.** Dnešný
      `handleClearInvoiceCache` maže tri cache a `kros_dashboard_last_sync_at`; po tejto fáze
      žijú filtre v tom istom `localStorage`, takže je to jedna „oprava" od zmazania. Test na
      zoznam kľúčov, ktorých sa tlačidlo smie dotknúť.
- [ ] **Krok 5:** overenie.

---

## Nasadenie

1. **Postgres v Dokploy** ako služba; poznač si, či je zálohovaný — bez zálohy je to lepšie
   SQLite, nie horší Postgres.
2. **`DATABASE_URL`** do premenných appky. Po zmene **redeploy, nie restart**.
3. Prvý štart aplikuje migrácie sám (`instrumentation.ts`); over v logu, že prebehli.
4. Po nasadení: otvor appku, over že filtre ostali (migrácia z `localStorage`), nastav firemné
   predvolené a over ich na druhom konte v tej istej firme.

## Mimo rozsahu týchto fáz

- Prepojenia na KROS (fáza 2) — `localStorage` a telo requestu zostávajú ako dnes.
- Doklady na serveri.
- Prepínač organizácií (fáza 0 rieši len zobrazenie názvu a claimy).
