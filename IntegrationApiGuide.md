# KROS API — Integrácia tretích strán s KROS

## 1. Prehľad

KROS API umožňuje aplikáciám tretích strán vytvoriť prepojenie s KROS systémom a získať prístup k vybraným dátam používateľov. Ide o **zjednodušený mechanizmus ako vytvoriť prepojenie** — používateľ nemusí manuálne vytvárať ani zadávať token do integrátora. Celý proces prebieha automaticky: stačí vytvoriť URL s požadovanými parametrami a presmerovať používateľa.

### Ako vytvorenie prepojenia funguje

Celý proces pozostáva z troch krokov:

1. **Integrátor** vytvorí **Integration Consent URL** a presmeruje na ňu používateľa.
2. **Používateľ** na stránke KROS skontroluje žiadosť o prístup a udelí súhlas.
3. **KROS** vygeneruje prístupový token pre každú schválenú spoločnosť a doručí ho integrátorovi — buď priamo cez HTTP POST (`Post režim`), alebo prostredníctvom rozhrania na priebežné overovanie (`Poll režim`).

Vygenerovaný token integrátor následne používa pri všetkých volaniach KROS API v mene danej spoločnosti.

**Príklad použitia:**

> Používateľ využíva CRM systém na správu obchodných príležitostí a zákazníkov. Aby mal obchodný tím aktuálny prehľad o finančnej situácii klientov, chce prepojiť CRM s KROS.\
Používateľ klikne na tlačidlo „Prepojiť s KROS" priamo v CRM. Aplikácia ho presmeruje na KROS, kde sa prihlási (ak je prihlásený tak sa prihlasenie preskakuje) a vyberie spoločnosti, ku ktorým chce udeliť prístup.\
Po potvrdení KROS automaticky doručí CRM systému prístupové tokeny pre jednotlivé spoločnosti. CRM si tieto tokeny uloží a začne pravidelne načítavať údaje o vystavených faktúrach, ich splatnosti a stave úhrad.\
Obchodníci tak priamo v CRM vidia, či má zákazník neuhradené faktúry, v akej je výške jeho obrat a môžu tomu prispôsobiť ďalšiu komunikáciu — napríklad pozastaviť dodávky alebo naopak ponúknuť lepšie obchodné podmienky spoľahlivým klientom.

### Porovnanie režimov

| | Post režim | Poll režim |
|-|------------|------------|
| **Doručenie tokenu** | Pasívne — čakanie na doručenie tokenu | Aktívne — dopytovanie na stav |
| **Spôsob príjmu** | HTTP POST na `redirect_url` | Volanie polling endpointu s parametrom `state` |
| **Vhodné pre** | Serverové webové aplikácie | SPA, mobilné aplikácie, CLI nástroje, cron joby, ... |
| **Parameter `state`** | Voliteľný (bezpečnostná kontrola) | Povinný (identifikátor pre polling) |

---

## 2. Post režim

### Popis

Po udelení súhlasu používateľom na stránke KROS prehliadač automaticky odošle HTTP POST priamo na `redirect_url` integrátora. Odpoveď obsahuje prístupové tokeny pre všetky schválené spoločnosti. Integrátor tokeny prijme okamžite a môže ihneď začať volať KROS API.

### Tok spracovania

```
Integrátor                    Používateľ                       KROS
    │                              │                              │
    │── Integration Consent URL ──►│                              │
    │                              │── Otvorenie stránky ────────►│
    │                              │◄─ Zobrazenie žiadosti ───────│
    │                              │── Potvrdenie súhlasu ───────►│
    │◄─────────────── HTTP POST (tokeny) ─────────────────────────│
    │                              │                              │
```

### Integration Consent URL

```
https://firma.kros.sk/integration-consent
```

### Parametre

