# KROS API — polia potrebné pre Domov

Zistené: 2026-09-06, zo skutočných odpovedí KROS API, ktoré dodal používateľ
(prvá stránka `GET /api/invoices` a `GET /api/expenses`, 100 + 100 dokladov,
jedna firma). Nahrádza to plánované vzorkovanie cez `KROS_LOG_SAMPLE_PAYLOAD`
(Task 1, kroky 5–7) — to sa nemuselo spustiť.

**Obmedzenie vzorky:** jedna firma, prvá stránka. Distribúcie nižšie sú orientačné;
existencia a tvar polí sú spoľahlivé.

## Faktúra (`GET /api/invoices`)

| Údaj | Cesta v payloade | Existuje? |
|---|---|---|
| dátum splatnosti | `dueDate` | ✅ 100/100, tvar `"2024-07-22T00:00:00"` |
| stav úhrady | `paymentStatus` (číselný kód) | ✅ 100/100 |
| suma bez DPH | `prices.legislativePrices.totalPrice` | ✅ 100/100 |
| suma DPH | `prices.legislativePrices.vatTotalPrice` | ✅ 100/100 (nenulová v 77) |
| druh dokladu | `invoiceType` (0 = bežná, 1 = dobropis) | ✅ — pozor, **nie** `documentType` |

Kódovanie stavu úhrady: `0` notPaid, `1` fullyPaid, `2` overPaid, `3` partiallyPaid.
**Zhoduje sa s `EXPENSE_PAYMENT_STATUS_BY_CODE`** v `src/lib/expenses-live.ts` —
jedna zdieľaná mapa teda stačí. Vo vzorke: `{0:10, 1:87, 2:1, 3:2}`.

`vatBreakdowns` je vo všetkých 100 dokladoch prázdne pole — DPH sa berie z `prices`.

## Výdavok (`GET /api/expenses`)

| Údaj | Cesta v payloade | Existuje? |
|---|---|---|
| suma DPH | `prices.legislativePrices.vatTotalPrice` | ✅ 100/100 (nenulová v 30) |
| dátum splatnosti | `dueDate` | ⚠️ chýba v 17/100 |
| stav úhrady | `paymentStatus` | ✅ `{0:16, 1:83, 3:1}` |

Vzorka je zo **zoznamu**, nie z detailu — `journalItems` (rozúčtovanie na štítky)
tu nie sú, appka si ich doťahuje zvlášť cez `/api/expenses/{id}`. Na DPH to nevadí:
daň sa číta z hlavičky.

## Tri zistenia, ktoré menia plán

### 1. Dobropisy chodia už so záporným znamienkom — na oboch stranách

Faktúrový dobropis (`invoiceType: 1`): `totalPrice: -40.65`, `vatTotalPrice: -9.35`.
Výdavkový dobropis (`documentType: 17`): `totalPrice: -55.12`, `vatTotalPrice: -12.68`.

Dôsledky:
- `normalizeInvoices` **nepotrebuje žiadnu logiku znamienok**. (Existujúce
  `applySign` vo výdavkoch je `-Math.abs(...)`, teda idempotentné — na už zápornej
  hodnote nič nepokazí.)
- `computeVatEstimate` **nesmie otáčať znamienko DPH**. Pôvodný plán chcel pri
  dobropise použiť `-expense.vatAmount`; to by zápornú daň otočilo na kladnú
  a vstupnú DPH pri dobropise **zvýšilo** namiesto zníženia. DPH sa len sčítava.
- `isExpenseCreditNote` teda netreba vôbec.

### 2. `documentPrices` je v mene dokladu, `legislativePrices` v eurách

Overené na 24 dokladoch s kurzom ≠ 1: podiel `documentPrices / legislativePrices`
sa presne rovná `prices.exchangeRate`.

| Mena | Kurz | documentPrices | legislativePrices |
|---|---|---|---|
| CZK | 25.202 | 67 919.39 | 2 695.00 |
| CZK | 24.366 | 24 366.00 | 1 000.00 |
| PLN | 4.1 | 8.94 | 2.18 |

Doklady sú vo faktúrach v EUR, CZK, PLN, GBP a USD; vo výdavkoch v EUR a PLN.

Dôsledok: **plánovaný fallback `legislativePrices.totalPrice` → `documentPrices.totalPrice`
sa NESMIE urobiť.** Pri českej faktúre by do eurového súčtu pripočítal 67 919
namiesto 2 695. Analytiky musia čítať výhradne `legislativePrices` — to je jediná
skupina v účtovnej mene.

### 3. Tvrdenie o „latentnej chybe" sa nepotvrdilo

Špecifikácia tvrdila, že `normalizeInvoices` môže ticho vyrábať nuly, lebo číta len
`legislativePrices`. Vo vzorke je **0 zo 100 faktúr aj 0 zo 100 výdavkov**, kde by
bola legislatívna suma nulová a dokladová nenulová. Tvrdenie teda nemá oporu
a oprava sa neurobí — namiesto nej platí bod 2.

## Nájdená existujúca chyba (mimo rozsahu Domova)

`readHeaderTotalPrice` v `src/lib/expenses-live.ts` **už dnes** robí fallback
z `legislativePrices` na `documentPrices`. Podľa bodu 2 to znamená, že ak KROS pri
nejakom zahraničnom doklade nechá legislatívnu skupinu vynulovanú, appka doňho
započíta sumu v cudzej mene — pri poľskom doklade zhruba 4× viac, pri českom 25×.

Vo vzorke sa to nestalo (0/100), takže to nie je dokázaná chyba v produkcii, ale je
to reálna diera v logike, ktorá tam je zámerne (komentár hovorí, že KROS tú skupinu
pri časti výdavkov nevyplní). Patrí to do vlastnej úlohy, nie do modulu Domov —
rozhodne používateľ.
