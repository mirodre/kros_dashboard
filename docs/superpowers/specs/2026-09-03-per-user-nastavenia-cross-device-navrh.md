# Nastavenia a prepojenia viazané na používateľa naprieč zariadeniami — návrh

**Cieľ:** čo si človek v appke nastaví (filtre firiem, filtre štítkov, zbalené sekcie,
granularita) a s ktorými firmami je prepojený ho má nasledovať na iné zariadenie len na
základe toho, že je prihlásený tým istým kontom.

**Rozsah:** filtre a prepojenia. **Doklady z KROS API sa na server neukladajú** — zostávajú
tam, kde sú dnes, teda v IndexedDB každého zariadenia. Rozhodnutie z 3.9.2026: raz to príde,
ale nie teraz. Výber technológie s tým **ráta** (pozri „Prečo Postgres, keď dnes ukladáme
kilobajty") a dátový model je postavený tak, aby sa doklady dali pridať bez jeho prestavby.

**Nadväzuje na:** fázu SSO
(`docs/superpowers/specs/2026-09-02-kros-dashboard-sso-klient-design.md`), ktorá túto úlohu
výslovne odložila: *„databáza, ktorá príde s filtrami, je na business dáta, nie na identitu.
Kľúčuje sa `sub`-om zo `/api/me`."*

**Stav dokumentu:** návrh po rozhodnutiach z 3.9.2026. Implementačný plán vznikne samostatne.

---

## Rozhodnutia z 3.9.2026

| otázka | rozhodnutie |
|---|---|
| úložisko | **Postgres ako služba** — nie súbor ani SQLite |
| filtre a nastavenia | **áno**, fáza 1 |
| KROS prepojenia | **áno**, fáza 2 — na novom zariadení sa už s KROS neprepája |
| doklady z KROS API | **nie teraz**; model s nimi ráta, aby sa neskôr len pridali |
| kľúčovanie | **na používateľa (`sub`)**, bez organizácie |

---

## Východisko

Appka nemá žiadne serverové úložisko. Všetko, čo si pamätá, je v prehliadači, teda per
zariadenie a per profil prehliadača.

### Skupina A — nastavenia, ktoré majú cestovať za používateľom (fáza 1)

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

### Skupina B — čo zostáva v prehliadači

| kľúč | prečo |
|---|---|
| IndexedDB `kros_dashboard_cache`, `..._expenses_cache`, `..._cashflow_cache` | doklady; mimo rozsahu tejto úlohy, každé zariadenie si ich sťahuje samo ako dnes |
| `kros_dashboard_last_sync_at` | *„kedy TOTO zariadenie naposledy sťahovalo"* — kým sťahuje prehliadač, je to údaj o zariadení a synchronizovať ho by znamenalo klamať |
| `kros_dashboard_pending_state` | jednorazový CSRF `state`, žije sekundy; po fáze 2 zaniká úplne (pozri nižšie) |

### Skupina C — KROS prepojenia (`kros_dashboard_connections`, fáza 2)

`src/lib/kros-storage.ts` drží v `localStorage` zoznam firiem **aj s KROS tokenmi**
(`KrosConnection = { companyId, companyName, token, webhookSecret?, connectedAt }`) a klient
ich posiela v tele každého requestu do `/api/kros/*`.

---

## Prečo Postgres, keď dnes ukladáme kilobajty

Objem dát tejto úlohy by unesol aj JSON súbor. Rozhodujú tri iné veci:

1. **Doklady raz prídu.** Prechod zo SQLite alebo súboru na Postgres by prišiel presne vtedy,
   keď úložisko už bude niesť tokeny a reálne nastavenia — teda v najhoršej možnej chvíli.
   Ovládač `pg` je čistý JS (žiadny natívny build, na rozdiel od `better-sqlite3`, ktoré vie
   zhodiť build cez nixpacks až na serveri).
2. **Volume, ktorý nikto nezálohuje, je pasca.** Súbor aj SQLite žijú a zomierajú s
   namontovaným volume, a zabudnutý volume **nespôsobí chybu** — appka funguje, len po
   redeploy „zabudne". Pri filtroch je to nepríjemné. Po fáze 2 to znamená, že **všetci sa
   musia znova prepojiť s KROS**, a to je presne to zlyhanie, ktoré má táto úloha odstrániť.
   Zálohy Postgresu sú vyriešená úloha; zálohy volume so SQLite súborom nie sú.
3. **Zdieľaný stav sa raz zíde aj inde.** Podmienka „jedna replika"
   (`docs/SSO-prechod.md`) stojí na tom, že deduplikácia obnovy tokenov žije v pamäti procesu
   (`src/lib/single-flight.ts`). Postgres advisory lock je kandidát, ako ju raz zrušiť. Sám
   o sebe ju nezruší — je to samostatná úloha, nie vedľajší efekt tejto.

**Cena:** jedna služba navyše v Dokploy, jej zálohovanie, a connection pool ako singleton
cez `globalThis` (inak ho hot reload v dev režime vyrobí pri každej zmene znova).

---

## Dátový model

```sql
-- Fáza 1
create table user_preference (
  user_sub   text        not null,
  key        text        not null,           -- 'revenue.companies', 'ui.granularity', …
  value      jsonb       not null,
  updated_at timestamptz not null default now(),
  primary key (user_sub, key)
);

-- Fáza 2
create table kros_connection (
  user_sub          text        not null,
  company_id        bigint      not null,
  company_name      text        not null,
  token_enc         bytea       not null,   -- AES-256-GCM
  webhook_secret_enc bytea,
  connected_at      timestamptz not null default now(),
  primary key (user_sub, company_id)
);

-- Fáza 2 — nahrádza runtime-logs/oauth-pending-states.json
create table kros_oauth_state (
  state      text        primary key,
  user_sub   text        not null,
  expires_at timestamptz not null
);
```

**Prečo `user_preference` per kľúč a nie jeden JSON dokument:** keď telefón uloží filter firiem
a notebook o pár sekúnd filter štítkov, prežijú oba. Pri jednom dokumente druhý zápis prepíše
prvý celý — a je to presne tá strata, ktorú človek nikdy nenahlási ako chybu, len prestane
veriť, že si to appka pamätá.

**Prečo je prepojenie kľúčované `(user_sub, company_id)` a nie len firmou:** KROS token vzniká
z konkrétneho súhlasu konkrétneho človeka. Keď tú istú firmu pripoja dvaja ľudia, sú to dva
súhlasy a dva tokeny; jeden riadok na firmu by znamenal, že sa navzájom prepisujú a odvolanie
súhlasu jedného odstrihne druhého. Až doklady (raz) budú per `company_id` a prístup k nim sa
odvodí z existencie prepojenia — model sa vtedy **rozšíri, neprestaví**.

**Scope: prečo len `sub`.** Obava, že kľúčovanie na organizáciu rozbije prípad „jeden človek,
viac firiem", stojí na dvoch veciach s podobným menom: `organizationId` v claimoch je
organizácia v `authentication_service` (konto v prihlásení), zatiaľ čo firmy v KROS sú
prepojenia (`company_id`) — s organizáciou nesúvisia. Rozhodnutie viazať nastavenia len na
`sub` je aj tak správne, len z iného dôvodu: appka prepínač organizácií nemá, takže by to bol
stĺpec, ktorý nikto nečíta. Ak raz pribudne, je to pridanie stĺpca, nie prestavba.

---

## Fáza 1 — nastavenia

**Načítanie**
1. Stránka sa vykreslí okamžite z `localStorage` (dnešné správanie, bez zmeny).
2. Paralelne `GET /api/preferences` → hodnoty pre `sub` zo session.
3. Novšia hodnota per kľúč (`updated_at`) vyhrá, stav sa prepíše, `localStorage` sa dorovná.
4. Server nedostupný → ostáva lokálny stav; appka funguje offline ďalej (je to PWA).

**`localStorage` teda neodchádza.** Filtre sa dnes čítajú v `useEffect` po mounte a stránky sú
`"use client"`; keby sa načítanie presunulo výhradne na sieť, medzi prvým paintom a odpoveďou
by človek videl nefiltrovaný dashboard a potom preskok. Lokálna kópia je cache pre okamžitý
paint, server je zdroj pravdy.

**Zápis**
1. Zmena ide do stavu a do `localStorage` okamžite — nikdy sa nečaká na sieť pred paintom.
2. `PATCH /api/preferences` s debounce ~800 ms, telo je len zmenené kľúče.
3. Zlyhanie zápisu nie je chybová hláška; hodnota ostáva lokálne a odošle sa pri ďalšej zmene
   alebo pri ďalšom načítaní stránky.

**Konflikt** — last-write-wins per kľúč. Filtre nemajú zlučovaciu sémantiku a dve zariadenia
toho istého človeka nemenia to isté v tej istej sekunde; CRDT by tu bola technika bez úžitku.

**Migrácia z `localStorage`** — pri prvom načítaní po nasadení: ak server pre kľúč nemá nič
a lokálne niečo je, lokálna hodnota sa nahrá. Jednorazovo, označené príznakom, aby zmazaný
filter nevstal z mŕtvych. Nikto si nemusí nič nastavovať znova.

### Pasca: filtre odkazujú na firmy podľa názvu

Vo všetkých troch dashboardoch je vybraná firma reťazec `companyName`. Cashflow to dnes rieši
takto: *„ak je uložený výber neprázdny a žiadny názov nesedí s pripojeniami, nesťahuj nič"* —
na jednom zariadení správne, po synchronizácii bežný stav (notebook pripojený na tri firmy,
telefón na jednu). Kým sú prepojenia per zariadenie, teda **celú fázu 1**, platí: uložený výber
sa aplikuje ako **prienik** s dostupnými firmami, a keď je prienik prázdny a výber nie, appka
to **povie** („Uložený filter obsahuje firmy, ktoré na tomto zariadení nie sú prepojené"), nie
ticho ukáže nulu. Po fáze 2 je zoznam firiem rovnaký všade a filtre sa pri tej príležitosti
prekľúčujú na `company_id`; pravidlo o prieniku ostáva ako poistka.

---

## Fáza 2 — prepojenia

Zmena je väčšia než presun jedného poľa do tabuľky, lebo dnešný consent flow je postavený na
tom, že výsledok chytí prehliadač.

### Čo sa mení

1. **`POST /api/kros/oauth-state` si zapíše `user_sub` zo session.** Dnes tam `state`
   zaregistruje ktokoľvek aj bez prihlásenia (riziko pomenované už v spec-e fázy SSO) a ukladá
   sa do `runtime-logs/oauth-pending-states.json` — teda do súboru, ktorý redeploy zmaže.
2. **`/kros/callback` zapíše firmy rovno do DB** namiesto dnešného obchádzania cez
   `sessionStorage` → `/settings` → `localStorage`.
3. **`/api/kros/*` prestane brať tokeny z tela requestu.** Klient pošle `companyId`, server si
   token načíta z DB podľa session. Kým to tak nie je, serverové úložisko je len ozdoba —
   token stále cestuje z prehliadača.
4. **Odpojenie firmy** zmaže riadok a odvolá súhlas v KROS, nielen vyčistí `localStorage`.

### Prečo musí byť `state` viazaný na používateľa už pri registrácii

KROS posiela výsledok ako **cross-site POST** z `firma.kros.sk` na `/kros/callback`. Session
cookie Auth.js je `SameSite=Lax`, a Lax cookie sa pri cross-site POST **neodošle** — callback
teda o prihlásenom človeku nevie nič a zo session ho zistiť nedokáže. Jediná cesta je väzba
`state → user_sub` zapísaná vtedy, keď `state` vzniká, teda v requeste z appky, ktorý session
má. Vedľajší efekt: zmizne dnešná možnosť registrovať `state` anonymne.

Je to presne ten typ detailu, ktorý sa inak zistí až pri prvom prepojení na produkcii, keď
callback zapíše prepojenie „nikomu".

### Čo cross-device zážitok po fáze 2 je a čo nie je

**Je:** prihlásim sa na telefóne a firmy sú prepojené — žiadne klikanie cez KROS consent.
**Nie je:** telefón má prázdnu IndexedDB, takže **prvé načítanie na ňom stále stiahne históriu
dokladov**, request na firmu a mesiac, ako dnes. To odstráni až presun dokladov na server, ktorý
je vedome odložený. Treba to povedať dopredu, inak to po nasadení vyzerá ako nedokončená práca.

---

## Bezpečnosť

- **`sub` sa berie výhradne zo session, nikdy z tela requestu ani z query.** Porušenie tohto
  jediného pravidla mení „pamätaj si filtre" na čítanie cudzích nastavení a cudzích prepojení.
- Nové routy sú chránené deny-by-default middlewarom (`src/middleware.ts`), ale test „bez
  session → 401" tam patrí explicitne — sú to prvé endpointy appky s per-user dátami.
- **Tokeny na serveri:** AES-256-GCM, kľúč z env (`KROS_TOKEN_KEY`, `openssl rand -base64 32`),
  vlastné IV per riadok. `src/lib/kros-logs.ts` pri chybách loguje telá odpovedí — musí byť
  overené, že sa doň token nedostane.
- **Zmena oproti dnešku je obojsmerná.** Token dnes leží v `localStorage`, kde ho prečíta
  ľubovoľný XSS; v DB je na tom lepšie. Zároveň sa ale všetky tokeny sústredia na jedno
  miesto — únik DB prestáva byť únikom metadát. Zálohy patria šifrovať a prístup k DB držať
  úzky.
- Zmazanie konta v službe appku nijako neinformuje, takže riadky po zrušenom človeku ostanú
  (aj s tokenmi). Otvorená otázka nižšie.

---

## Testy

Podľa pravidla z fázy SSO — každá asercia typu „X sa stalo" sa dokazuje mutáciou.

- **čisté funkcie:** zlúčenie serverového a lokálneho stavu (novší vyhrá per kľúč);
  jednorazová migrácia z `localStorage`; prienik uloženého výberu firiem s dostupnými.
- **route handlery:** bez session 401; `sub` z tela requestu sa ignoruje; človek nedostane
  prepojenia ani nastavenia iného `sub` — to je najdôležitejší test celej úlohy.
- **callback:** `state` bez väzby na používateľa sa odmietne; spotrebovaný `state` sa nedá
  použiť druhýkrát; vypršaný `state` sa odmietne.
- **šifrovanie:** zašifruj → dešifruj → rovnaká hodnota; iný kľúč → zlyhá hlasno, nie ticho
  prázdnym reťazcom.
- **regresia:** nová route je chránená bez zásahu do `middleware.ts` (test už existuje).

---

## Fázovanie

**Fáza 1 — Postgres + nastavenia.** Služba, migrácie, `user_preference`,
`GET/PATCH /api/preferences`, migrácia z `localStorage`, granularita sa konečne pamätá.
Samostatne nasaditeľná a postaví infraštruktúru pre fázu 2.

**Fáza 2 — prepojenia.** `kros_connection`, `kros_oauth_state` s väzbou na `sub`, šifrované
tokeny, `/api/kros/*` berie token z DB, odpojenie odvoláva súhlas. Tu vzniká cross-device
zážitok.

**Neskôr (mimo rozsahu) — doklady na serveri.** Serverový sync a agregačné endpointy. Odstráni
prvé pomalé načítanie na každom novom zariadení. Model s tým ráta: doklady budú per
`company_id` a prístup sa odvodí z `kros_connection`.

---

## Mimo rozsahu

- Doklady z KROS API na serveri (vrátane plánovaného syncu a agregačných endpointov).
- Zrušenie podmienky jednej repliky (potrebuje zdieľaný zámok pre obnovu tokenov, nielen
  zdieľané úložisko).
- Zdieľanie nastavení medzi ľuďmi v tej istej firme („firemný default filter").
- Prepínač organizácií v appke.

---

## Otvorené otázky

1. **Zmazanie konta:** má služba appke oznámiť zrušenie konta (webhook), alebo stačí pravidlo
   „nastavenia a prepojenia bez aktivity 12 mesiacov sa mažú"? Bez odpovede ostanú v DB tokeny
   ľudí, ktorí už konto nemajú.
2. **Odpojenie firmy je po fáze 2 globálne.** Kliknutie na telefóne odpojí firmu aj na
   notebooku — je to správanie, ktoré chceme (áno podľa logiky úlohy), ale je to zmena oproti
   dnešku a patrí do textu potvrdzovacieho dialógu.
3. **Vyčistenie cache v `/settings`** dnes maže `kros_dashboard_last_sync_at` a lokálne cache.
   Po fáze 2: má tlačidlo ostať čisto lokálne (odporúčam áno), alebo má vedieť aj odpojiť firmy?