| Parameter | Typ | Povinnosť | Popis |
|-----------|-----|-----------|-------|
| `plugin_name` | string | Povinný | Názov vašej aplikácie (zobrazený používateľovi pri udeľovaní súhlasu) |
| `integrator_name` | string | Povinný | Obchodný názov vašej spoločnosti |
| `version` | string | Povinný | Verzia API — použite hodnotu `"1"` |
| `response_mode` | string | Povinný | Musí byť `"post"` |
| `redirect_url` | string | Povinný | Vaša HTTPS URL, na ktorú KROS odošle tokeny cez HTTP POST |
| `company_mode` | string | Voliteľný | `"single"` (predvolené) alebo `"multiple"` — pri hodnote `multiple` môže používateľ pridať súhlas pre viaceré spoločnosti naraz |
| `webhook` | string | Voliteľný | Vaša HTTPS webhook URL pre prijímanie notifikácií od nás |
| `webhook_secret` | string | Voliteľný | Tajný kľúč na overenie pravosti webhook notifikácií (ak nie je zadaný, KROS ho vygeneruje automaticky) |
| `state` | string | Voliteľný | Bezpečnostný parameter — ľubovoľná hodnota, ktorú KROS vráti v odpovedi; integrátor ju môže porovnať s odoslanou hodnotou a overiť, že prijal odpoveď, ktorú očakával |

### Príklad Integration Consent URL

```
https://firma.kros.sk/integration-consent
  ?plugin_name=MyEcommerceApp
  &integrator_name=Acme%20Corporation
  &version=1
  &response_mode=post
  &redirect_url=https%3A%2F%2Fmyapp.com%2Fkros%2Fcallback
  &company_mode=multiple
  &state=random-state-id-12345
```

> **Poznámka:** URL musí byť odoslaná ako jeden reťazec. Zalomenie vyššie je len pre prehľadnosť.

### Štruktúra HTTP POST odpovede

Po udelení súhlasu KROS odošle na `redirect_url` POST form data v nasledujúcom formáte:

| Pole | Typ | Popis |
|------|-----|-------|
| `data[n][companyId]` | integer | Identifikátor spoločnosti |
| `data[n][token]` | string | JWT prístupový token pre danú spoločnosť |
| `data[n][companyName]` | string | Obchodný názov spoločnosti |
| `data[n][webhookSecret]` | string | Webhook secret v kódovaní Base64 |
| `state` | string | Vrátená hodnota parametra `state` (ak bol zadaný) |

**Príklad prijatých POST dát:**

```
data[0][companyId]=123
data[0][token]=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
data[0][companyName]=Acme Corp
data[0][webhookSecret]=aG9zZXJhbmRvbXNlY3JldA==

data[1][companyId]=456
data[1][token]=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
data[1][companyName]=Tech Inc
data[1][webhookSecret]=YW5vdGhlcnNlY3JldA==

state=random-state-id-12345
```

---

## 3. Poll režim

### Popis

Po udelení súhlasu používateľom KROS uloží vygenerované tokeny na serveri po dobu **15 minút**. Integrátor ich priebežne vyzdvihuje volaním polling endpointu s hodnotou parametra `state`. Tento prístup je vhodný pre aplikácie, ktoré nemôžu prijímať priame HTTP POST volania, alebo kde je žiaduce oddeliť krok udelenia súhlasu od kroku získania tokenu. Napríklad mobilné alebo desktopové aplikácie.

### Tok spracovania

```
Integrátor                    Používateľ                       KROS
    │                              │                              │
    │── Integration Consent URL ──►│                              │
    │                              │── Otvorenie stránky ────────►│
    │                              │◄─ Zobrazenie žiadosti ───────│
    │                              │── Potvrdenie súhlasu ───────►│
    │                              │                    Tokeny uložené (15 min)
    │                              │                              │
    │                              │                              │
    │── POST /poll (state) ──────────────────────────────────────►│
    │◄─ { status: "Approved", companies: [...] } ─────────────────│
```

### Integration Consent URL

```
https://firma.kros.sk/integration-consent
```

### Parametre

