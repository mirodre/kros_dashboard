# Nastavenia a dáta viazané na používateľa naprieč zariadeniami — návrh

**Cieľ:** čo si človek v appke nastaví (filtre firiem, filtre štítkov, zbalené sekcie,
granularita) ho má nasledovať na iné zariadenie len na základe toho, že je prihlásený tým
istým kontom. Rozhodnutím z 3.9.2026 k tomu pribudlo aj **prepojenie s KROS** a **doklady
načítané z KROS API**, ktoré sú dnes tiež per zariadenie a sú hlavným dôvodom, prečo je
prvé načítanie pomalé.

**Nadväzuje na:** fázu SSO
(`docs/superpowers/specs/2026-09-02-kros-dashboard-sso-klient-design.md`), ktorá túto úlohu
výslovne odložila: *„databáza, ktorá príde s filtrami, je na business dáta, nie na identitu.
Kľúčuje sa `sub`-om zo `/api/me`."*

**Stav dokumentu:** návrh po prvom kole rozhodnutí. Implementačný plán vznikne samostatne,
po odsúhlasení tohto.

---

## Rozhodnutia z 3.9.2026

| otázka | rozhodnutie |
|---|---|
| úložisko | **Postgres ako služba** — nie súbor ani SQLite (zdôvodnenie nižšie, po informácii o dokladoch je to jediná rozumná možnosť) |
| KROS pripojenia | **áno, presúvajú sa na server** — človek sa na novom zariadení prihlási a rovno vidí dáta |
| doklady z KROS API | **áno, na server** — dnešná pomalosť je následok toho, že si ich sťahuje každé zariadenie zvlášť |
| kľúčovanie nastavení | **na používateľa (`sub`)**, nie na organizáciu — pozri „Scope" nižšie |

---

## Východisko

Appka nemá žiadne serverové úložisko. Všetko, čo si pamätá, je v prehliadači, teda per
zariadenie a per profil prehliadača.

### Skupina A — nastavenia, ktoré majú cestovať za používateľom

| kľúč | kde vzniká | obsah |
|---|---|---|
| `kros_dashboard_selected_tags` | `src/app/page.tsx:51` | filtre štítkov podľa kategórií (Príjmy) |
| `kros_dashboard_revenue_selected_companies` | `src/app/page.tsx:52` | vybrané firmy (Príjmy) |
| `kros_dashboard_expenses_selected_tags` | `src/app/expenses/page.tsx:50` | filtre štítkov (Výdavky) |
| `kros_dashboard_expenses_selected_companies` | `src/app/expenses/page.tsx:51` | vybrané firmy (Výdavky) |
| `kros_dashboard_cashflow_selected_companies` | `src/app/cashflow/page.tsx:32` | vybrané firmy (Cashflow) |
| `kros_dashboard_collapsed_tag_categories` | `src/components/categorized-tags-dashboard.tsx:15` | zbalené kategórie štítkov |
| `kros_dashboard_collapsed_companies` | `src/components/companies-dashboard.tsx:30` | zbalený panel firiem |
| `kros_dashboard_expenses_collapsed_companies` | `src/app/expenses/page.tsx:691` | to isté vo Výdavkoch |
| `kros_dashboard_collapsed_recent_invoices` | `src/components/recent-invoices-section.tsx:15` | zbalené posledné faktúry |
| `kros_dashboard_collapsed_recent_expenses` | `src/components/recent-expenses-section.tsx:98` | zbalené posledné výdavky |
| `kros_dashboard_collapsed_expense_vendors` | `src/components/expense-vendors-section.tsx:14` | zbalení dodávatelia |
| *(granularita)* | `globalThis.__krosDashboardGranularity` | **nepersistuje sa vôbec** — prežije prechod medzi stránkami, nie F5 |

Granularita je zvláštny prípad: dnes žije v globálnej premennej, takže sa stráca pri každom
reloade aj na tom istom zariadení. Je to najlacnejší viditeľný zisk celej úlohy.

### Skupina B — čo cestovať nesmie ani po presune dát na server

