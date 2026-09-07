# Nastavenia a prepojenia viazané na firmu (tenanta) naprieč zariadeniami — návrh

**Cieľ:** čo si človek v appke nastaví (filtre firiem, filtre štítkov, zbalené sekcie,
granularita) a s ktorými firmami je prepojený ho má nasledovať na iné zariadenie, a časť
z toho má byť **zdieľaná medzi ľuďmi v tej istej firme**.

**Rozsah:** filtre a prepojenia. **Doklady z KROS API sa na server neukladajú** — zostávajú
v IndexedDB každého zariadenia. Rozhodnutie z 3.9.2026: raz to príde, ale nie teraz. Výber
technológie s tým ráta a dátový model je postavený tak, aby sa doklady dali pridať bez
prestavby.

**Stav dokumentu:** **fázy 0, 1 aj 2 sú hotové (3.9.2026).** Plán fáz 0–1 je v
`docs/superpowers/plans/2026-09-03-per-user-nastavenia-faza-0-1.md`; fáza 2 sa robila podľa
tohto dokumentu priamo. Odchýlky sú vyznačené v texte.

---

## Rozhodnutia z 3.9.2026

| otázka | rozhodnutie |
|---|---|
| úložisko | **Postgres ako služba** — nie súbor ani SQLite |
| kľúčovanie | **tenant (`organizationId`) ako základ, `sub` ako osobná vrstva nad ním** |
| filtre a nastavenia | **áno**, fáza 1 — zdieľateľné aj osobné (pozri „Dve úrovne") |
| KROS prepojenia | **áno**, fáza 2 — na tenanta, nie na človeka |
| doklady z KROS API | **nie teraz**; model s nimi ráta |
| kto mení firemné nastavenia | **hocikto v tenante** — bez kontroly roly; stopou je `updated_by_sub` |
| webhook pri odobraní z firmy | **netreba** — stačí zánik prístupu do 15 minút |
| tlačidlo „Vymazať cache dát" | **maže len doklady z KROS API**, filtre zostávajú |

**Toto ruší vetu zo spec-u fázy SSO** *„databáza, ktorá príde s filtrami… kľúčuje sa `sub`-om"*.
Princíp za ňou platí ďalej — appka nevlastní nič o identite a `organizationId` je len
**referencia** na tenanta v službe, rovnako ako `sub` bol referenciou na človeka. Mení sa
úroveň, nie vlastníctvo. Zhodou okolností je to aj návrat ku vzoru, ktorý má
`payment_connector` (`connections.organization_id`).

---

## Je na to prihlasovacia služba pripravená? Áno

Nie je to dojem — je to v claimoch, ktoré appka už dnes dostáva z `/api/me`
(`src/lib/auth-service.ts`):

```ts
organizations?: Array<{ id?: string; name?: string; role?: string }>;
active_organization?: string | null;
```

Takže služba dáva **id tenanta, jeho názov aj rolu človeka v ňom** (`owner`, `member` — pozri
`src/lib/sso-claims.test.ts`). Claimy prichádzajú zo servera služby, nie od klienta, takže sú
overiteľné a nedajú sa podvrhnúť z prehliadača. Tri veci ale treba doriešiť, lebo sú to presne
tie, na ktorých to inak stroskotá:

1. **Appka si dnes z celého zoznamu drží len aktívnu firmu** (`claimsFromMe`
   v `src/lib/sso-claims.ts`) a prepínač organizácií nemá. Kým je človek v jednej firme, je to
   jedno. Pri dvoch to znamená, že vidí to, čo služba označí za aktívne, bez možnosti prepnúť —
   a bez toho, aby vedel, ktorej firmy nastavenia práve mení. **Minimum: názov tenanta viditeľne
   v hlavičke.** Prepínač je samostatná úloha, ale zoznam organizácií sa oplatí začať držať
   v claimoch hneď.
2. **`active_organization` môže byť `null`** alebo ukazovať na firmu, ktorá v zozname nie je
   (existujúci test to pokrýva). Potrebné je definované správanie: bez tenanta appka spadne na
   osobný scope `user:<sub>` a zdieľanie sa neponúka.
3. **Claimy sú z definície mierne zastarané.** `AUTH_SERVICE_CLAIMS_TTL=900` znamená, že zmena
   členstva sa prejaví do 15 minút; `AUTH_SERVICE_GRACE_PERIOD=86400` znamená, že počas výpadku
   služby žijú staré claimy až 24 hodín. Kým išlo o filtre, bola to drobnosť. Po fáze 2 to
   znamená, že **človek odobraný z firmy môže mať počas výpadku služby prístup k jej dátam až
   24 hodín**. Je to vedome prijaté riziko, nie prehliadnutie — a treba ho prijať teraz, nie
   po incidente.

---

## Dve úrovne nastavení — nie všetko patrí tenantovi

Presunúť na tenanta *všetko* by bola chyba, ktorá sa prejaví hneď v prvý deň: keď jeden človek
zbalí panel alebo prepne granularitu na „Rok", nemá to prestaviť obrazovku kolegovi. Preto:

| kľúč | úroveň |
|---|---|
| filtre firiem (Príjmy, Výdavky, Cashflow) | **tenant** — s osobným prepísaním |
| filtre štítkov (Príjmy, Výdavky) | **tenant** — s osobným prepísaním |
| zbalené sekcie (5 kľúčov) | **len osobné** — ergonómia, nie konfigurácia |
| granularita | **len osobné** |
| KROS prepojenia | **len tenant** — osobná vrstva tu nedáva zmysel |

**Vyhodnotenie:** `osobná hodnota ?? firemná hodnota ?? default v kóde`. Úroveň každého kľúča je
zapísaná v jednom registri v kóde (nie roztrúsená po komponentoch), aby sa dala prečítať aj
otestovať na jednom mieste.

**Zápis je vždy najprv osobný.** Zmena filtra nikdy ticho neprestaví dashboard celej firme —
to je správanie, ktoré ľudí naučí filtre nemeniť. Zdieľanie je **výslovná akcia**:

- *„Nastaviť ako firemné predvolené"* — skopíruje aktuálne hodnoty na úroveň tenanta.
  **Bez kontroly roly** (rozhodnutie z 3.9.2026): smie to hocikto v tenante. `updated_by_sub`
  je preto stopa, nie prevencia — v UI sa oplatí ukázať „naposledy zmenil X", aby sa dalo
  zistiť, kto firemný filter prestavil.
- *„Vrátiť sa na firemné predvolené"* — zmaže osobné prepísanie; človek zase vidí firemné.

---

## Východisko

Appka nemá žiadne serverové úložisko. Všetko, čo si pamätá, je v prehliadači, teda per
zariadenie a per profil prehliadača.

### Skupina A — nastavenia (fáza 1)

| kľúč | kde vzniká | úroveň |
|---|---|---|
| `kros_dashboard_selected_tags` | `src/app/page.tsx:51` | tenant + osobné |
| `kros_dashboard_revenue_selected_companies` | `src/app/page.tsx:52` | tenant + osobné |
| `kros_dashboard_expenses_selected_tags` | `src/app/expenses/page.tsx:50` | tenant + osobné |
| `kros_dashboard_expenses_selected_companies` | `src/app/expenses/page.tsx:51` | tenant + osobné |
| `kros_dashboard_cashflow_selected_companies` | `src/app/cashflow/page.tsx:32` | tenant + osobné |
| `kros_dashboard_collapsed_tag_categories` | `src/components/categorized-tags-dashboard.tsx:15` | osobné |
| `kros_dashboard_collapsed_companies` | `src/components/companies-dashboard.tsx:30` | osobné |
| `kros_dashboard_expenses_collapsed_companies` | `src/app/expenses/page.tsx:691` | osobné |
| `kros_dashboard_collapsed_recent_invoices` | `src/components/recent-invoices-section.tsx:15` | osobné |
| `kros_dashboard_collapsed_recent_expenses` | `src/components/recent-expenses-section.tsx:98` | osobné |
| `kros_dashboard_collapsed_expense_vendors` | `src/components/expense-vendors-section.tsx:14` | osobné |
| *(granularita)* | `globalThis.__krosDashboardGranularity` | osobné — **dnes sa nepersistuje vôbec**, stráca sa pri F5 |

### Skupina B — čo zostáva v prehliadači

| kľúč | prečo |
|---|---|
| IndexedDB `kros_dashboard_cache`, `..._expenses_cache`, `..._cashflow_cache` | doklady; mimo rozsahu, každé zariadenie si ich sťahuje samo ako dnes |
| `kros_dashboard_last_sync_at` | *„kedy TOTO zariadenie naposledy sťahovalo"* — synchronizovať ho by znamenalo klamať |
| `kros_dashboard_pending_state` | jednorazový CSRF `state`; po fáze 2 zaniká |

### Skupina C — KROS prepojenia (fáza 2)

`src/lib/kros-storage.ts` drží v `localStorage` zoznam firiem **aj s KROS tokenmi**
(`KrosConnection = { companyId, companyName, token, webhookSecret?, connectedAt }`) a klient
ich posiela v tele každého requestu do `/api/kros/*`.

---

## Prečo Postgres, keď dnes ukladáme kilobajty

1. **Doklady raz prídu.** Prechod zo SQLite alebo súboru by prišiel presne vtedy, keď úložisko
   už nesie tokeny celej firmy. Ovládač `pg` je čistý JS — žiadny natívny build, na rozdiel od
   `better-sqlite3`, ktoré vie zhodiť build cez nixpacks až na serveri.
2. **Volume, ktorý nikto nezálohuje, je pasca.** Zabudnutý volume nespôsobí chybu — appka
   funguje, len po redeploy „zabudne". Po fáze 2 to znamená, že **celá firma sa musí znova
   prepojiť s KROS**. Zálohy Postgresu sú vyriešená úloha; zálohy volume so SQLite nie sú.
3. **Zdieľaný stav sa zíde aj inde.** Podmienka „jedna replika" (`docs/SSO-prechod.md`) stojí na
   tom, že deduplikácia obnovy tokenov žije v pamäti procesu (`src/lib/single-flight.ts`).
   Postgres advisory lock je kandidát, ako ju raz zrušiť — sám o sebe ju nezruší.

**Cena:** jedna služba navyše v Dokploy, jej zálohovanie, a connection pool ako singleton cez
`globalThis` (inak ho hot reload v dev režime vyrobí pri každej zmene znova).

---

## Dátový model

```sql
-- Fáza 1 — firemná úroveň
create table tenant_preference (
  tenant_id      text        not null,        -- organizationId zo /api/me
  key            text        not null,
  value          jsonb       not null,
  updated_at     timestamptz not null default now(),
  updated_by_sub text        not null,        -- kto naposledy prepísal firemné nastavenie
  primary key (tenant_id, key)
);

-- Fáza 1 — osobná vrstva nad ňou
create table user_preference (
  user_sub   text        not null,
  tenant_id  text        not null,            -- 'user:<sub>' keď človek nemá tenanta
  key        text        not null,
  value      jsonb       not null,
  updated_at timestamptz not null default now(),
  primary key (user_sub, tenant_id, key)
);

-- Fáza 2
create table kros_connection (
  tenant_id          text        not null,
  company_id         bigint      not null,
  company_name       text        not null,
  token_enc          bytea       not null,    -- AES-256-GCM
  webhook_secret_enc bytea,
  connected_by_sub   text        not null,    -- čí súhlas token je
  connected_at       timestamptz not null default now(),
  primary key (tenant_id, company_id)
);

-- Fáza 2 — nahrádza runtime-logs/oauth-pending-states.json
create table kros_oauth_state (
  state      text        primary key,
  tenant_id  text        not null,
  user_sub   text        not null,
  expires_at timestamptz not null
);
```

**Prečo per kľúč a nie jeden JSON dokument:** keď telefón uloží filter firiem a notebook o pár
sekúnd filter štítkov, prežijú oba. Pri jednom dokumente druhý zápis prepíše prvý celý — strata,
ktorú nikto nenahlási ako chybu, len prestane veriť, že si to appka pamätá. Pri zdieľaní medzi
ľuďmi to platí dvojnásobne.

**Prečo má aj `user_preference` stĺpec `tenant_id`:** môj filter vo firme A nie je môj filter vo
firme B. Bez toho stĺpca by osobné prepísanie prelialo nastavenia medzi firmami — teda presne to,
čomu sa tenant scoping vyhýba.

**Prečo `connected_by_sub`:** token vzniká z konkrétneho súhlasu konkrétneho človeka. Riadok
patrí firme, ale musí byť dohľadateľné, čí súhlas to je — pri odvolaní aj pri odchode človeka
z firmy.

---

## Fáza 1 — nastavenia

**Načítanie**
1. Stránka sa vykreslí okamžite z `localStorage` (dnešné správanie, bez zmeny).
2. Paralelne `GET /api/preferences` → server zlúči firemnú a osobnú úroveň a vráti výsledok
   plus informáciu, ktoré kľúče sú prepísané osobne (kvôli tlačidlu „vrátiť sa na firemné").
3. Stav sa prepíše, `localStorage` sa dorovná.
4. Server nedostupný → ostáva lokálny stav; appka funguje offline ďalej (je to PWA).

**`localStorage` teda neodchádza.** Filtre sa dnes čítajú v `useEffect` po mounte a stránky sú
`"use client"`; keby sa čítanie presunulo výhradne na sieť, medzi prvým paintom a odpoveďou by
človek videl nefiltrovaný dashboard a potom preskok. Lokálna kópia je cache pre okamžitý paint,
server je zdroj pravdy.

**Zápis**
1. Zmena ide do stavu a do `localStorage` okamžite — nikdy sa nečaká na sieť pred paintom.
2. `PATCH /api/preferences` s debounce ~800 ms zapisuje **osobnú** úroveň.
3. Firemnú úroveň mení len výslovná akcia „Nastaviť ako firemné predvolené"
   (`PUT /api/preferences/tenant`). Rolu nekontroluje, tenanta áno — a ten je zo session.
4. Zlyhanie zápisu nie je chybová hláška; hodnota ostáva lokálne a odošle sa neskôr.

**Konflikt** — last-write-wins per kľúč, oddelene na každej úrovni. Filtre nemajú zlučovaciu
sémantiku a dve zariadenia toho istého človeka nemenia to isté v tej istej sekunde.

**Migrácia z `localStorage` ide do OSOBNEJ úrovne, nikdy nie do firemnej.** Inak by prvý človek,
ktorý po nasadení otvorí appku, ticho prestavil dashboard celej firme podľa toho, čo mal
náhodou nastavené vo svojom prehliadači. Firemná úroveň vzniká len tým, že ju niekto vedome
nastaví; kým to nikto neurobí, je prázdna a platia defaulty z kódu.

### Pasca: filtre odkazujú na firmy podľa názvu

Vo všetkých troch dashboardoch je vybraná firma reťazec `companyName`. Cashflow dnes robí toto:
*„ak je uložený výber neprázdny a žiadny názov nesedí s pripojeniami, nesťahuj nič"* — na jednom
zariadení správne, po synchronizácii bežný stav. Kým sú prepojenia per zariadenie, teda **celú
fázu 1**, platí: uložený výber sa aplikuje ako **prienik** s dostupnými firmami, a keď je prienik
prázdny a výber nie, appka to **povie**, nie ticho ukáže nulu. Po fáze 2 je zoznam firiem
rovnaký pre celý tenant a filtre sa pri tej príležitosti prekľúčujú na `company_id`.

---

## Fáza 2 — prepojenia na tenanta

### Čo sa zmenilo (hotové)

1. **`POST /api/kros/oauth-state` si zapíše `tenant_id` aj `user_sub` zo session.** Dnes tam
   `state` zaregistruje ktokoľvek aj bez prihlásenia (riziko pomenované už v spec-e fázy SSO)
   a ukladá sa do `runtime-logs/oauth-pending-states.json`, teda do súboru, ktorý redeploy zmaže.
2. **`/kros/callback` zapíše firmy rovno do DB** namiesto dnešného obchádzania cez
   `sessionStorage` → `/settings` → `localStorage`.
3. **`/api/kros/*` prestane brať tokeny z tela requestu.** Klient pošle `companyId`, server si
   token načíta podľa tenanta zo session. Kým to tak nie je, serverové úložisko je len ozdoba —
   token stále cestuje z prehliadača.
4. **Odpojenie firmy** zmaže riadok. Smie to hocikto v tenante — ale na rozdiel od filtra sa
   to nedá vrátiť kliknutím, takže dialóg hovorí „odpojíš ju všetkým vo firme a späť sa dá
   len novým súhlasom v KROS".

   **Odchýlka od návrhu:** súhlas sa v KROS **neodvoláva**. `IntegrationApiGuide.md` žiadny
   revoke endpoint nemá, takže appka vie zahodiť len token u seba; kto chce zrušiť aj súhlas
   na strane KROS, robí to v KROS. Sľúbiť „odvolá súhlas" by bolo tvrdenie, ktoré kód
   nesplní.

5. **Jednorazový presun toho, čo ľuďom ostalo v prehliadači.** Pri prvom otvorení sa staré
   prepojenia z `localStorage` nahrajú na server a **z prehliadača zmažú** — nikto sa nemusí
   prepájať znova a tokeny prestanú ležať v úložisku prehliadača.

6. **Databáza sa stáva podmienkou.** Vo fáze 1 bola `DATABASE_URL` voliteľná. Odkedy sú v nej
   tokeny, bez databázy sa nedá zavolať KROS — routy vracajú 503 s vysvetlením namiesto
   prázdnych dát, ktoré vyzerajú ako firma bez tržieb. Pribúda aj `KROS_TOKEN_KEY`.

### Prečo musí byť `state` viazaný na tenanta už pri registrácii

KROS posiela výsledok ako **cross-site POST** z `firma.kros.sk` na `/kros/callback`, a Lax
session cookie sa pri cross-site POST neodošle — callback teda zo session nezistí nič. To už
appka vie a rieši: `/kros/callback` je preto vo verejných cestách a autorizuje ho jednorazový
`state` (`src/lib/public-paths.ts` to má aj vysvetlené).

Nové je len to, že `state` dnes nenesie **nič okrem seba** (`registerOAuthState` ukladá
`{ state, expiresAt }`). Aby callback vedel, komu prepojenie zapísať, musí `state` vzniknúť
s väzbou `→ tenant_id + user_sub`, a to sa dá jedine v requeste z appky, ktorý session má.
Vedľajší efekt: zmizne dnešná možnosť registrovať `state` anonymne — riziko pomenované už
v spec-e fázy SSO.

### Čo tým firma získa a čo tým riskuje

**Získa:** jeden človek prepojí KROS a **všetci v tej firme vidia dáta** — na akomkoľvek
zariadení, bez klikania cez KROS consent.

**Riskuje:** je to zdieľanie **prístupu k dátam**, nie konfigurácie. Kto je v tenante, vidí
tržby všetkých pripojených firiem. Pridanie človeka do firmy v prihlasovacej službe sa tým
stáva rozhodnutím o prístupe k účtovným dátam — a robí sa v inej appke, než kde sa prejaví.
Patrí to do dokumentácie pre toho, kto členstvá spravuje.

**A čo po odchode človeka z firmy:** riadok prepojenia ostáva (patrí firme, čo je správne), ale
token je z jeho súhlasu. Kým ho niekto neodpojí a nepripojí nanovo, firma ďalej ťahá dáta na
súhlas človeka, ktorý tam už nie je. Nie je to únik — prístup k appke stráca do 15 minút
(`AUTH_SERVICE_CLAIMS_TTL`) —, ale je to stav, o ktorom treba vedieť; preto `connected_by_sub`.

### Čo cross-device zážitok po fáze 2 je a čo nie je

**Je:** prihlásim sa na telefóne a firmy sú prepojené.
**Nie je:** telefón má prázdnu IndexedDB, takže **prvé načítanie na ňom stále stiahne históriu
dokladov**, request na firmu a mesiac, ako dnes. To odstráni až presun dokladov na server, ktorý
je vedome odložený. Treba to povedať dopredu, inak to po nasadení vyzerá ako nedokončená práca.

---

## Bezpečnosť

- **`tenant_id`, `sub` aj `role` sa berú výhradne zo session claimov, nikdy z tela requestu ani
  z query.** Porušenie tohto jediného pravidla mení zdieľanie vo firme na čítanie cudzích firiem.
- Každý dotaz filtruje `tenant_id = :tenantFromSession`. Bez výnimky, aj pri „len jednom" tenante.
- Zápis firemnej úrovne a odpojenie firmy **rolu nekontrolujú** (rozhodnutie z 3.9.2026) —
  hranicou je tenant, nie rola. O to dôležitejšie je, aby `tenant_id` prišiel zo session:
  je to jediná hranica, ktorá tam zostáva.
- Nové routy sú chránené deny-by-default middlewarom (`src/middleware.ts`), ale test „bez session
  → 401" tam patrí explicitne — sú to prvé endpointy appky s per-tenant dátami.
- **Tokeny:** AES-256-GCM, kľúč z env (`KROS_TOKEN_KEY`, `openssl rand -base64 32`), vlastné IV
  per riadok. `src/lib/kros-logs.ts` pri chybách loguje telá odpovedí — musí byť overené, že sa
  doň token nedostane.
- **Zastarané claimy:** členstvo a rola sú čerstvé do `AUTH_SERVICE_CLAIMS_TTL` (15 min), počas
  výpadku služby až do `AUTH_SERVICE_GRACE_PERIOD` (24 h). Po fáze 2 je to okno prístupu
  k firemným dátam. Vedome prijaté; skrátiť grace period je páka, ak sa to ukáže ako priveľa.

---

## Testy

Podľa pravidla z fázy SSO — každá asercia typu „X sa stalo" sa dokazuje mutáciou.

- **čisté funkcie:** vyhodnotenie úrovní (`osobné ?? firemné ?? default`); register úrovní
  (zbalenie sekcie sa nikdy nezapíše na firemnú úroveň); zlúčenie serverového a lokálneho stavu;
  migrácia z `localStorage` ide do osobnej úrovne; prienik uloženého výberu firiem s dostupnými.
- **route handlery:** bez session 401; `tenant_id` z tela requestu sa ignoruje; človek z tenanta
  A nedostane nastavenia ani prepojenia tenanta B — najdôležitejší test celej úlohy.
- **vymazanie cache nezmaže filtre** ani ich neodošle na server (regresia k rozhodnutiu nižšie).
- **callback:** `state` bez väzby na tenanta sa odmietne; spotrebovaný `state` sa nedá použiť
  druhýkrát; vypršaný `state` sa odmietne.
- **claimy bez tenanta:** `active_organization: null` → osobný scope, zdieľanie sa neponúka,
  nič nespadne.
- **šifrovanie:** zašifruj → dešifruj → rovnaká hodnota; iný kľúč → zlyhá hlasno, nie ticho
  prázdnym reťazcom.
- **regresia:** nová route je chránená bez zásahu do `middleware.ts` (test už existuje).

---

## Fázovanie

**Fáza 0 (hotové) — tenant v claimoch a v UI.** Držať v claimoch celý zoznam organizácií, nielen
aktívnu, a ukázať názov firmy v hlavičke. Bez toho ľudia nevedia, ktorej firmy nastavenia menia.

**Fáza 1 (hotové) — Postgres + nastavenia.** Služba, migrácie, `tenant_preference` + `user_preference`,
`GET/PATCH /api/preferences`, `PUT /api/preferences/tenant`, register úrovní, migrácia
z `localStorage` do osobnej úrovne, granularita sa konečne pamätá.

**Fáza 2 (hotové) — prepojenia na tenanta.** `kros_connection`, `kros_oauth_state` s väzbou na
tenanta, šifrované tokeny, `/api/kros/*` berie token z DB podľa session, odpojenie za celú
firmu, jednorazový presun starých prepojení z prehliadača.

**Neskôr (mimo rozsahu) — doklady na serveri.** Model s tým ráta: doklady budú per
`(tenant_id, company_id)` a prístup sa odvodí z `kros_connection`.

---

## Mimo rozsahu

- Doklady z KROS API na serveri (vrátane plánovaného syncu a agregačných endpointov).
- Plnohodnotný prepínač organizácií v appke (fáza 0 rieši len zobrazenie a claimy).
- Zrušenie podmienky jednej repliky.
- Vlastné role a oprávnenia v appke — používajú sa tie, ktoré posiela služba.

---

## Tlačidlo „Vymazať cache dát"

Rozhodnuté: maže **len doklady stiahnuté z KROS API** — faktúry (Príjmy), výdavkové doklady
a platby (Financie) — a stav synchronizácie. **Filtre ostávajú.**

Dnešný `handleClearInvoiceCache` (`src/app/settings/page.tsx`) presne toto už robí: volá
`clearInvoiceCache()`, `clearCashflowCache()`, `clearExpenseCache()` a maže
`kros_dashboard_last_sync_at`. Filtrov sa nedotýka.

Po fáze 1 je to však vec, ktorú treba **ustrážiť testom**, nie ponechať na pamäť: filtre budú
v tom istom `localStorage` ako doteraz (ako cache nad serverom), takže ktokoľvek, kto raz
tlačidlo „upraví, nech to vyčistí poriadne", ich zmaže spolu s dokladmi — a keďže server ostane
zdrojom pravdy, vyzerá to ako oprava, kým sa nezistí, že sa filtre vrátili. Test „vymazanie cache
nezmaže filtre" je preto v zozname vyššie.

Tlačidlo zostáva **čisto lokálne** — nič nemaže na serveri a nedotýka sa prepojení.

---

## Prijaté predpoklady

Zapísané, aby sa dali odmietnuť jednou vetou, ak sedia zle:

1. **Odpojenie firmy smie hocikto v tenante** — odvodené z rozhodnutia „firemné nastavenia smie
   meniť hocikto". Je to však jediná nevratná akcia v celom rozsahu (nový súhlas v KROS sa musí
   vyklikať), preto ju kryje aspoň dialóg s jasným textom. Ak to má byť inak, je to jedna
   podmienka v handleri.
2. **Bez webhooku** sa firma po odchode človeka ďalej pripája na jeho súhlas, kým prepojenie
   niekto neobnoví. Prístup do appky mu zanikne do 15 minút, token v KROS žije ďalej —
   `connected_by_sub` je tam preto, aby sa to dalo zistiť.
3. **Jeden tenant na človeka** je predpoklad dnešného UI. Fáza 0 preto len ukazuje názov firmy;
   plnohodnotný prepínač je samostatná úloha.