| Parameter | Typ | Povinnosť | Popis |
|-----------|-----|-----------|-------|
| `plugin_name` | string | Povinný | Názov vašej aplikácie (zobrazený používateľovi pri udeľovaní súhlasu) |
| `integrator_name` | string | Povinný | Obchodný názov vašej spoločnosti |
| `version` | string | Povinný | Verzia API — použite hodnotu `"1"` |
| `response_mode` | string | Povinný | Musí byť `"poll"` |
| `state` | string | Povinný | Bezpečnostný parameter — kryptograficky bezpečný náhodný reťazec (minimálne 32 znakov); integrátor ho použije na overenie integrity a na vyzdvihnutie tokenov cez polling endpoint |
| `company_mode` | string | Voliteľný | `"single"` (predvolené) alebo `"multiple"` — pri hodnote `multiple` môže používateľ pridať súhlas pre viaceré spoločnosti naraz |
| `webhook` | string | Voliteľný | Vaša HTTPS webhook URL pre prijímanie notifikácií od nás |
| `webhook_secret` | string | Voliteľný | Tajný kľúč na overenie pravosti webhook notifikácií (ak nie je zadaný, KROS ho vygeneruje automaticky) |

### Príklad Integration Consent URL

```
https://firma.kros.sk/integration-consent
  ?plugin_name=MyEcommerceApp
  &integrator_name=Acme%20Corporation
  &version=1
  &response_mode=poll
  &state=a7s9f8j2k1l0m3n4b5v6c7x8z9q1w2e3r4t5y6u7i8o9p0
  &company_mode=multiple
```

> **Poznámka:** URL musí byť odoslaná ako jeden reťazec. Zalomenie vyššie je len pre prehľadnosť.

### Polling endpoint

```
POST https://api-economy.kros.sk/api/integration-subscription/poll
```

#### Parametre požiadavky

| Parameter | Typ | Povinnosť | Popis |
|-----------|-----|-----------|-------|
| `state` | string | Povinný | Hodnota parametra `state` použitá v Integration Consent URL |

#### Príklad požiadavky

```http
POST /api/integration-subscription/poll HTTP/1.1
Host: api.kros.sk
Content-Type: application/json

{
  "state": "a7s9f8j2k1l0m3n4b5v6c7x8z9q1w2e3r4t5y6u7i8o9p0"
}
```

### Štruktúra odpovede

| Pole | Typ | Popis |
|------|-----|-------|
| `data.status` | string | Stav spracovania — možné hodnoty: `Approved`, `Pending`, `Denied`, `Expired` |
| `data.companies` | array | Zoznam schválených spoločností — prítomné iba pri stave `Approved` |
| `data.companies[n].companyId` | integer | Identifikátor spoločnosti |
| `data.companies[n].companyName` | string | Obchodný názov spoločnosti |
| `data.companies[n].token` | string | JWT prístupový token pre danú spoločnosť |
| `data.companies[n].webHookSecret` | string | Webhook secret v kódovaní Base64 |

#### Stavy spracovania

| Stav | Popis |
|------|-------|
| `Pending` | Používateľ ešte neudelil súhlas. Pokračujte v pollingu. |
| `Approved` | Súhlas bol udelený. Odpoveď obsahuje prístupové tokeny. |
| `Denied` | Používateľ súhlas zamietol. |
| `Expired` | Platnosť požiadavky vypršala (15 minút). Je potrebné iniciovať nový integračný tok. |

### Príklady odpovedí

**Stav `Pending` — tokeny zatiaľ nie sú dostupné:**

```json
{
  "data": {
    "status": "Pending"
  }
}
```

**Stav `Approved` — tokeny sú pripravené:**

```json
{
  "data": {
    "status": "Approved",
    "companies": [
      {
        "companyId": 123,
        "companyName": "Acme Corp",
        "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
        "webHookSecret": "aG9zZXJhbmRvbXNlY3JldA=="
      },
      {
        "companyId": 456,
        "companyName": "Tech Inc",
        "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
        "webHookSecret": "YW5vdGhlcnNlY3JldA=="
      }
    ]
  }
}
```

