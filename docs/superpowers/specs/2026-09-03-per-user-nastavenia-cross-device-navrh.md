# Nastavenia zapamätané na používateľa naprieč zariadeniami — návrh možností

**Cieľ:** čo si človek v appke nastaví (filtre firiem, filtre štítkov, zbalené sekcie,
granularita) ho má nasledovať na iné zariadenie — telefón, tablet, notebook — len na
základe toho, že je prihlásený tým istým kontom v `authentication_service`.

**Nadväzuje na:** fázu SSO
(`docs/superpowers/specs/2026-09-02-kros-dashboard-sso-klient-design.md`), ktorá túto
úlohu výslovne odložila: *„databáza, ktorá príde s filtrami, je na business dáta, nie na
identitu. Kľúčuje sa `sub`-om zo `/api/me`."* Tento dokument je pokračovanie tej vety.

**Stav dokumentu:** návrh možností na rozhodnutie. Implementačný plán vznikne až po výbere
varianty (bod „Otvorené otázky" na konci).

---

## Východisko

Appka dnes nemá žiadne serverové úložisko. Všetko, čo si pamätá, je v prehliadači, teda
per zariadenie a per profil prehliadača. Konkrétny inventár:

### Skupina A — nastavenia, ktoré MAJÚ cestovať za používateľom

| kľúč | kde vzniká | obsah |
|---|---|---|
| `kros_dashboard_selected_tags` | `src/app/page.tsx:51` | filtre štítkov podľa kategórií (Príjmy) |
| `kros_dashboard_revenue_selected_companies` | `src/app/page.tsx:52` | vybrané firmy (Príjmy) |
| `kros_dashboard_expenses_selected_tags` | `src/app/expenses/page.tsx:50` | filtre štítkov (Výdavky) |
| `kros_dashboard_expenses_selected_companies` | `src/app/expenses/page.tsx:51` | vybrané firmy (Výdavky) |
| `kros_dashboard_cashflow_selected_companies` | `src/app/cashflow/page.tsx:32` | vybrané firmy (Cashflow) |
| `kros_dashboard_collapsed_tag_categories` | `src/components/categorized-tags-dashboard.tsx:15` | zbalené kategórie štítkov |
| `kros_dashboard_collapsed_companies` | `src/components/companies-dashboard.tsx` | zbalený panel firiem |
| `kros_dashboard_expenses_collapsed_companies` | `src/app/expenses/page.tsx:691` | to isté vo Výdavkoch |
| `kros_dashboard_collapsed_recent_invoices` | `src/components/recent-invoices-section.tsx` | zbalené posledné faktúry |
| `kros_dashboard_collapsed_recent_expenses` | `src/components/recent-expenses-section.tsx` | zbalené posledné výdavky |
| `kros_dashboard_collapsed_expense_vendors` | `src/components/expense-vendors-section.tsx` | zbalení dodávatelia |
| *(granularita)* | `globalThis.__krosDashboardGranularity` | **nepersistuje sa vôbec** — prežije prechod medzi stránkami, nie F5 |

Granularita je zvláštny prípad: dnes žije v globálnej premennej, takže sa stráca pri
každom reloade aj na tom istom zariadení. Je to najlacnejší viditeľný zisk celej úlohy.

### Skupina B — čo cestovať NESMIE

| kľúč | prečo nie |
|---|---|
| IndexedDB `kros_dashboard_cache`, `kros_dashboard_expenses_cache`, `kros_dashboard_cashflow_cache` | lokálna kópia dát z KROS API, desiatky MB, každé zariadenie si ju natiahne samo |
| `kros_dashboard_last_sync_at` | *„kedy toto zariadenie naposledy sťahovalo"* — po synchronizácii by telefón tvrdil, že má dáta, ktoré nikdy nestiahol |
| `kros_dashboard_pending_state` | jednorazový CSRF `state` pre KROS consent, žije sekundy |

Toto nie je detail: naliať skupinu B do serverového úložiska je najbežnejší spôsob, ako
sa z „pamätaj si filtre" stane pomalá appka s rozbitou cache.

### Skupina C — KROS pripojenia (`kros_dashboard_connections`)

`src/lib/kros-storage.ts` drží v `localStorage` zoznam firiem **aj s KROS OAuth tokenmi**;
klient ich posiela v tele requestu do `/api/kros/*`.

**Toto je skutočná prekážka cross-device zážitku.** Aj keby sa filtre prenášali dokonale,
človek sa prihlási na telefóne, uvidí prázdny dashboard a obrazovku „Prepojiť s KROS" —
a povie, že sa nič neprenieslo. Filtre a pripojenia sú z pohľadu používateľa jedna vec,
z pohľadu bezpečnosti dve úplne rôzne (pozri „Fáza 2" nižšie).

### Čo už máme a čo z toho platí

- `sub` v session (`src/lib/sso-claims.ts`) — stabilná referencia na človeka v službe.
- `organizationId` a `organizationName` v claimoch — appka prepínač firiem nemá, drží len
  aktívnu organizáciu.
- Middleware je **deny-by-default** (`src/middleware.ts`), takže nová route `/api/preferences`
  je chránená bez toho, aby sa jej ktokoľvek dotkol. Test na to existuje.
- Appka nemá databázu ani Redis a beží **v presne jednej replike** (`docs/SSO-prechod.md`) —
  je to podmienka kvôli deduplikácii obnovy tokenov, nie odporúčanie.

---

## Dve pasce, ktoré rozhodujú viac než výber databázy

### 1. Filtre odkazujú na firmy podľa NÁZVU, nie podľa pripojenia

Vo všetkých troch dashboardoch je vybraná firma reťazec `companyName`. Cashflow to dnes
rieši takto (`src/app/cashflow/page.tsx`):

> *„If the user has a non-empty persisted selection but no name matches current connections,
> sync nothing (do not fall back to loading every firm)."*

Na jednom zariadení je to správne — prázdna obrazovka je lepšia než ticho zobrazené cudzie
čísla. Po synchronizácii je to však bežný stav, nie výnimka: notebook je pripojený na tri
firmy, telefón na jednu, filter si prinesie výber tých troch — a telefón ukáže prázdno bez
vysvetlenia.

**Pravidlo, ktoré musí byť v implementácii:** uložený výber sa aplikuje ako **prienik**
s firmami pripojenými na tomto zariadení; keď je prienik prázdny a výber nie, appka to
**povie** („Uložený filter obsahuje firmy, ktoré na tomto zariadení nie sú pripojené"),
nie ticho ukáže nulu. To isté platí pre štítky — tie sú per firma, takže filter zo
zariadenia s inou firmou obsahuje štítky, ktoré tu neexistujú.

### 2. Blikanie nefiltrovaného obsahu

Filtre sa dnes čítajú v `useEffect` po mounte a stránky sú `"use client"`. Keď sa
načítanie presunie na sieť, medzi prvým paintom a odpoveďou servera človek uvidí
nefiltrovaný dashboard a potom preskok. Preto: **`localStorage` neodchádza.** Zostáva ako
lokálna cache pre okamžitý paint a offline (appka je PWA), server je zdroj pravdy pri
načítaní. Nikdy sa nečaká na sieť pred vykreslením.

---

## Možnosti úložiska

### A. JSON súbor na volume (žiadna nová infraštruktúra)

Jeden súbor per `sub` v perzistentnom adresári, atomický zápis cez `rename`. Appka už
niečo podobné robí pre `runtime-logs/` (`src/lib/kros-logs.ts`).

- **Pre:** nula nových závislostí, nula nových služieb, hotové za deň.
- **Proti:** funguje len pri jednej replike (dnes podmienka, zajtra pasca) a **iba
  s namontovaným volume** — bez neho sa dáta ticho stratia pri každom redeploy. Nikto si
  toho nevšimne týždeň, lebo appka funguje, len „zabúda".
- **Kedy áno:** ak toto má byť rýchly experiment pre pár ľudí a rozhodne sa, že strata
  nastavení pri redeploy je prijateľná.

### B. SQLite na volume

`better-sqlite3` alebo `libsql`; `node:sqlite` neprichádza do úvahy — je od Node 22, appka
beží na Node 20 (`nixpacks.toml`).

- **Pre:** skutočné transakcie a migrácie, dotazovateľné, stále bez ďalšej služby.
- **Proti:** rovnaká pasca s volume ako A; `better-sqlite3` je natívny modul, takže build
  cez nixpacks potrebuje build toolchain — je to presne ten typ veci, ktorá build zhodí až
  na serveri, nie lokálne.

### C. Postgres ako služba (Dokploy/Coolify) — **odporúčané**

Tabuľka `user_preferences`, ovládač `pg` (čistý JS, žiadny natívny build).

- **Pre:** prežije redeploy aj bez toho, aby si niekto spomenul na volume; migrácie sú
  bežná vec; je to **zdieľaný stav**, takže tam raz môže bývať aj zámok pre obnovu
  refresh tokenu (`src/lib/single-flight.ts`), čo je dnes jediný dôvod podmienky „jedna
  replika". Samotný Postgres tú podmienku nezruší, ale je jej predpokladom.
- **Proti:** ďalšia služba na správu a zálohovanie; connection pooling v Next.js sa musí
  urobiť vedome (jeden pool na modul, nie na request).
- **Poznámka:** neodstraňuje podmienku jednej repliky sám o sebe — to je samostatná úloha.

### D. Preferencie v `authentication_service`

Služba dostane generické per-app úložisko kľúč/hodnota (`GET/PUT /api/apps/{app}/preferences`).

- **Pre:** jedno miesto pre všetky appky (`prehlady`, `payment_connector`, ďalšie),
  nastavenia prežijú aj kompletné prestavanie dashboardu, appka nedostane databázu.
- **Proti:** zmena v druhom repozitári a v jeho release cykle; výpadok služby prestane byť
  „nedá sa prihlásiť" a stane sa aj „nefungujú filtre"; a hlavne — ide **proti rozhodnutiu
  z fázy SSO**, že služba vlastní identitu a appka business dáta. Filtre štítkov a firiem
  sú business dáta dashboardu, nie vlastnosť konta.
- **Kedy áno:** ak sa už teraz vie, že rovnaké nastavenia bude chcieť viac appiek.

### Zamietnuté

- **Cookie** — limit ~4 kB na všetky cookies domény spolu, a hlavne je per zariadenie.
  Rieši presne to, čo `localStorage` rieši dnes.
- **Len `localStorage` + export/import** — človek prenáša nastavenia ručne; to nie je
  „zapamätané".
- **Externá služba (Upstash, Supabase)** — dáta o firmách a štítkoch zákazníka mimo našej
  infraštruktúry, kvôli pár kilobajtom preferencií.

---

## Odporúčanie

**C (Postgres) pre úložisko, `localStorage` ostáva ako cache, prienik s pripojeniami ako
pravidlo zobrazenia.** Dôvod pre C proti lacnejším A/B nie je výkon ani škálovanie — je to
tichosť zlyhania: zabudnutý volume nespôsobí chybu, len postupné zabúdanie nastavení, čo je
najhoršie hlásenie chyby, aké môže prísť. Ak sa rozhodne, že ďalšia služba za to nestojí,
**B je prijateľný kompromis, A nie** (v A je zápis súboru bez transakcie a bez migrácií
vec, ktorú aj tak raz prepíšeme).

---

## Dátový model (pre variantu C)

```sql
create table user_preferences (
  user_sub    text        not null,
  scope       text        not null,  -- organizationId, alebo '_' keď claim chýba
  key         text        not null,  -- napr. 'revenue.companies'
  value       jsonb       not null,
  updated_at  timestamptz not null default now(),
  primary key (user_sub, scope, key)
);
```

**Prečo per kľúč a nie jeden dokument:** dva riadky namiesto jedného JSON blobu znamenajú,
že keď telefón uloží filter firiem a notebook o pár sekúnd filter štítkov, prežijú oba.
Pri jednom dokumente druhý zápis prepíše prvý celý — a je to presne tá strata, ktorú
človek nikdy nenahlási ako chybu, len prestane veriť, že si to appka pamätá.

**Prečo `scope` = organizácia:** filtre odkazujú na firmy a štítky, ktoré patria
organizácii. Keď človek patrí do dvoch, filtre jednej nemajú čo robiť v druhej. Keď claim
chýba, `'_'` je neutrálny scope.

**Čo sa NIKDY neukladá:** čokoľvek zo skupiny B, a žiadne tokeny (tie sú vlastná fáza).

---

## Tok

**Načítanie**
1. Stránka sa vykreslí okamžite z `localStorage` (dnešné správanie, bez zmeny).
2. Paralelne `GET /api/preferences` → server vráti hodnoty pre `sub` + `scope`.
3. Novšia hodnota (`updated_at` per kľúč) vyhrá, stav sa prepíše, `localStorage` sa dorovná.
4. Keď server nedostupný → ostáva lokálny stav. Offline appka funguje ďalej.

**Zápis**
1. Zmena filtra ide do stavu a do `localStorage` okamžite (žiadne čakanie na sieť).
2. `PATCH /api/preferences` s debounce ~800 ms, telo je len zmenené kľúče.
3. Zlyhanie zápisu sa nezobrazuje ako chyba — hodnota ostáva lokálne a pošle sa pri ďalšej
   zmene alebo pri ďalšom načítaní stránky.

**Konflikt** — last-write-wins per kľúč podľa `updated_at`. Filtre nemajú zlučovaciu
sémantiku (výber firiem nie je množina, ktorú má zmysel zjednocovať) a dve zariadenia toho
istého človeka nemenia to isté v tej istej sekunde. Zložitejšie (CRDT, revízie
s odmietnutím) by tu bola technika bez úžitku.

**Migrácia z `localStorage`** — pri prvom načítaní po nasadení: ak server pre daný kľúč nemá
nič a lokálne niečo je, lokálna hodnota sa nahrá. Dnešné nastavenia sa teda neztratia
a nikto nemusí nič robiť ručne. Jednorazovo, označené príznakom, aby vymazaný filter
nevstal z mŕtvych.

---

## Bezpečnosť

- **`sub` sa berie VÝHRADNE zo session, nikdy z tela requestu ani z query.** Toto je jediné
  pravidlo, ktorého porušenie z „pamätaj si filtre" spraví čítanie cudzích nastavení.
- Route `/api/preferences` je chránená automaticky (deny-by-default middleware), ale test na
  „bez session → 401" tam patrí explicitne, lebo je to prvý endpoint appky s per-user dátami.
- Nastavenia obsahujú **názvy firiem a štítkov zákazníka** — teda business metadáta. Nepatria
  do logov (`src/lib/kros-logs.ts` loguje telá odpovedí pri chybách; preferencie doň nesmú).
- Zmazanie konta v službe dnes appku nijako neinformuje, takže riadky by po zrušenom človeku
  ostali. Otvorená otázka nižšie.

---

## Testy

Podľa pravidla z fázy SSO — každá asercia typu „X sa stalo" sa dokazuje mutáciou.

- **čisté funkcie:** zlúčenie serverového a lokálneho stavu (novší vyhrá per kľúč);
  jednorazová migrácia z `localStorage`; prienik uloženého výberu firiem s pripojeniami —
  vrátane prípadu „výber neprázdny, prienik prázdny" → hlásenie, nie ticho nula.
- **route handler:** bez session 401; `sub` z tela requestu sa **ignoruje**; zápis cudzieho
  `sub` nie je možný.
- **regresia:** nová route je chránená bez zásahu do `middleware.ts` (test už existuje).

---

## Fázovanie

**Fáza 1 — nastavenia (tento návrh).** Skupina A, plus granularita, ktorá sa dnes
nepersistuje vôbec. Žiadne tokeny, žiadne cache.

**Fáza 2 — KROS pripojenia (samostatné rozhodnutie).** Presun `kros_dashboard_connections`
do serverového úložiska by znamenal, že sa človek na novom zariadení prihlási a **rovno
vidí dáta**. Znamená to však, že server drží KROS refresh tokeny zákazníka: šifrovanie
v pokoji vlastným kľúčom, rotácia, odvolanie pri odhlásení, a rozhodnutie, či sú viazané na
`sub` alebo na organizáciu (dnes je pripojenie fakticky organizačné, nie osobné — čo je
argument, že by ho nemal „vlastniť" ten, kto ho prvý klikol). To je vlastný návrh, nie
odsek v tomto.

---

## Mimo rozsahu

- Zrušenie podmienky jednej repliky (potrebuje zdieľaný zámok pre obnovu tokenov, nielen
  zdieľané úložisko).
- Synchronizácia cache dokladov medzi zariadeniami.
- Zdieľanie nastavení medzi ľuďmi v tej istej organizácii („firemný default filter").
- Prepínač organizácií v appke.

---

## Otvorené otázky

1. **Úložisko:** Postgres ako služba (C), SQLite na volume (B), alebo preferencie
   v `authentication_service` (D)?
2. **Pripojenia na KROS:** má cross-device zážitok zahŕňať aj ne (fáza 2), alebo ostáva
   „na novom zariadení sa raz prepojíš"?
3. **Scope:** viazať nastavenia na `sub` + organizáciu, alebo len na `sub`?
4. **Zmazanie konta:** má služba appke oznámiť zrušenie konta (webhook), alebo stačí
   pravidlo „riadky bez aktivity 12 mesiacov sa mažú"?
