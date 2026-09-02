# `kros_dashboard` ako klient zdieľaného prihlásenia (fáza 3) — návrh

**Cieľ:** `kros_dashboard` (`https://prehlady.krosdoplnky.sk`) prestane byť verejne dostupný
bez prihlásenia a stane sa OAuth2 klientom `authentication_service`
(`https://login.krosdoplnky.sk`), rovnako ako `payment_connector` vo fáze 2.

**Nadväzuje na:** fázu 1 (služba ako identity provider) a fázu 2 (`payment_connector` ako jej
prvý klient). Runbook a chyby, ktoré fáza 2 zaplatila, sú v
`payment_connector/docs/SSO-prechod.md` — **prečítať pred nasadením, nie po ňom.**

---

## Východisko

Toto nie je výmena existujúceho prihlásenia, ale jeho **pridanie do appky, ktorá žiadne nemá**:

- neexistuje `middleware.ts` ani `auth.ts`, `next-auth` nie je ani v závislostiach
- neexistujú testy ani `test` skript — je len `build` a `lint`
- nasadenie ide **Nixpackom**, nie Docker compose ako obe ostatné appky, takže deploy postup
  z fázy 2 sa nedá skopírovať
- KROS tokeny zákazníka žijú v `localStorage` a klient ich posiela v tele requestu do
  `/api/kros/*`

### Čo je dnes vystavené

Appka beží na verejnej doméne bez akejkoľvek ochrany. Konkrétne:

| endpoint | čo sa dá |
|---|---|
| `GET /api/kros/logs` | prečítať serverový log posledných 300 volaní — názvy firiem, endpointy, metódy, stavy, časy a pri chybách aj telá odpovedí z KROS API. **Prístupové tokeny v logu nie sú.** |
| `DELETE /api/kros/logs` | zmazať ten log |
| `POST /api/kros/oauth-state` | zaregistrovať ľubovoľný `state` pre KROS consent flow (čítať sa nedá, `GET` neexistuje) |
| ostatné `/api/kros/*` | použiť server ako relay do `api-economy.kros.sk`, ale s **vlastným** tokenom — cudzie dáta nevypadnú |

Teda únik metadát o firmách a možnosť zmazať log; nie únik prístupových údajov.

---

## Rozhodnutia

### 1. Auth.js v5 s vlastným OAuth providerom

Overené proti npm registry: `next-auth@5.0.0-beta.32` deklaruje
`next: ^14 || ^15 || ^16` a `react: ^18.2 || ^19`. Appka je Next 16.2.6 a React 19.0.0, teda
v podporovanom rozsahu. Zostáva to beta — prvým krokom implementácie je preto obyčajný
`next build` s nainštalovaným providerom, kým sa naň naviaže čokoľvek ďalšie.

Provider je **vlastný** (explicitné `authorization`, `token`, `userinfo` endpointy), nie
discovery: služba OIDC vrstvu nemá.

**Provider sa menuje `krosdoplnky`, nie `kros`.** Appka už má `/api/kros/*` vo význame „KROS
ekonomické API"; pomenovať tak aj prihlasovanie by pri čítaní kódu mýlilo. Callback teda je
`https://prehlady.krosdoplnky.sk/api/auth/callback/krosdoplnky`.

### 2. Session v šifrovanej cookie, nie v databáze

`strategy: "jwt"` — access token, refresh token a claimy žijú v httpOnly JWE cookie.

Fáza 2 mala tvrdé pravidlo „tokeny výhradne v server-side session, nikdy v cookie". Tu sa
vedome nedodržiava a treba povedať prečo:

- `kros_dashboard` nemá databázu ani Redis a v tejto fáze ich nedostane.
- Auth.js `strategy: "database"` nie je „to isté cez DB": žiada **adaptér**, ktorý si zakladá
  tabuľky `users`, `accounts`, `sessions`. Teda lokálnu kópiu používateľov — presne to, čo sme
  vo fáze 2 z `payment_connector` mazali, aby appka identitu nevlastnila. Kto by ju
  aktualizoval, keď si niekto v službe zmení e-mail?
