# Prechod na zdieľané prihlásenie (`authentication_service`)

Runbook pre nasadenie fázy, po ktorej `kros_dashboard` (appka `prehlady.krosdoplnky.sk`)
prestáva byť verejne dostupný a stáva sa OAuth2 klientom `authentication_service`
(`login.krosdoplnky.sk`), authorization code + PKCE. Krok 1–3 nižšie **musia** prebehnúť
pred nasadením appky — bez nich sa po nasadení nedostane do appky nikto (appka bude vracať
presmerovania/401 na neexistujúceho klienta).

Súvisiaci kód: `src/auth.ts` (konfigurácia Auth.js), `src/auth-provider.ts` (provider
`krosdoplnky`), `src/auth-callbacks.ts` (`jwt`/`session` callbacky, obnova claimov),
`src/app/prihlasenie/route.ts` (vstup do služby), `src/middleware.ts` (deny-by-default),
`src/lib/public-paths.ts` (jediný zoznam verejných ciest), `src/lib/auth-service.ts`
(komunikácia so službou), `src/lib/single-flight.ts` (deduplikácia obnovy tokenov),
`src/lib/sign-out-url.ts` (odhlásenie). Dizajn: pozri
`docs/superpowers/specs/2026-09-02-kros-dashboard-sso-klient-design.md`, implementačný plán:
`docs/superpowers/plans/2026-09-02-kros-dashboard-sso-klient.md`.

## 1. Registrácia OAuth klienta v službe

Na serveri, v kontajneri `login.krosdoplnky.sk`:

```bash
cd /var/www/html && php artisan passport:client --public=0 --name="KROS prehlady" --redirect_uri="https://prehlady.krosdoplnky.sk/api/auth/callback/krosdoplnky"
```

Poznač si `client_id` a `client_secret`, ktoré príkaz vypíše — pôjdu do appky (krok 3).

**Prečo `--public=0`:** appka posiela `client_secret` (pozri `src/lib/auth-service.ts`,
funkcia `refreshTokens`, a `src/auth-provider.ts`, `clientSecret: process.env.AUTH_SERVICE_CLIENT_SECRET`).
Passport 13 rozhoduje o dôvernosti klienta čisto podľa `! empty($secret)` — verejnému klientovi
(`secret` je `NULL`) by pri výmene kódu za token odpovedal `invalid_client`. Vynechanie
`--public=0` je najčastejší spôsob, ako si túto fázu na prvý pokus pokaziť.

**Redirect URI musí sedieť presne** na `https://prehlady.krosdoplnky.sk/api/auth/callback/krosdoplnky`
— žiadne koncové lomítko, presne táto schéma+host+cesta. Passport ho validuje presnou zhodou;
koncové lomítko navyše alebo naopak chýbajúce znamená `invalid_client` pri návrate z prihlásenia,
nie pri registrácii klienta (chyba sa prejaví až pri prvom pokuse o prihlásenie).

## 2. Premenné v službe

Do Dokploy Environment **služby** (`login.krosdoplnky.sk`):

- `PASSPORT_TRUSTED_CLIENTS` — doplniť o `client_id` z kroku 1. Bez toho dostane každý
  používateľ pri prvom prihlásení **403** namiesto preskočeného consentu.
- `AUTH_RETURN_APPS` — doplniť o `prehlady=https://prehlady.krosdoplnky.sk`. Toto je kľúč,
  ktorý appka posiela pri odhlásení ako `?app=` (pozri časť 3 nižšie aj bod 4 checklistu) —
  bez tohto záznamu služba po odhlásení a opätovnom prihlásení vráti človeka na svoj vlastný
  profil, nie do appky.
- Potom **redeploy služby, nie restart** — Dokploy environment premenné pri obyčajnom restarte
  nenačíta nanovo.

Over: `php artisan auth:check-config` v kontajneri služby.

## 3. Premenné v appke

Do Dokploy Environment appky (`prehlady.krosdoplnky.sk`) — presný zoznam podľa `.env.example`:

| Premenná | Povinné | Poznámka |
|---|---|---|
| `AUTH_SERVICE_URL` | áno | `https://login.krosdoplnky.sk` |
| `AUTH_SERVICE_CLIENT_ID` | áno | z kroku 1 |
| `AUTH_SERVICE_CLIENT_SECRET` | áno | z kroku 1 |
| `AUTH_SECRET` | áno | `openssl rand -base64 32`. Auth.js ním šifruje session cookie (JWE) — bez neho appka nenaštartuje. |
| `AUTH_URL` | áno | presne `https://prehlady.krosdoplnky.sk` (Passport validuje redirect URI presnou zhodou, pozri krok 1) |
| `AUTH_SERVICE_APP_KEY` | nie | default `prehlady` (viď nižšie — **nie je v pôvodnom zozname premenných appky, ale existuje a treba ju poznať**) |
| `AUTH_SERVICE_CLAIMS_TTL` | nie | default `900` (sekúnd), sedí s TTL access tokenu v službe |
| `AUTH_SERVICE_GRACE_PERIOD` | nie | default `86400` (sekúnd) |
| `AUTH_SERVICE_TIMEOUT_MS` | nie | default `5000` |
| `KROS_API_BASE_URL` | nie | nesúvisí so SSO, existovalo pred touto fázou |
| `NEXT_PUBLIC_KROS_CONSENT_BASE_URL` | nie | nesúvisí so SSO, existovalo pred touto fázou |

**`AUTH_SERVICE_APP_KEY` — dôležité, aj keď nepovinné.** Používa ju `src/lib/sign-out-url.ts`
na zostavenie `?app=` parametra pri odhlásení. Keď premenná chýba alebo je prázdna/biela
(napr. odkomentovaný riadok v `.env.example` bez hodnoty), appka použije default `prehlady` —
to je zámerný fallback (`.trim() || "prehlady"`), nie chyba. Skutočná chyba je, keď sa táto
hodnota (default alebo nastavená) **nezhoduje** so záznamom v `AUTH_RETURN_APPS` v službe
(krok 2) — vtedy služba kľúč vyhodnotí ako neznámy a človek po odhlásení skončí na profile
služby namiesto späť v appke. Over oba konce zhody, nie len appku.

**Po zmene ktorejkoľvek premennej appky: redeploy, nie restart** — rovnako ako v kroku 2 pri
službe. Platí to aj pre `AUTH_SERVICE_CLAIMS_TTL`, `AUTH_SERVICE_GRACE_PERIOD` a
`AUTH_SERVICE_TIMEOUT_MS`: čítajú sa z `process.env` v edge sandboxe, ktorý si kópiu
prostredia vyrobí **raz pri vytvorení kontextu** — a middleware, teda aj celá obnova claimov,
beží práve tam. Zmena hodnoty bez redeployu sa navonok vôbec neprejaví a človek ju potom
hľadá v kóde.

### Počet replík appky: presne JEDNA (podmienka, nie odporúčanie)

V Dokploy je počet replík obyčajné pole vo formulári, takže sa dá zvýšiť jedným klikom — a
appka to nijako nezistí ani neohlási. Obnova tokenov je deduplikovaná v pamäti procesu
(`src/lib/single-flight.ts`): keď claimy zvetrajú, súbežné requesty tej istej session sa
musia zhodnúť na JEDNOM volaní `/oauth/token`, pretože Passport pri rotácii starý refresh
token okamžite revokuje. Dve repliky majú dve nezávislé mapy, takže obe zavolajú obnovu tým
istým tokenom, druhá dostane `invalid_grant` a človeka to odhlási. Navonok to vyzerá ako
náhodné hromadné odhlasovanie v čase najvyššej prevádzky — teda presne to zlyhanie, kvôli
ktorému táto fáza vznikla.

Kým appka nemá zdieľaný stav (Redis lock, alebo tokeny v serverovej session ako
`payment_connector`), platí: **jedna replika**. Horizontálne škálovanie tejto appky je
samostatná úloha, nie zmena hodnoty vo formulári.

### `/prihlasenie` — vstupná cesta appky, ktorá sa nikde neregistruje

Každý neprihlásený človek prechádza cez `/prihlasenie` (`src/app/prihlasenie/route.ts`):
middleware ho tam pošle s `callbackUrl` a route hneď skočí do služby, žiadna prihlasovacia
obrazovka v appke nie je. Na rozdiel od redirect URI z kroku 1 sa táto cesta v službe
**nikde nezapisuje** — služba o nej nevie a vedieť nemá; do `passport:client` patrí len
`/api/auth/callback/krosdoplnky`.

Pri ladení sa hodí vedieť, že tá istá cesta je aj `pages.signIn`, takže Auth.js sem posiela
chyby prihlásenia. S `?error=` route vykreslí slovenskú chybu s kódom a odkazom na nový pokus
a prihlásenie ZÁMERNE nespustí znova — inak by vznikol nekonečný cyklus, ktorý páli
autorizačný kód na každom kole.

## 4. Overovací checklist po nasadení

Vyplň výsledok každého bodu priamo v tomto súbore a commitni ako záznam nasadenia.

