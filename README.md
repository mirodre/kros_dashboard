# KROS Dashboard (Fáza A)

Frontend-first prototyp pre mobilný dashboard:
- Dashboard 1: Vývoj tržieb
- Dashboard 2: Výkon podľa tagov
- Dashboard 3: Výkon podľa firiem
- Revolut-like swipe KPI karty
- Filter granularít: týždeň / mesiac / rok
- PWA manifest pripravený

## Spustenie

1. Nainštaluj Node.js 20+.
2. V koreni projektu spusti:

```bash
npm install
npm run dev
```

3. Otvor `http://localhost:3000`.

## Poznámka

Aktuálna verzia má fallback mock dáta a zároveň podporuje live napojenie na KROS API.

## Live napojenie na KROS (Fáza B)

Backend route handlers:
- `POST /api/kros/poll`
- `POST /api/kros/invoices`

Voliteľné env premenné:
- `KROS_API_BASE_URL` (default `https://api-economy.kros.sk`)
- `NEXT_PUBLIC_KROS_CONSENT_BASE_URL` (default `https://firma.kros.sk/integration-consent`)

Flow:
1. Klikni `Prepojiť s KROS`.
2. V KROS udeľ súhlas pre firmy.
3. Po schválení ťa KROS presmeruje späť do aplikácie.
4. Tokeny sa uložia lokálne a dashboard sa prepne na live dáta.