- Appka už dnes drží KROS tokeny zákazníka v `localStorage`, čo je slabšia pozícia než šifrovaná
  httpOnly cookie. Zavádzať server-side store pre SSO tokeny, kým citlivejšie údaje ležia
  v prehliadači, by bolo utesňovanie okna vo dverách bez zámku.

**Dôsledok pre budúce per-user dáta (filtre):** databáza, ktorá príde s filtrami, je na
**business dáta, nie na identitu**. Kľúčuje sa `sub`-om zo `/api/me` — referenciou na
používateľa v službe, presne tou istou úlohou, akú má `connections.organization_id` vo fáze 2.
Appka o identite nevlastní nič ani potom.

### 3. Middleware chráni všetko okrem výslovne verejného

Pôvodný náčrt v spec-e fázy 1 vymenúval chránené cesty (`/cashflow`, `/expenses`, `/settings`,
`/kros/*`, `/api/kros/*`). To je allowlist ochrany — a keď pribudne nová route, je otvorená,
kým si na ňu niekto nespomenie. **Takto vznikla dnešná expozícia `/api/kros/logs`.**

Obrátené: middleware chráni **všetko**, verejný je len explicitný zoznam — `/api/auth/*`
(handlery Auth.js) a statické assety (`_next/*`, `favicon.ico`, `public/`). Budúca tabuľka
filtrov je tým chránená v deň, kedy vznikne, bez toho aby si na to niekto musel pamätať.

Health endpoint appka dnes nemá; keby pribudol (napr. kvôli monitoringu), musí sa doplniť do
verejného zoznamu vedome, nie omylom.

### 4. Návrat do appky po prihlásení

Fáza 2 to doriešila na strane služby (`AfterLogin`, `OriginApp`, allowlist `AUTH_RETURN_APPS`)
a `kros_dashboard` má z toho ťažiť rovnako: pri odhlásení posiela `?app=prehlady`, takže
opätovné prihlásenie vráti človeka sem, nie na profil služby.

*Poznámka: toto nebolo v rozhovore samostatne odsúhlasené — vyplýva priamo z toho, ako sa
fáza 2 skončila, a je to jednoriadková zmena. Ak sa `kros_dashboard` má správať inak, treba to
tu prepísať.*

---

## Súbory

| súbor | zodpovednosť |
|---|---|
| `src/auth.ts` | konfigurácia Auth.js: provider `krosdoplnky`, `jwt` a `session` callbacky, obnova claimov |
| `src/lib/auth-service.ts` | HTTP na `/api/me` a `/oauth/token`; **jediné miesto, ktoré rozlišuje 4xx od 5xx** — obdoba `AuthServiceClient` z fázy 2 |
| `src/lib/sso-claims.ts` | tvar claimov v tokene (`sub`, `email`, `emailVerified`, `name`, `organizationId`, `organizationName`, `role`, `refreshedAt`, `degradedSince`) |
| `src/middleware.ts` | deny-by-default matcher |
| `src/app/api/auth/[...nextauth]/route.ts` | handlery Auth.js |

Prihlasovacia obrazovka v appke **nepribúda** — neprihlásený ide do služby.

## Tok

1. Request na akúkoľvek chránenú cestu → middleware zistí, že session chýba → `signIn`
2. Auth.js presmeruje na `https://login.krosdoplnky.sk/oauth/authorize` s PKCE a `state`
3. Služba (po prihlásení, ak treba) → `.../api/auth/callback/krosdoplnky`
4. Auth.js vymení kód za tokeny; `jwt` callback zavolá `/api/me` a uloží claimy, tokeny
   a `refreshedAt` do cookie
5. Každý ďalší request: `jwt` callback pozrie vek claimov; nad `AUTH_SERVICE_CLAIMS_TTL`
   (default 900 s) obnoví token a claimy

## Ošetrenie chýb

Jadro celej fázy. Knižnica toto nemodeluje a fáza 2 to zaplatila výpadkom, takže má vlastné
testy pre každú vetvu:

| výsledok volania služby | reakcia |
|---|---|
| úspech | prepíš claimy a tokeny, posuň `refreshedAt`, zmaž `degradedSince` |
| **4xx** | odhlás okamžite |
| **5xx / timeout / 429** | **session nechaj žiť**, zapíš `degradedSince` iba pri PRVOM zlyhaní, pokračuj |
| `degradedSince` starší než `AUTH_SERVICE_GRACE_PERIOD` (default 86400 s) | odhlás |
| v tokene chýba refresh token | odhlás |

`degradedSince` sa pri opakovanom zlyhaní **neprepisuje** — grace period sa počíta od začiatku
výpadku, inak by sa posúvala pri každom requeste a nikdy nevypršala.

Zliať 4xx a 5xx znamená, že päťminútový výpadok služby odhlási všetkých naraz.

## Testy

Dnes neexistuje ani `test` skript. Pribúda **Vitest + MSW**; služba sa v testoch nikdy nevolá
naživo.

- **middleware:** chránená cesta bez session → redirect na prihlásenie; `/api/auth/*`
  a statické assety prejdú aj bez session
- **deny-by-default regresia:** nová route je chránená bez toho, aby sa niekto dotkol
  `middleware.ts`. Tento test má vlastný dôvod existovať — presne on by bol zachytil dnešnú
  expozíciu `/api/kros/logs`, a je to poistka pre budúcu tabuľku filtrov.
- **`jwt` callback:** svieže claimy sa neobnovujú; po TTL sa obnovia; 4xx → odhlásenie;
  5xx → session prežije a `degradedSince` sa nastaví; druhé zlyhanie `degradedSince`
  neprepíše; po grace období → odhlásenie
- **callback:** nesprávny `state` → zamietnuté
- `sub` je v session dostupný (predpoklad budúcich per-user dát)

Každá asercia typu „X sa stalo" sa dokazuje mutáciou — dočasne odstrániť kód, ktorý to robí,
overiť že test padne, vrátiť. Pravidlo z fáz 1 a 2; tautologický test je horší než žiadny.

---

## Predpoklady pred nasadením

Bez týchto krokov sa do appky po nasadení nedostane nikto:

1. **OAuth klient v službe** — dôverný (`--public=0`, teda so secretom; Passport 13 rozhoduje
   o dôvernosti čisto podľa `! empty($secret)`), `redirect_uris` presne
   `https://prehlady.krosdoplnky.sk/api/auth/callback/krosdoplnky`. Passport porovnáva presnou
   zhodou — koncové lomítko znamená `invalid_client`.
2. **`PASSPORT_TRUSTED_CLIENTS`** v Dokploy služby doplniť o nové client ID (inak sa ukáže 403
   namiesto preskočeného consentu).
3. **`AUTH_RETURN_APPS`** v Dokploy služby doplniť o `prehlady=https://prehlady.krosdoplnky.sk`.
4. **Env appky:** `AUTH_SERVICE_URL`, `AUTH_SERVICE_CLIENT_ID`, `AUTH_SERVICE_CLIENT_SECRET`,
   `AUTH_SERVICE_CLAIMS_TTL`, `AUTH_SERVICE_GRACE_PERIOD` a `AUTH_SECRET` (Auth.js ním šifruje
   cookie — bez neho sa appka nerozbehne).
5. Po zmene env **redeploy, nie restart.**

## Mimo rozsahu

- Presun KROS pripojení zo `localStorage` do server-side per-user úložiska.
- Databáza na pamätanie filtrov — príde samostatne, potom, a bude sa kľúčovať `sub`-om.
- Stvrdenie `POST /api/kros/oauth-state` (dnes tam ktokoľvek zaregistruje `state`).
- `runtime-logs/` nie je v `.gitignore` (dnes tam nič commitnuté nie je, ale je to jeden
  `git add -A` od toho, aby boli názvy firiem v histórii).

## Vedome prijaté riziko

`GET`/`DELETE /api/kros/logs` zostáva otvorené, kým sa táto fáza nedokončí — rozhodnutie
z 2.9.2026: jedna zmena namiesto dvoch. Je to argument za to, aby fáza nemala dlhý chvost.