| # | Čo overiť | Výsledok |
|---|---|---|
| 1 | `https://prehlady.krosdoplnky.sk` neprihlásený → presmeruje do služby | _(nevyplnené)_ |
| 2 | Prihlásenie → návrat do appky, prehľady sa načítajú | _(nevyplnené)_ |
| 3 | `curl https://prehlady.krosdoplnky.sk/api/kros/logs` bez session → **401**, nie dáta | _(nevyplnené)_ |
| 4 | Odhlásenie → opätovné prihlásenie vráti späť do appky, nie na profil služby | _(nevyplnené)_ |
| 5 | Po ~16 min klikania človek ostane prihlásený (obnova claimov funguje) | _(nevyplnené)_ |
| 6 | Statické assety a `/api/auth/*` fungujú aj bez session | _(nevyplnené)_ |
| 7 | Celý KROS consent flow: `Prepojiť s KROS` → súhlas na `firma.kros.sk` → cross-site POST na `/kros/callback` → firma reálne pribudne v appke, prihlásený aj po (znovu)prihlásení | _(nevyplnené)_ |
| 8 | Odhlásenie zruší aj session v službe: po kliknutí na „Odhlásiť sa" v appke skús znova otvoriť appku bez nového prihlásenia cez `login.krosdoplnky.sk` v tom istom prehliadači — služba musí vyžadovať nové prihlásenie, nie ticho vrátiť starú session | _(nevyplnené)_ |
| 9 | **Prvé prihlásenie rob s otvorenými devtools na karte Network.** Po návrate zo služby musí nasledovať jeden skok do appky. Séria skokov medzi `/prihlasenie` a službou (alebo `ERR_TOO_MANY_REDIRECTS`) znamená chybu v OAuth callbacku | _(nevyplnené)_ |
| 10 | V logu služby na token endpointe over, že jedna session vyvolá **presne jedno** volanie `/oauth/token` za 15-minútové okno | _(nevyplnené)_ |

Bod 3 je ten, kvôli ktorému celá fáza vznikla — `/api/kros/logs` bol pred touto fázou
verejne dostupný a vydával mená firiem.

**Bod 7 je najrizikovejšie miesto tohto nasadenia.** Testová sada fázy sa dotýka claimov,
tokenov a middleware, ale flow KROS consentu end-to-end **nepokrýva žiadny test** — musí sa
odklikať ručne. `/kros/callback` je jediná cesta z `src/lib/public-paths.ts`, ktorá je verejná
zámerne aj po tejto fáze: KROS integration-consent služba (`firma.kros.sk`) sem posiela
cross-site form POST. Session cookie Auth.js má `sameSite: "lax"` a taká cookie sa pri
cross-site POSTe neposiela — kebyže je táto cesta chránená middlewarom, prihlásený človek by
prišiel bez session, middleware by ho presmeroval na prihlásenie a POST telo (zoznam firiem)
by sa nenávratne stratilo. Skutočnou ochranou tejto route je jednorazový `state`, ktorý appka
sama vydala cez `POST /api/kros/oauth-state` (to je už za prihlásením) a `/kros/callback`
handler ho spotrebuje — nie session. Preto bod 7 musí overiť, že firma po flow **reálne
pribudne**, nielen že request na `/kros/callback` vráti 200.

**Bod 8 pokrýva druhé miesto bez testu.** `signOutAction` (`src/app/actions/sign-out.ts`)
volá `signOut({ redirect: false })` a cross-origin presmerovanie do `/logout` v službe robí
sám cez `redirect()` z `next/navigation`. Dôvod: `signOut({ redirectTo })` by nefungoval —
Auth.js defaultný `redirect` callback zahodí akýkoľvek cieľ na inom origine, než je appka,
a nahradí ho vlastnou base URL appky, takže by človek nikdy nedošiel do `/logout` v službe a
session služby by prežila každé odhlásenie v appke. Vlastný `redirect` callback v `src/auth.ts`
zámerne **nepribudol** — ten istý default chráni pred open-redirectom všade inde, kam
`callbackUrl` prichádza priamo od klienta (napr. `src/middleware.ts` ho skladá z cesty
requestu). Zlyhanie, ktoré bod 8 chytá, sa navonok netvári ako chyba: appka po kliknutí na
„Odhlásiť sa" vyzerá odhlásená (lokálna cookie je preč), ale ďalšie prihlásenie prejde bez
prihlasovacej obrazovky služby — ticho vráti toho istého človeka.

