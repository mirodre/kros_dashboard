# KROS Dashboard (Fáza A)

Mobilný dashboard pre KROS (tržby, štítky, firmy, cashflow). Verejné nasadenie vyžaduje `.env` s `AUTH_SECRET` a `DASHBOARD_PASSWORD` — pozri [Premenné prostredia](#premenné-prostredia) a [Nasadenie na server](#nasadenie-na-server).

Frontend-first prototyp pre mobilný dashboard:
- Dashboard 1: Vývoj tržieb
- Dashboard 2: Tržby podľa štítkov
- Dashboard 3: Tržby podľa firiem
- Revolut-like swipe KPI karty
- Filter granularít: týždeň / mesiac / rok
- PWA manifest pripravený

## Premenné prostredia

Skopíruj `.env.example` → `.env` a vyplň hodnoty pred prvým spustením (lokálne aj na serveri).

| Premenná | Povinné | Popis |
|----------|---------|--------|
| `AUTH_SECRET` | áno | Tajný kľúč min. 32 znakov na podpis session cookie. Generovanie: `openssl rand -hex 32` |
| `DASHBOARD_PASSWORD` | áno | Heslo pre prihlásenie na `/login` (min. 8 znakov) |
| `KROS_API_BASE_URL` | nie | Default `https://api-economy.kros.sk` |
| `NEXT_PUBLIC_KROS_CONSENT_BASE_URL` | nie | Default `https://firma.kros.sk/integration-consent` |

Bez `AUTH_SECRET` a `DASHBOARD_PASSWORD` aplikácia na verejnom serveri vráti chybu 503 (zámerne nič neexponuje).

## Spustenie (vývoj)

1. Nainštaluj Node.js 20+.
2. Nastav `.env` podľa tabuľky vyššie.
3. V koreni projektu spusti:

```bash
npm install
npm run dev
```

4. Otvor `http://localhost:3000` a prihlás sa heslom z `DASHBOARD_PASSWORD`.

## Nasadenie na server

**Coolify / Nixpacks:** projekt obsahuje `.nvmrc` a `nixpacks.toml` (Node 20). Bez toho build zlyhá na Node 18.

Po `git pull` na serveri (Node.js 20+):

```bash
cp .env.example .env   # len pri prvom nasadení — potom .env uprav a necommituj
npm install
npm run build
npm run start
```

Nastav v `.env` (alebo v systemd / Docker) aspoň `AUTH_SECRET` a `DASHBOARD_PASSWORD`. Po reštarte otvor URL aplikácie — presmeruje na `/login`.

Aktualizácia z repozitára:

```bash
git pull
npm install
npm run build
# reštart procesu (pm2, systemd, …)
```

## Bezpečnosť (verejné nasadenie)

- Všetky stránky a API route sú chránené session cookie (middleware).
- Verejne dostupné sú `/login`, `POST /api/auth/login` a `POST /kros/callback` (KROS vracia cross-site POST bez session cookie).
- KROS OAuth callback vyžaduje platný server-side `state` (CSRF ochrana).
- Po aktualizácii nasaď `next@16.2.6+` kvôli opraveným CVE v starších verziách Next.js.
- **Cloudflare loader** (ochrana pred botmi pred appkou): návod [docs/cloudflare-loader.md](docs/cloudflare-loader.md) — doplnok k env heslu, nie náhrada.

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