| kľúč | prečo |
|---|---|
| `kros_dashboard_last_sync_at` | *„kedy TOTO zariadenie naposledy sťahovalo"* — po presune sťahovania na server tento údaj stráca zmysel a nahradí ho serverový `synced_at` per firma |
| `kros_dashboard_pending_state` | jednorazový CSRF `state` pre KROS consent, žije sekundy |
| IndexedDB `kros_dashboard_cache`, `..._expenses_cache`, `..._cashflow_cache` | lokálna kópia dokladov; po presune na server sa zmenšuje na offline cache posledných odpovedí (pozri „Cieľový tvar") |

### Skupina C — KROS pripojenia (`kros_dashboard_connections`)

`src/lib/kros-storage.ts` drží v `localStorage` zoznam firiem **aj s KROS OAuth tokenmi**;
klient ich posiela v tele requestu do `/api/kros/*`. Rozhodnuté: presúva sa na server.
Je to zároveň **technický predpoklad** serverového sťahovania dokladov — bez tokenov na
serveri nemá čo sťahovať, keď má človek zavretý prehliadač.

### Čo už máme

- `sub` v session (`src/lib/sso-claims.ts`) — stabilná referencia na človeka v službe.
- Middleware je **deny-by-default** (`src/middleware.ts`), takže nové routy sú chránené bez
  toho, aby sa ich niekto dotkol. Test na to existuje.
- Appka beží **v presne jednej replike** (`docs/SSO-prechod.md`) — podmienka kvôli
  deduplikácii obnovy tokenov. Pre plánovaný sync je to zhodou okolností výhoda: jeden
  proces = jeden plánovač, žiadne súbežné sťahovanie tej istej firmy.

---

## Prečo je to dnes pomalé

Nie je to výkon appky, je to tvar sťahovania. `src/app/page.tsx` zostavuje plán krokov —
**pre každú firmu a každý mesiac jeden request** do `/api/kros/invoices`, ktorý je relay do
`api-economy.kros.sk` — a výsledok ukladá do IndexedDB. Dôsledky:

- Každé zariadenie prejde ten istý beh **od nuly**. Nový telefón = celá história znova.
- Prehliadač musí byť otvorený, inak sa nesťahuje nič; človek teda čaká práve vtedy, keď sa
  pozerá.
- Filtrovanie a agregácia bežia nad všetkými dokladmi v pamäti prehliadača.
- Verzia cache sa zvýši (`DB_VERSION`, dnes 3) → **všetkým sa premaže celá história** a
  sťahuje sa nanovo, na každom zariadení zvlášť.

Uloženie dokladov na server nie je „ďalšia vec, ktorú by sa hodilo mať". Je to jediná
zmena, ktorá tú pomalosť odstráni namiesto zamaskovania.

---

## Čo to znamená pre výber úložiska

Pôvodne bolo vo hre aj *JSON súbor na volume* a *SQLite na volume* (lacné, bez novej služby).
Informácia „chcem tam aj doklady" ich odstraňuje:

- **JSON súbor** — pár kilobajtov preferencií uniesie, státisíce riadkov dokladov s
  inkrementálnym sync-om a agregáciami nie. Netreba o tom diskutovať.
- **SQLite** — technicky by to zvládol, ale: `better-sqlite3` je natívny modul (build cez
  nixpacks je riziko, ktoré padne až na serveri), celé to visí na namontovanom volume, a
  **zabudnutý volume nespôsobí chybu — len tiché miznutie dát po redeploy**. Pri
  preferenciách je to nepríjemné, pri dokladoch je to strata celej histórie a nový niekoľko-
  minútový sync z KROS API.
- **Preferencie v `authentication_service`** — na nastavenia by to šlo, na doklady zákazníka
  v žiadnom prípade; a viedlo by to k dvom úložiskám pre jednu appku.

**Postgres** je teda odporúčanie: ovládač `pg` je čistý JS (žiadny natívny build), migrácie
sú bežná vec, agregácie `group by` s indexom robia presne to, čo dnes robí prehliadač nad
celým poľom, a dáta prežijú redeploy bez toho, aby si niekto musel spomenúť na volume.
Zálohy Postgresu sú vyriešená úloha; zálohy volume s SQLite súborom nie sú.

---

## Cieľový tvar

**Dnes:** prehliadač → relay `/api/kros/*` → KROS API → IndexedDB → agregácia v prehliadači.

**Cieľ:** server → KROS API → Postgres; prehliadač si pýta **agregáty**, nie doklady.

1. **Sync beží na serveri**, nie v prehliadači:
   - na požiadanie (pull-to-refresh v `DashboardShell` → `POST /api/sync`),
   - plánovane (jedna replika = jeden `setInterval`, alebo externý cron ping na chránený
     endpoint s tajomstvom — rozhodne sa v pláne).
   - Inkrementálne rovnako ako dnes, cez `lastModifiedTimestamp` per firma. Logika už
     existuje v `src/app/page.tsx`, len sa presťahuje na server, kde beží raz pre všetkých.
2. **Klient pýta agregáty:** `GET /api/analytics/revenue?granularity=month&…` vráti body
   grafu, KPI a breakdown ako pár kilobajtov namiesto megabajtov dokladov. Posledné faktúry
   sú `order by delivery_date desc limit 50`, nie filtrovanie celej histórie v pamäti.
3. **IndexedDB cache sa zmenší** na offline cache posledných odpovedí (appka je PWA), alebo
   zmizne. Prestáva byť zdrojom pravdy, takže `DB_VERSION` prestane byť udalosťou.
4. **Nový telefón:** prihlásenie → firmy sú pripojené (server) → agregáty prídu hneď.
   Žiadne prepájanie, žiadny prvý sync.

**Prechod:** dnešná klientska cesta ostáva funkčná, kým sa serverová nedokončí — appka
použije serverové dáta pre firmu, ktorú server už má nasyncovanú, inak spadne na dnešné
správanie. Nasadenie tak nie je jeden veľký prepínač.

---

## Dátový model (návrh)

```sql
-- 1. Nastavenia (fáza 1)
create table user_preference (
  user_sub   text        not null,
  key        text        not null,           -- 'revenue.companies', 'ui.granularity', …
  value      jsonb       not null,
  updated_at timestamptz not null default now(),
  primary key (user_sub, key)
);

-- 2. Pripojenie firmy + prístup k nej (fáza 2)
create table kros_connection (
  company_id       bigint      primary key,   -- id firmy v KROS
  company_name      text        not null,
  refresh_token_enc bytea       not null,      -- AES-256-GCM, kľúč z env
  access_token_enc  bytea,
  token_expires_at  timestamptz,
  synced_at         timestamptz,
  last_modified_ts  text                       -- kurzor inkrementálneho syncu
);

create table company_access (
  user_sub     text        not null,
  company_id   bigint      not null references kros_connection(company_id) on delete cascade,
  connected_at timestamptz not null default now(),
  primary key (user_sub, company_id)
);

-- 3. Doklady (fáza 3) — analogicky expense, payment, tag
create table invoice (
  company_id    bigint      not null references kros_connection(company_id) on delete cascade,
  external_id   text        not null,
  delivery_date date        not null,
  total         numeric(14,2) not null,
  currency      text        not null,
  customer_name text,
  tags          text[]      not null default '{}',
  last_modified timestamptz,
  primary key (company_id, external_id)
);
create index on invoice (company_id, delivery_date);
```

**Prečo `user_preference` per kľúč a nie jeden JSON dokument:** keď telefón uloží filter
firiem a notebook o pár sekúnd filter štítkov, prežijú oba. Pri jednom dokumente druhý zápis
prepíše prvý celý — a je to presne tá strata, ktorú človek nikdy nenahlási ako chybu, len
prestane veriť, že si to appka pamätá.

**Prečo je prístup k firme vlastná tabuľka:** pripojenie na firmu je fakticky organizačné,
nie osobné. Keď tú istú firmu pripoja dvaja ľudia, doklady sa sťahujú **raz** a obaja ich
vidia; odpojenie jedného nesmie zmazať dáta druhému. Každý dotaz na doklady preto vždy
filtruje `company_id in (select company_id from company_access where user_sub = :sub)` —
bez výnimky.

### Scope: prečo len `sub` (a v čom bola otázka nedorozumením)

Obava, že kľúčovanie na organizáciu rozbije prípad „jeden používateľ, viac firiem", je
založená na dvoch rôznych veciach s podobným menom:

- `organizationId` v claimoch je **organizácia v `authentication_service`** (konto v systéme
  prihlásenia),
- **firmy v KROS** sú pripojenia (`company_id`), s tým nemajú nič spoločné.

Kľúčovanie na organizáciu by teda „viac firiem pod jedným človekom" nerozbilo. Napriek tomu
je rozhodnutie **`sub` samotný správne**: appka dnes prepínač organizácií nemá a v claimoch
drží len aktívnu, takže scope by bol stĺpec, ktorý nikto nečíta. Ak raz prepínač pribudne,
pridá sa stĺpec `scope` s defaultom `'_'` — a to je jednoduchá migrácia, nie prestavba.

---

## Tok nastavení (fáza 1)

**Načítanie**
1. Stránka sa vykreslí okamžite z `localStorage` (dnešné správanie, bez zmeny).
2. Paralelne `GET /api/preferences` → hodnoty pre `sub` zo session.
3. Novšia hodnota per kľúč (`updated_at`) vyhrá, stav sa prepíše, `localStorage` sa dorovná.
4. Server nedostupný → ostáva lokálny stav; appka funguje offline ďalej.

**Zápis**
1. Zmena ide do stavu a do `localStorage` okamžite — nikdy sa nečaká na sieť pred paintom.
2. `PATCH /api/preferences` s debounce ~800 ms, telo je len zmenené kľúče.
3. Zlyhanie zápisu sa nezobrazuje ako chyba; hodnota ostáva lokálne a odošle sa pri ďalšej
   zmene alebo pri ďalšom načítaní.

**Konflikt** — last-write-wins per kľúč. Filtre nemajú zlučovaciu sémantiku a dve zariadenia
toho istého človeka nemenia to isté v tej istej sekunde; CRDT by tu bola technika bez úžitku.

**Migrácia z `localStorage`** — pri prvom načítaní po nasadení: ak server pre kľúč nemá nič
a lokálne niečo je, lokálna hodnota sa nahrá. Jednorazovo, označené príznakom, aby zmazaný
filter nevstal z mŕtvych. Nikto nemusí nič nastavovať znova.

### Pasca, ktorá prežije aj presun dokladov na server

Filtre odkazujú na firmy podľa **názvu** (`companyName`), nie podľa `company_id`. Cashflow
dnes robí toto: *„ak je uložený výber neprázdny a žiadny názov nesedí s pripojeniami,
nesťahuj nič"* — na jednom zariadení správne, po synchronizácii bežný stav. Kým sú
pripojenia per zariadenie (teda do konca fázy 2), platí: uložený výber sa aplikuje ako
**prienik** s dostupnými firmami a keď je prienik prázdny a výber nie, appka to **povie**,
nie ticho ukáže nulu. Po fáze 2 je zoznam firiem rovnaký všade, ale pravidlo ostáva ako
poistka a filtre sa pri tej príležitosti prekľúčujú na `company_id`.

---

## Bezpečnosť

- **`sub` sa berie výhradne zo session, nikdy z tela requestu ani z query.** Porušenie tohto
  jediného pravidla mení „pamätaj si filtre" na čítanie cudzích nastavení a cudzích dokladov.
- Nové routy sú chránené deny-by-default middlewarom, ale test „bez session → 401" tam patrí
  explicitne — sú to prvé endpointy appky s per-user dátami.
- **KROS tokeny na serveri:** AES-256-GCM, kľúč z env (`KROS_TOKEN_KEY`, `openssl rand -base64 32`),
  vlastné IV per riadok, tokeny nikdy do logov. `src/lib/kros-logs.ts` dnes pri chybách loguje
  telá odpovedí — musí byť overené, že sa tam token nedostane. Odpojenie firmy token odvolá
  v KROS, nielen zmaže riadok.
- **Zmena triedy incidentu:** dnes ležia doklady zákazníka v jeho prehliadači; po tejto zmene
  ležia v našej databáze. Únik DB prestáva byť únikom metadát a stáva sa únikom účtovných dát.
  Vyžaduje si to zálohy so šifrovaním, obmedzený prístup k DB a vedomé prijatie rizika — to je
  cena za rýchlosť a cross-device, nie vedľajší efekt.
- Zmazanie konta v službe appku nijako neinformuje, takže riadky po zrušenom človeku ostanú.
  Otvorená otázka nižšie.

---

## Testy

Podľa pravidla z fázy SSO — každá asercia typu „X sa stalo" sa dokazuje mutáciou.

- **čisté funkcie:** zlúčenie serverového a lokálneho stavu (novší vyhrá per kľúč);
  jednorazová migrácia z `localStorage`; prienik uloženého výberu firiem s dostupnými;
  plánovač inkrementálneho syncu (z ktorého kurzora sa pokračuje).
- **route handlery:** bez session 401; `sub` z tela requestu sa ignoruje; dotaz nevráti
  doklady firmy, ku ktorej používateľ nemá riadok v `company_access` — toto je najdôležitejší
  test celej úlohy.
- **šifrovanie tokenov:** zašifruj → dešifruj → rovnaká hodnota; iný kľúč → zlyhá, nie ticho
  prázdny reťazec.
- **regresia:** nová route je chránená bez zásahu do `middleware.ts` (test už existuje).

---

## Fázovanie

**Fáza 1 — Postgres + nastavenia.** Služba, migrácie, `user_preference`,
`GET/PATCH /api/preferences`, migrácia z `localStorage`, granularita sa začne pamätať.
Malá, samostatne nasaditeľná, a postaví infraštruktúru pre zvyšok.

**Fáza 2 — pripojenia na server.** `kros_connection` + `company_access`, šifrované tokeny,
`/api/kros/*` prestane brať pripojenia z tela requestu a vezme si ich z DB podľa session.
Tu vzniká skutočný cross-device zážitok: prihlásim sa na telefóne a firmy tam sú.

**Fáza 3 — doklady na serveri.** Serverový sync (na požiadanie + plánovaný), tabuľky
dokladov, agregačné endpointy, prepnutie dashboardov na ne a scvrknutie IndexedDB cache.
Toto je fáza, ktorá odstraňuje pomalosť.

Poradie nie je voliteľné: fáza 3 potrebuje tokeny na serveri, teda fázu 2.

---

## Mimo rozsahu

- Zrušenie podmienky jednej repliky (potrebuje zdieľaný zámok pre obnovu tokenov —
  `src/lib/single-flight.ts` — nielen zdieľané úložisko; Postgres advisory lock je kandidát).
- Zdieľanie nastavení medzi ľuďmi v tej istej firme („firemný default filter").
- Prepínač organizácií v appke.
- Prepis KPI a grafov — agregačné endpointy vracajú rovnaké tvary, aké dnes počítajú funkcie
  v `src/lib/dashboard-live.ts`.

---

## Otvorené otázky

1. **Plánovaný sync:** interný `setInterval` v jedinej replike (nulová infraštruktúra, spí
   s appkou) alebo externý cron ping na chránený endpoint (viditeľný, monitorovateľný)?
   A ako často — každých 15 minút, hodinu?
2. **Retencia dokladov:** držať celú históriu, ktorú KROS vydá, alebo strop (napr. 3 roky)?
   Ovplyvní veľkosť DB a čas prvého syncu.
3. **Zmazanie konta:** má služba appke oznámiť zrušenie konta (webhook), alebo stačí pravidlo
   „nastavenia bez aktivity 12 mesiacov sa mažú"?
4. **Odpojenie poslednej firmy:** keď firmu odpojí posledný človek, ktorý k nej mal prístup —
   zmazať jej doklady hneď, alebo ich nechať X dní pre prípad omylu?