**Bod 9 je poistka proti cyklu, nie kozmetika.** `/prihlasenie` je aj `pages.signIn`, takže
tam Auth.js posiela chyby typu `OAuthCallbackError` — zlý `AUTH_SERVICE_CLIENT_SECRET`,
zrušený grant, neznámy scope. Route na ne odpovedá chybovou stránkou a prihlásenie sama
nespúšťa; keby to niekto zmenil, cyklus by nepotreboval žiadnu interakciu (služba už dala
klientovi súhlas) a bežal by až do `ERR_TOO_MANY_REDIRECTS`. Na karte Network je rozdiel
medzi „chybová stránka s kódom" a „séria presmerovaní" vidieť okamžite; bez devtools sa to
dá prehliadnuť ako pomalé načítanie.

**Bod 10 overuje vec, ktorú testy overiť nemôžu.** Rotovaná session cookie odchádza na
`Set-Cookie` odpovede toho requestu, ktorý obnovu spustil, a tá odpoveď prichádza z
middleware. Keby ich Next niekedy prestal posielať na odpovediach s `x-middleware-next`
(alebo keby sa zmenila cesta, akou `handleAuth` cookies pripája), appka by síce fungovala,
ale **každý** request by obnovoval znova: v logu služby by bola séria volaní `/oauth/token`
namiesto jedného za 15 minút, každé s rotáciou a revokáciou predchádzajúceho. Automatická
smoke skúška to zachytiť nedokáže, pretože beží proti fiktívnej službe, ktorá žiadny log
nemá. Preto sa to overuje raz, ručne, v logu skutočnej služby.

## Čo sa oproti pôvodnému plánu zmenilo (implementačná revízia)

Kód prešiel review, ktoré v pôvodnom pláne (`docs/superpowers/plans/2026-09-02-kros-dashboard-sso-klient.md`)
odhalilo reálne chyby. Opravy sú už v repe; tu je prevádzkový dôsledok každej:

1. **`/kros/callback` zostáva verejná cesta**, nie preto, že by sa na ňu zabudlo, ale zámerne
   — dôvod je vyššie pri bode 7 checklistu. Ak niekedy niekto zvažuje „opravu", ktorá by ju
   dala za middleware, najprv nech si prečíta komentár v `src/lib/public-paths.ts`.
2. **Odhlásenie robí cross-origin skok samo** (`redirect: false` + `redirect()`), nie cez
   `signOut({ redirectTo })` — pozri bod 8 checklistu vyššie.
3. **`AUTH_SERVICE_APP_KEY` existuje a má default `prehlady`** — pôvodný zoznam premenných
   appky v pláne ju vynechal. Musí byť v `AUTH_RETURN_APPS` v službe, inak sa po odhlásení
   a novom prihlásení skončí na profile služby namiesto v appke.
4. **Prvé prihlásenie ide cez appkin `fetchMe`**, nie cez holý Auth.js `userinfo` fetch —
   provider v `src/auth-provider.ts` deleguje `userinfo.request` na `fetchMe()` zo
   `src/lib/auth-service.ts`.
   Tvar odpovede `/api/me` sa tak overuje pri prvom prihlásení rovnako prísne ako pri každej
   obnove claimov. Ak služba niekedy zmení tvar odpovede, appka pri prihlásení zlyhá nahlas
   (výnimka), nie ticho so session bez identity.
5. **`next-auth@5.0.0-beta.32` sa dal skompilovať na Next 16.2.6 bez problémov** — záložný
   plán z návrhu (vlastný OAuth klient nad `jose`) sa nepoužil, nebol potrebný. Build vypisuje
   varovanie `The "middleware" file convention is deprecated. Please use "proxy" instead.` —
   je to len varovanie, build kvôli nemu nepadá a `next-auth` beta o `proxy` konvencii zatiaľ
   nič nevie. Keby sa `middleware.ts` niekedy premenoval na `proxy.ts`, over to explicitne
   proti tomu, ako `auth()` appku obaľuje (`export default auth((request) => ...)`) — nepredpokladaj,
   že je to bezobsažná premenná náhrada.
6. **Authorize request posiela `scope=` (prázdny), a to naschvál.** `@auth/core` doplní
   `scope=openid profile email` každému OAuth provideru, ktorý scope v authorize URL nemá,
   a služba nemá zaregistrovaný ani jeden scope — dostala by `invalid_scope` ešte pred
   consent obrazovkou. Prázdna hodnota v `src/auth-provider.ts` je preto funkčná súčasť
   konfigurácie, nie zabudnutý zvyšok; kto ju „uklidí", zhasne prihlásenie úplne. Ak by
   služba niekedy scopy zaregistrovala (`Passport::tokensCan`), treba tú hodnotu doplniť
   vedome na oboch stranách.
7. **`runtime-logs/` JE v `.gitignore`** (riadok 18). Sekcia „Čo tento plán vedome nerieší" v
   pôvodnom pláne tvrdí opak — to tvrdenie neplatí, neopakuj ho.
