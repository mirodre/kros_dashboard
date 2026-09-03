# KROS Dashboard (Fáza A)

Mobilný dashboard pre KROS (tržby, štítky, firmy, cashflow). Prístup k dátam je viazaný na prepojenie s KROS (výmena OAuth tokenov) — pozri [Live napojenie na KROS](#live-napojenie-na-kros-fáza-b).

Frontend-first prototyp pre mobilný dashboard:
- Dashboard 1: Vývoj tržieb
- Dashboard 2: Tržby podľa štítkov
- Dashboard 3: Tržby podľa firiem
- Revolut-like swipe KPI karty
- Filter granularít: týždeň / mesiac / rok
- PWA manifest pripravený

## Prihlásenie

Appka nemá vlastné prihlasovacie obrazovky ani vlastných používateľov — identitu vlastní
`authentication_service` (`https://login.krosdoplnky.sk`). Appka je jeho OAuth2 klient
(authorization code + PKCE, Auth.js v5); prístup na `https://prehlady.krosdoplnky.sk` bez
platnej session tam automaticky presmeruje.

Registrácia klienta v službe, premenné prostredia potrebné na oboch stranách a overovací
checklist po nasadení: [docs/SSO-prechod.md](docs/SSO-prechod.md).

## Premenné prostredia

Všetky premenné sú voliteľné (majú rozumné defaulty v kóde). Ak ich chceš prepísať, skopíruj `.env.example` → `.env`.

| Premenná | Povinné | Popis |
|----------|---------|--------|
| `DATABASE_URL` | nie | Postgres pre nastavenia používateľov (filtre). Bez nej si appka filtre pamätá len v prehliadači. |
| `KROS_API_BASE_URL` | nie | Default `https://api-economy.kros.sk` |
| `NEXT_PUBLIC_KROS_CONSENT_BASE_URL` | nie | Default `https://firma.kros.sk/integration-consent` |

## Spustenie (vývoj)

1. Nainštaluj Node.js 20+.
2. V koreni projektu spusti:

```bash
npm install
npm run dev
```

3. Otvor `http://localhost:3000` — bez platnej session ťa middleware presmeruje na prihlásenie cez `authentication_service` (pozri [Prihlásenie](#prihlásenie)).

## Nasadenie na server

**Coolify / Nixpacks:** projekt obsahuje `.nvmrc` a `nixpacks.toml` (Node 20). Bez toho build zlyhá na Node 18.

Po `git pull` na serveri (Node.js 20+):

```bash
cp .env.example .env   # len pri prvom nasadení — potom .env uprav a necommituj
npm install
npm run build
npm run start
```

Po reštarte otvor URL aplikácie — prihlásenie vyžaduje `authentication_service` (pozri [Prihlásenie](#prihlásenie)), prístup k dátam po prihlásení ešte vyžaduje prepojenie s KROS.

Aktualizácia z repozitára:

```bash
git pull
npm install
npm run build
# reštart procesu (pm2, systemd, …)
```

## Zapamätané nastavenia (filtre)

Filtre firiem a štítkov sa ukladajú **na firmu** (tenant zo `authentication_service`), takže
človeka nasledujú na iné zariadenie a dajú sa zdieľať s kolegami. Zbalenie panelov
a granularita sú **osobné** — zdieľať ich by znamenalo prestavovať kolegovi obrazovku.

- Bežná zmena filtra sa ukladá **len pre mňa**. Firemné predvolené nastaví výslovná akcia
  v `/settings` → **Firemné filtre → Nastaviť pre celú firmu** (smie ju urobiť ktokoľvek
  v tej firme; kto to bol naposledy, panel ukazuje).
- **Vrátiť sa na firemné filtre** zmaže moje osobné prepísanie.
- `localStorage` zostáva ako cache, takže prvé vykreslenie je okamžité a appka funguje aj
  offline. Bez `DATABASE_URL` sa nastavenia neukladajú na server a appka beží ako predtým.
- **Migrácie schémy sa aplikujú pri štarte servera** (`src/instrumentation.ts`), samostatný
  krok pri nasadení netreba — v logu sa objaví `Migrácie aplikované: …`. Zámerne tu nie je
  `npm run migrate`: samostatný TypeScript runner by si vyžiadal ďalšiu závislosť, ktorú by
  používal jeden príkaz.
- Existujúce filtre z prehliadača sa pri prvom otvorení nahrajú **do osobnej úrovne**, nie do
  firemnej — inak by prvý človek po nasadení prestavil dashboard celej firme.
- Tlačidlo **Vymazať cache dát** maže len doklady z KROS API a stav synchronizácie; filtre
  ostávajú (stráži to test v `src/lib/cache-clear.test.ts`).

## Bezpečnosť (verejné nasadenie)

- Prístup do appky vyžaduje prihlásenie cez `authentication_service` (pozri [Prihlásenie](#prihlásenie)); appka nemá vlastné prihlasovacie obrazovky. Nad tým, po prihlásení, je prístup k dátam ešte viazaný na prepojenie s KROS (OAuth tokeny sa ukladajú lokálne v prehliadači).
- KROS OAuth callback vyžaduje platný server-side `state` (CSRF ochrana).
- Po aktualizácii nasaď `next@16.2.6+` kvôli opraveným CVE v starších verziách Next.js.
- **Cloudflare loader** (ochrana pred botmi pred appkou): návod [docs/cloudflare-loader.md](docs/cloudflare-loader.md).

## Poznámka

Aktuálna verzia má fallback mock dáta a zároveň podporuje live napojenie na KROS API.

## Live napojenie na KROS (Fáza B)

Backend route handlers:
- `POST /api/kros/poll`
- `POST /api/kros/invoices`

Flow:
1. Klikni `Prepojiť s KROS`.
2. V KROS udeľ súhlas pre firmy.
3. Po schválení ťa KROS presmeruje späť do aplikácie.
4. Tokeny sa uložia lokálne a dashboard sa prepne na live dáta.
