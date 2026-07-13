# KROS Dashboard (Fáza A)

Mobilný dashboard pre KROS (tržby, štítky, firmy, cashflow). Prístup k dátam je viazaný na prepojenie s KROS (výmena OAuth tokenov) — pozri [Live napojenie na KROS](#live-napojenie-na-kros-fáza-b).

Frontend-first prototyp pre mobilný dashboard:
- Dashboard 1: Vývoj tržieb
- Dashboard 2: Tržby podľa štítkov
- Dashboard 3: Tržby podľa firiem
- Revolut-like swipe KPI karty
- Filter granularít: týždeň / mesiac / rok
- PWA manifest pripravený

## Premenné prostredia

Všetky premenné sú voliteľné (majú rozumné defaulty v kóde). Ak ich chceš prepísať, skopíruj `.env.example` → `.env`.

| Premenná | Povinné | Popis |
|----------|---------|--------|
| `KROS_API_BASE_URL` | nie | Default `https://api-economy.kros.sk` |
| `NEXT_PUBLIC_KROS_CONSENT_BASE_URL` | nie | Default `https://firma.kros.sk/integration-consent` |

## Spustenie (vývoj)

1. Nainštaluj Node.js 20+.
2. V koreni projektu spusti:

```bash
npm install
npm run dev
```

3. Otvor `http://localhost:3000` — dashboard je dostupný priamo.

## Nasadenie na server

**Coolify / Nixpacks:** projekt obsahuje `.nvmrc` a `nixpacks.toml` (Node 20). Bez toho build zlyhá na Node 18.

Po `git pull` na serveri (Node.js 20+):

```bash
cp .env.example .env   # len pri prvom nasadení — potom .env uprav a necommituj
npm install
npm run build
npm run start
```

Po reštarte otvor URL aplikácie — dashboard je dostupný priamo, prístup k dátam vyžaduje prepojenie s KROS.

Aktualizácia z repozitára:

```bash
git pull
npm install
npm run build
# reštart procesu (pm2, systemd, …)
```

## Bezpečnosť (verejné nasadenie)

- Dashboard nemá vlastné prihlásenie — prístup k dátam je viazaný na prepojenie s KROS (OAuth tokeny sa ukladajú lokálne v prehliadači).
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
