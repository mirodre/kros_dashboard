# `kros_dashboard` ako klient zdieľaného prihlásenia — implementačný plán

> **Pre agentov:** POVINNÝ SUB-SKILL: na vykonanie tohto plánu použi
> `superpowers:subagent-driven-development` (odporúčané) alebo `superpowers:executing-plans`.
> Kroky sú checkboxy (`- [ ]`) kvôli sledovaniu postupu.

**Cieľ:** `kros_dashboard` prestane byť verejne dostupný bez prihlásenia a stane sa OAuth2
klientom `authentication_service` (authorization code + PKCE).

**Architektúra:** Auth.js v5 (`next-auth@5.0.0-beta.32`) s vlastným OAuth providerom
`krosdoplnky`. Session je šifrovaná httpOnly cookie (`strategy: "jwt"`) — appka nemá databázu
a v tejto fáze ju nedostane. Appka o identite nevlastní nič; `sub` zo `/api/me` je referencia
na používateľa v službe. Rozhodovacia logika obnovy claimov žije v čistej funkcii mimo
frameworku, aby sa dala testovať bez Auth.js runtime.

**Tech stack:** Next.js 16.2.6 (App Router), React 19, TypeScript 5.8 (`strict`),
`next-auth@5.0.0-beta.32`, Vitest. Node 20 (nixpacks).

**Spec:** `docs/superpowers/specs/2026-09-02-kros-dashboard-sso-klient-design.md`

## Globálne obmedzenia

- **Služba beží na `https://login.krosdoplnky.sk`**, appka na `https://prehlady.krosdoplnky.sk`.
- **Redirect URI je presne `https://prehlady.krosdoplnky.sk/api/auth/callback/krosdoplnky`.**
  Passport ho validuje presnou zhodou — koncové lomítko znamená `invalid_client`.
- **Provider sa menuje `krosdoplnky`, nie `kros`.** Appka už má `/api/kros/*` vo význame „KROS
  ekonomické API"; rovnaké meno by pri čítaní kódu mýlilo.
- **Access token TTL 15 min, refresh token 30 dní** (nastavuje služba, appka ich nemení).
  `AUTH_SERVICE_CLAIMS_TTL=900`, `AUTH_SERVICE_GRACE_PERIOD=86400`.
- **Rozlíšenie „služba je dole" (5xx/timeout/429) a „konto už nemá prístup" (4xx) je povinné.**
  Zliať ich znamená, že päťminútový výpadok odhlási všetkých naraz.
- **Middleware chráni všetko okrem výslovne verejného zoznamu.** Nikdy nevymenúvaj chránené
  cesty — takto vznikla expozícia `/api/kros/logs`.
- **`scope` sa do authorize requestu neposiela.** Služba scopy nepoužíva (`/api/me` má len
  `auth:api`), takže prázdny scope je správny stav, nie zabudnutie.
- **Slovenčina v hláškach, komentáre vysvetľujú *prečo*, nie *čo*.**
- **Každá asercia typu „X sa stalo" musí byť dokázaná mutáciou** — dočasne odstráň kód, ktorý to
  robí, over že test padne, vráť, over že prejde. Tautologický test je horší než žiadny.
- **Overovacie príkazy:** `npm test`, `npx tsc --noEmit`, `npm run lint`, `npm run build`.

**Odchýlka od spec-u, ktorú tento plán robí vedome:** spec spomínal „Vitest + MSW". MSW sa
**nezavádza** — všetko, čo tu testujeme, je fetch klient a čisté funkcie, na ktoré stačí
`vi.stubGlobal("fetch", ...)`. MSW by pridala závislosť a lifecycle bez úžitku. Keby raz
pribudli testy celých route handlerov, doplní sa vtedy.

---

### Úloha 1: Testovacia infraštruktúra

Appka dnes nemá `test` skript ani žiadny test. Bez toho sa ďalej nedá pracovať TDD spôsobom,
preto je to samostatná úloha — recenzent ju vie schváliť alebo odmietnuť nezávisle.

**Súbory:**
- Vytvoriť: `vitest.config.ts`, `src/lib/__smoke__.test.ts`
- Upraviť: `package.json`

**Rozhrania:**
- Produkuje: `npm test` (jednorazový beh), `npm run test:watch`. Alias `@/` funguje v testoch.

- [ ] **Krok 1: Nainštaluj Vitest**

```bash
npm install --save-dev vitest@^3
```

- [ ] **Krok 2: Konfigurácia**

`vitest.config.ts`:

```ts
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Node, nie jsdom: testujeme fetch klienta, čisté funkcie a middleware logiku,
    // nie komponenty. Keby raz pribudli testy komponentov, pridá sa vtedy aj jsdom.
    environment: "node",
    include: ["src/**/*.test.ts"]
  },
  resolve: {
    // Rovnaký alias ako tsconfig.json `paths`. Ručne, aby nepribudla ďalšia závislosť.
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) }
  }
});
```

- [ ] **Krok 3: Skripty**

V `package.json` do `scripts` pridaj:

```json
    "test": "vitest run",
    "test:watch": "vitest"
```

- [ ] **Krok 4: Test, ktorý dokazuje, že harness beží aj s aliasom**

`src/lib/__smoke__.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { formatCurrency } from "@/lib/format";

describe("testovaci harness", () => {
  it("vie importovat cez alias @/", () => {
    // Zmysel tohto testu je jediný: dokázať, že vitest.config.ts alias naozaj funguje.
    // Keby nie, všetky ďalšie testy by padali na nezmyselnú chybu importu.
    expect(typeof formatCurrency).toBe("function");
  });
});
```

- [ ] **Krok 5: Spusti**

Spusti: `npm test`
Očakávaj: 1 passed.

- [ ] **Krok 6: Over, že sa nerozbil build ani lint**

Spusti: `npm run lint` → bez nových chýb
Spusti: `npx tsc --noEmit` → bez chýb

- [ ] **Krok 7: Commit**

```bash
git add package.json package-lock.json vitest.config.ts src/lib/__smoke__.test.ts
git commit -m "test: vitest harness"
```

---

### Úloha 2: Klient služby s rozlíšením zlyhaní

Jadro celej fázy. Jediné miesto, ktoré vie rozlíšiť „služba povedala nie" od „služba
neodpovedala". Obdoba `AuthServiceClient` z fázy 2 v `payment_connector`.

**Súbory:**
- Vytvoriť: `src/lib/auth-service.ts`, `src/lib/auth-service.test.ts`

**Rozhrania:**
- Produkuje:
  - `class SsoAuthFailed extends Error` — služba zamietla (4xx)
  - `class SsoUnavailable extends Error` — služba neodpovedala (5xx, 429, timeout, DNS)
  - `type MeResponse` — surový tvar odpovede `/api/me`
  - `async function fetchMe(accessToken: string): Promise<MeResponse>`
  - `async function refreshTokens(refreshToken: string): Promise<{ accessToken: string; refreshToken: string }>`
  - `function serviceUrl(): string` — `AUTH_SERVICE_URL` bez koncového lomítka

- [ ] **Krok 1: Napíš padajúci test**

`src/lib/auth-service.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fetchMe, refreshTokens, SsoAuthFailed, SsoUnavailable } from "@/lib/auth-service";

const ME = {
  sub: "01jbq2z9k7n4p6r8t0v2x4y6a8",
  email: "ja@firma.sk",
  email_verified: true,
  name: "Miro",
  avatar: null,
  organizations: [{ id: "01jbq3aaaaaaaaaaaaaaaaaaaa", name: "Moja firma", role: "owner" }],
  active_organization: "01jbq3aaaaaaaaaaaaaaaaaaaa"
};

function respond(status: number, body: unknown) {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

describe("auth-service", () => {
  beforeEach(() => {
    process.env.AUTH_SERVICE_URL = "https://login.test";
    process.env.AUTH_SERVICE_CLIENT_ID = "klient";
    process.env.AUTH_SERVICE_CLIENT_SECRET = "tajne";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("vrati claimy zo /api/me", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => respond(200, ME)));

    await expect(fetchMe("AT")).resolves.toMatchObject({ sub: ME.sub, email: ME.email });
  });

  it("posiela access token v Authorization hlavicke", async () => {
    const spy = vi.fn(async () => respond(200, ME));
    vi.stubGlobal("fetch", spy);

    await fetchMe("AT");

    const [, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer AT");
  });

  it.each([401, 403])("stav %i je zamietnutie, nie vypadok", async (status) => {
    vi.stubGlobal("fetch", vi.fn(async () => respond(status, { error: "nope" })));

    await expect(fetchMe("AT")).rejects.toBeInstanceOf(SsoAuthFailed);
  });

  it.each([500, 502, 503, 429])("stav %i je vypadok, nie zamietnutie", async (status) => {
    vi.stubGlobal("fetch", vi.fn(async () => respond(status, "nginx")));

    await expect(fetchMe("AT")).rejects.toBeInstanceOf(SsoUnavailable);
  });

  it("sietova chyba je vypadok", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new TypeError("fetch failed");
    }));

    await expect(fetchMe("AT")).rejects.toBeInstanceOf(SsoUnavailable);
  });

  it("neznamy tvar odpovede je vypadok, nie zamietnutie", async () => {
    // Zámerne Unavailable: appka nevie, či je to chyba nasadenia alebo zrušené konto,
    // a odhlásiť všetkých kvôli zmene tvaru odpovede by bolo horšie.
    vi.stubGlobal("fetch", vi.fn(async () => respond(200, { nieco: "ine" })));

    await expect(fetchMe("AT")).rejects.toBeInstanceOf(SsoUnavailable);
  });

  it("obnovi tokeny", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => respond(200, { access_token: "AT2", refresh_token: "RT2" })));

    await expect(refreshTokens("RT")).resolves.toEqual({ accessToken: "AT2", refreshToken: "RT2" });
  });

  it("obnova posiela client_secret ako form", async () => {
    const spy = vi.fn(async () => respond(200, { access_token: "AT2", refresh_token: "RT2" }));
    vi.stubGlobal("fetch", spy);

    await refreshTokens("RT");

    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://login.test/oauth/token");
    const body = new URLSearchParams(init.body as string);
    expect(body.get("grant_type")).toBe("refresh_token");
    expect(body.get("refresh_token")).toBe("RT");
    expect(body.get("client_id")).toBe("klient");
    expect(body.get("client_secret")).toBe("tajne");
  });

  it("zamietnuty refresh token je SsoAuthFailed", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => respond(400, { error: "invalid_grant" })));

    await expect(refreshTokens("RT")).rejects.toBeInstanceOf(SsoAuthFailed);
  });

  it("chybova sprava nesie OAuth kod chyby", async () => {
    // Bez neho sa nedá odlíšiť zlý secret (invalid_client) od zlého tokenu (invalid_grant)
    // a 4xx je neriešiteľná hádanka. `error_description` sa zámerne neberie — môže nesť vstup.
    vi.stubGlobal("fetch", vi.fn(async () => respond(400, { error: "invalid_client" })));

    await expect(refreshTokens("RT")).rejects.toThrow(/invalid_client/);
  });
});
```

- [ ] **Krok 2: Spusti a over, že padne**

Spusti: `npm test`
Očakávaj: FAIL — `Failed to resolve import "@/lib/auth-service"`.

- [ ] **Krok 3: Implementácia**

`src/lib/auth-service.ts`:

```ts
/**
 * Tri operácie proti authentication_service a nič viac: obnova tokenov, načítanie claimov
 * a adresa služby. Žiadna session, žiadne prihlasovanie — to je vrstva nad týmto.
 *
 * Celý zmysel tohto modulu je rozlíšiť dve zlyhania, ktoré vyzerajú rovnako a znamenajú
 * niečo úplne iné: „služba hovorí, že tento token už neplatí" (odhlás) a „služba
 * neodpovedala" (nechaj session žiť, skús neskôr).
 */

/** Služba zamietla — konto alebo token už neplatí. Odhlásiť. */
export class SsoAuthFailed extends Error {}

/** Služba neodpovedala — výpadok, timeout, 5xx, 429. Session nechať žiť. */
export class SsoUnavailable extends Error {}

export type MeResponse = {
  sub: string;
  email: string;
  email_verified?: boolean;
  name?: string | null;
  avatar?: string | null;
  organizations?: Array<{ id?: string; name?: string; role?: string }>;
  active_organization?: string | null;
};

export function serviceUrl(): string {
  return (process.env.AUTH_SERVICE_URL ?? "").replace(/\/+$/, "");
}

function timeoutMs(): number {
  return Math.max(1000, Number(process.env.AUTH_SERVICE_TIMEOUT_MS ?? 5000));
}

/** 5xx aj 429 sú výpadok, nie výrok o prístupe — musí sa to vyhodnotiť PRED `ok`. */
function assertNotAnOutage(response: Response): void {
  if (response.status >= 500 || response.status === 429) {
    throw new SsoUnavailable(`Prihlasovacia služba odpovedala ${response.status}.`);
  }
}

async function send(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs()) });
  } catch (error) {
    // Sem spadne timeout, DNS aj odmietnuté spojenie. Ani jedno nie je výrok o prístupe.
    throw new SsoUnavailable(`Prihlasovacia služba je nedostupná: ${String(error)}`);
  }
}

export async function fetchMe(accessToken: string): Promise<MeResponse> {
  const response = await send(`${serviceUrl()}/api/me`, {
    headers: { authorization: `Bearer ${accessToken}`, accept: "application/json" }
  });

  if (response.status === 401 || response.status === 403) {
    throw new SsoAuthFailed("Prihlasovacia služba zamietla access token.");
  }

  assertNotAnOutage(response);

  const data = (await response.json().catch(() => null)) as MeResponse | null;
  if (!data || typeof data.sub !== "string" || typeof data.email !== "string") {
    throw new SsoUnavailable("Prihlasovacia služba vrátila neznámy tvar claimov.");
  }

  return data;
}

export async function refreshTokens(
  refreshToken: string
): Promise<{ accessToken: string; refreshToken: string }> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: process.env.AUTH_SERVICE_CLIENT_ID ?? "",
    client_secret: process.env.AUTH_SERVICE_CLIENT_SECRET ?? ""
  });

  const response = await send(`${serviceUrl()}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: body.toString()
  });

  assertNotAnOutage(response);

  const data = (await response.json().catch(() => null)) as
    | { access_token?: string; refresh_token?: string; error?: string }
    | null;

  if (!response.ok) {
    const code = typeof data?.error === "string" && data.error !== "" ? data.error : "bez kódu";
    throw new SsoAuthFailed(`Prihlasovacia služba zamietla grant (${response.status}, ${code}).`);
  }

  if (typeof data?.access_token !== "string" || typeof data.refresh_token !== "string") {
    throw new SsoUnavailable("Prihlasovacia služba vrátila neznámy tvar tokenov.");
  }

  return { accessToken: data.access_token, refreshToken: data.refresh_token };
}
```

- [ ] **Krok 4: Spusti testy**

Spusti: `npm test`
Očakávaj: PASS (11 testov v tomto súbore + 1 smoke).
Spusti: `npx tsc --noEmit` → bez chýb.

- [ ] **Krok 5: Mutačná kontrola**

V `assertNotAnOutage` dočasne zmaž `|| response.status === 429`, spusti `npm test`
→ test `stav 429 je vypadok, nie zamietnutie` musí PADNÚŤ. Vráť späť → PASS.

Potom v `fetchMe` dočasne zmaž vetvu `if (response.status === 401 || response.status === 403)`,
spusti `npm test` → testy pre 401 a 403 musia PADNÚŤ. Vráť späť → PASS.

- [ ] **Krok 6: Commit**

```bash
git add src/lib/auth-service.ts src/lib/auth-service.test.ts
git commit -m "feat(auth): klient sluzby s rozlisenim 4xx a 5xx"
```

---

### Úloha 3: Tvar claimov v tokene

Čisté funkcie: splošťenie odpovede `/api/me` a veková aritmetika. Zámerne oddelené od Auth.js,
aby sa dali testovať bez jeho runtime.

**Súbory:**
- Vytvoriť: `src/lib/sso-claims.ts`, `src/lib/sso-claims.test.ts`

**Rozhrania:**
- Konzumuje: `MeResponse` z úlohy 2.
- Produkuje:
  - `type SsoClaims = { sub: string; email: string; emailVerified: boolean; name: string | null; avatar: string | null; organizationId: string | null; organizationName: string | null; role: string | null }`
  - `type SsoToken = { claims: SsoClaims; accessToken: string; refreshToken: string; refreshedAt: number; degradedSince?: number }`
  - `function claimsFromMe(data: MeResponse): SsoClaims`
  - `function claimsAgeSeconds(token: Pick<SsoToken, "refreshedAt">, nowMs: number): number`

- [ ] **Krok 1: Napíš padajúci test**

`src/lib/sso-claims.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { claimsAgeSeconds, claimsFromMe } from "@/lib/sso-claims";

describe("claimsFromMe", () => {
  it("splosti aktivnu firmu zo zoznamu", () => {
    const claims = claimsFromMe({
      sub: "01jbq2z9k7n4p6r8t0v2x4y6a8",
      email: "ja@firma.sk",
      email_verified: true,
      name: "Miro",
      avatar: null,
      organizations: [
        { id: "01jbq3aaaaaaaaaaaaaaaaaaaa", name: "Moja firma", role: "owner" },
        { id: "01jbq4bbbbbbbbbbbbbbbbbbbb", name: "Druha firma", role: "member" }
      ],
      active_organization: "01jbq4bbbbbbbbbbbbbbbbbbbb"
    });

    expect(claims.organizationId).toBe("01jbq4bbbbbbbbbbbbbbbbbbbb");
    expect(claims.organizationName).toBe("Druha firma");
    expect(claims.role).toBe("member");
    // `sub` musí prejsť nedotknutý — je to kľúč, na ktorý sa nakľúčuje budúca tabuľka
    // používateľských nastavení (filtre). Bez neho by tá fáza nemala na čom stáť.
    expect(claims.sub).toBe("01jbq2z9k7n4p6r8t0v2x4y6a8");
  });

  it("bez firmy nechava firemne polia null", () => {
    // Príde, keď človeka vyhodia z firmy v službe. Nesmie to padnúť ani si nič domyslieť.
    const claims = claimsFromMe({
      sub: "01jbq2z9k7n4p6r8t0v2x4y6a8",
      email: "ja@firma.sk",
      organizations: [],
      active_organization: null
    });

    expect(claims.organizationId).toBeNull();
    expect(claims.organizationName).toBeNull();
    expect(claims.emailVerified).toBe(false);
  });

  it("aktivna firma, ktora v zozname nie je, necha nazov null", () => {
    const claims = claimsFromMe({
      sub: "s",
      email: "e@f.sk",
      organizations: [{ id: "ina", name: "Ina", role: "owner" }],
      active_organization: "chybajuca"
    });

    expect(claims.organizationId).toBe("chybajuca");
    expect(claims.organizationName).toBeNull();
  });
});

describe("claimsAgeSeconds", () => {
  it("vracia vek v sekundach", () => {
    expect(claimsAgeSeconds({ refreshedAt: 1_000_000 }, 1_000_000 + 20_000)).toBe(20);
  });

  it("nikdy nie je negativny", () => {
    // Posun hodín dozadu nesmie vyrobiť „claimy z budúcnosti", ktoré by sa nikdy neobnovili.
    expect(claimsAgeSeconds({ refreshedAt: 2_000_000 }, 1_000_000)).toBe(0);
  });
});
```

- [ ] **Krok 2: Spusti a over, že padne**

Spusti: `npm test`
Očakávaj: FAIL — `Failed to resolve import "@/lib/sso-claims"`.

- [ ] **Krok 3: Implementácia**

`src/lib/sso-claims.ts`:

```ts
import type { MeResponse } from "@/lib/auth-service";

/**
 * Claimy, ako ich vidí appka. `sub` je JEDINÉ, čo sa niekedy dostane do budúcej databázy
 * (tabuľka používateľských nastavení) — a aj to ako referencia na používateľa v službe,
 * nie ako kópia jeho dát. Rovnaká úloha, akú má `connections.organization_id` v
 * payment_connectore.
 */
export type SsoClaims = {
  sub: string;
  email: string;
  emailVerified: boolean;
  name: string | null;
  avatar: string | null;
  organizationId: string | null;
  organizationName: string | null;
  role: string | null;
};

/** Tvar dát v šifrovanej cookie. Jediné miesto, ktoré ho pozná. */
export type SsoToken = {
  claims: SsoClaims;
  accessToken: string;
  refreshToken: string;
  /** Kedy sa claimy naposledy úspešne obnovili (ms). */
  refreshedAt: number;
  /** Okamih PRVÉHO zlyhania služby (ms). Chýba, keď je všetko v poriadku. */
  degradedSince?: number;
};

function text(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

/**
 * Sploští odpoveď `/api/me` na to, čo appka potrebuje. Prepínač firiem appka nemá, takže
 * z celého zoznamu si drží iba aktívnu firmu — ostatné by boli mŕtve dáta v cookie.
 */
export function claimsFromMe(data: MeResponse): SsoClaims {
  const active = text(data.active_organization);
  const organization = active === null ? undefined : data.organizations?.find((o) => o.id === active);

  return {
    sub: data.sub,
    email: data.email,
    emailVerified: data.email_verified === true,
    name: text(data.name),
    avatar: text(data.avatar),
    organizationId: active,
    organizationName: text(organization?.name),
    role: text(organization?.role)
  };
}

export function claimsAgeSeconds(token: Pick<SsoToken, "refreshedAt">, nowMs: number): number {
  return Math.max(0, Math.floor((nowMs - token.refreshedAt) / 1000));
}
```

- [ ] **Krok 4: Spusti testy**

Spusti: `npm test` → PASS
Spusti: `npx tsc --noEmit` → bez chýb

- [ ] **Krok 5: Mutačná kontrola**

V `claimsAgeSeconds` dočasne zmaž `Math.max(0, ...)`, spusti `npm test`
→ test `nikdy nie je negativny` musí PADNÚŤ. Vráť späť → PASS.

- [ ] **Krok 6: Commit**

```bash
git add src/lib/sso-claims.ts src/lib/sso-claims.test.ts
git commit -m "feat(auth): tvar claimov v tokene"
```

---

### Úloha 4: Rozhodovanie o obnove claimov

Najdrahšie miesto na chybu v celej fáze. Logika je vo **čistej funkcii** s vstreknutými
závislosťami, nie v Auth.js callbacku — inak by sa nedala otestovať bez frameworku a práve
tieto vetvy sa v testoch preskakujú najčastejšie.

**Súbory:**
- Vytvoriť: `src/lib/token-lifecycle.ts`, `src/lib/token-lifecycle.test.ts`

**Rozhrania:**
- Konzumuje: `SsoToken`, `claimsAgeSeconds`, `claimsFromMe` (úloha 3); `SsoAuthFailed`,
  `SsoUnavailable`, `fetchMe`, `refreshTokens` (úloha 2).
- Produkuje:
  - `type LifecycleDeps = { nowMs: number; claimsTtlSeconds: number; gracePeriodSeconds: number; refreshTokens: typeof refreshTokens; fetchMe: typeof fetchMe }`
  - `async function advanceToken(token: SsoToken, deps: LifecycleDeps): Promise<SsoToken | null>`
    — `null` znamená **odhlás**.

- [ ] **Krok 1: Napíš padajúci test**

`src/lib/token-lifecycle.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

import { SsoAuthFailed, SsoUnavailable } from "@/lib/auth-service";
import type { SsoToken } from "@/lib/sso-claims";
import { advanceToken, type LifecycleDeps } from "@/lib/token-lifecycle";

const NOW = 1_700_000_000_000;

function token(overrides: Partial<SsoToken> = {}): SsoToken {
  return {
    claims: {
      sub: "01jbq2z9k7n4p6r8t0v2x4y6a8",
      email: "ja@firma.sk",
      emailVerified: true,
      name: "Miro",
      avatar: null,
      organizationId: "01jbq3aaaaaaaaaaaaaaaaaaaa",
      organizationName: "Moja firma",
      role: "owner"
    },
    accessToken: "AT",
    refreshToken: "RT",
    refreshedAt: NOW,
    ...overrides
  };
}

function deps(overrides: Partial<LifecycleDeps> = {}): LifecycleDeps {
  return {
    nowMs: NOW,
    claimsTtlSeconds: 900,
    gracePeriodSeconds: 86400,
    refreshTokens: vi.fn(async () => ({ accessToken: "AT2", refreshToken: "RT2" })),
    fetchMe: vi.fn(async () => ({
      sub: "01jbq2z9k7n4p6r8t0v2x4y6a8",
      email: "ja@firma.sk",
      email_verified: true,
      name: "Miro Novy",
      organizations: [{ id: "01jbq3aaaaaaaaaaaaaaaaaaaa", name: "Moja firma", role: "owner" }],
      active_organization: "01jbq3aaaaaaaaaaaaaaaaaaaa"
    })),
    ...overrides
  };
}

describe("advanceToken", () => {
  it("sviezie claimy neobnovuje", async () => {
    const d = deps({ nowMs: NOW + 60_000 });

    const next = await advanceToken(token(), d);

    expect(next?.claims.name).toBe("Miro");
    expect(d.refreshTokens).not.toHaveBeenCalled();
    expect(d.fetchMe).not.toHaveBeenCalled();
  });

  it("po TTL obnovi tokeny aj claimy a posunie znacku casu", async () => {
    const d = deps({ nowMs: NOW + 16 * 60_000 });

    const next = await advanceToken(token(), d);

    expect(next?.claims.name).toBe("Miro Novy");
    expect(next?.accessToken).toBe("AT2");
    // Rotovaný refresh token sa MUSÍ uložiť, inak ďalšia obnova zlyhá.
    expect(next?.refreshToken).toBe("RT2");
    expect(next?.refreshedAt).toBe(NOW + 16 * 60_000);
  });

  it("zrusene konto odhlasi okamzite", async () => {
    const d = deps({
      nowMs: NOW + 16 * 60_000,
      refreshTokens: vi.fn(async () => {
        throw new SsoAuthFailed("invalid_grant");
      })
    });

    await expect(advanceToken(token(), d)).resolves.toBeNull();
  });

  it("vypadok sluzby nechava session zit", async () => {
    const d = deps({
      nowMs: NOW + 16 * 60_000,
      refreshTokens: vi.fn(async () => {
        throw new SsoUnavailable("503");
      })
    });

    const next = await advanceToken(token(), d);

    expect(next?.claims.name).toBe("Miro");
    expect(next?.degradedSince).toBe(NOW + 16 * 60_000);
  });

  it("druhe zlyhanie neprepise okamih prveho", async () => {
    // Grace period sa počíta od začiatku výpadku. Keby sa značka posúvala, pri výpadku
    // dlhšom ako TTL by sa hýbala pri každom requeste a nikdy by nevypršala.
    const first = NOW + 16 * 60_000;
    const d = deps({
      nowMs: first + 10 * 60_000,
      refreshTokens: vi.fn(async () => {
        throw new SsoUnavailable("503");
      })
    });

    const next = await advanceToken(token({ degradedSince: first }), d);

    expect(next?.degradedSince).toBe(first);
  });

  it("vypadok dlhsi nez grace period odhlasi", async () => {
    const first = NOW;
    const d = deps({
      nowMs: first + 25 * 60 * 60_000,
      refreshTokens: vi.fn(async () => {
        throw new SsoUnavailable("503");
      })
    });

    await expect(advanceToken(token({ degradedSince: first }), d)).resolves.toBeNull();
  });

  it("uspesna obnova zabudne vypadok", async () => {
    // Bez tohto by session, ktorá raz prežila výpadok, zomrela o 24 hodín neskôr,
    // aj keby medzitým sto obnov prešlo.
    const d = deps({ nowMs: NOW + 16 * 60_000 });

    const next = await advanceToken(token({ degradedSince: NOW }), d);

    expect(next?.degradedSince).toBeUndefined();
  });

  it("bez refresh tokenu odhlasi", async () => {
    const d = deps({ nowMs: NOW + 16 * 60_000 });

    await expect(advanceToken(token({ refreshToken: "" }), d)).resolves.toBeNull();
    expect(d.refreshTokens).not.toHaveBeenCalled();
  });
});
```

- [ ] **Krok 2: Spusti a over, že padne**

Spusti: `npm test`
Očakávaj: FAIL — `Failed to resolve import "@/lib/token-lifecycle"`.

- [ ] **Krok 3: Implementácia**

`src/lib/token-lifecycle.ts`:

```ts
import { type fetchMe, type refreshTokens, SsoAuthFailed, SsoUnavailable } from "@/lib/auth-service";
import { claimsAgeSeconds, claimsFromMe, type SsoToken } from "@/lib/sso-claims";

export type LifecycleDeps = {
  nowMs: number;
  claimsTtlSeconds: number;
  gracePeriodSeconds: number;
  refreshTokens: typeof refreshTokens;
  fetchMe: typeof fetchMe;
};

/**
 * Rozhodne, čo sa má stať s tokenom na tomto requeste. `null` znamená odhlás.
 *
 * Celé jadro je rozlíšenie dvoch zlyhaní. Bez neho by boli len dve možnosti a obe zlé: buď
 * pri každom výpadku služby odhlásiť všetkých, alebo nechať zrušené konto žiť ďalej.
 *
 * Závislosti sa vstrekujú, aby sa táto funkcia dala testovať bez Auth.js runtime aj bez siete.
 */
export async function advanceToken(token: SsoToken, deps: LifecycleDeps): Promise<SsoToken | null> {
  if (claimsAgeSeconds(token, deps.nowMs) < deps.claimsTtlSeconds) {
    return token;
  }

  if (token.refreshToken === "") {
    return null; // Nie je čím obnoviť.
  }

  try {
    const tokens = await deps.refreshTokens(token.refreshToken);
    const claims = claimsFromMe(await deps.fetchMe(tokens.accessToken));

    return {
      claims,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      refreshedAt: deps.nowMs
      // `degradedSince` sa zámerne nekopíruje — úspešná obnova ruší beh grace periody.
    };
  } catch (error) {
    if (error instanceof SsoAuthFailed) {
      return null;
    }

    if (!(error instanceof SsoUnavailable)) {
      throw error; // Neznáma chyba nie je výrok o prístupe ani o dostupnosti.
    }

    // Okamih PRVÉHO zlyhania sa nikdy neprepisuje.
    const degradedSince = token.degradedSince ?? deps.nowMs;

    if (deps.nowMs - degradedSince > deps.gracePeriodSeconds * 1000) {
      return null;
    }

    return { ...token, degradedSince };
  }
}
```

- [ ] **Krok 4: Spusti testy**

Spusti: `npm test` → PASS (8 testov v tomto súbore)
Spusti: `npx tsc --noEmit` → bez chýb

- [ ] **Krok 5: Mutačná kontrola (trikrát — toto je najdrahšie miesto na chybu)**

1. Vetvu `if (error instanceof SsoAuthFailed) return null;` dočasne zmaž → test
   `zrusene konto odhlasi okamzite` musí PADNÚŤ. Vráť → PASS.
2. `token.degradedSince ?? deps.nowMs` zmeň na `deps.nowMs` → test
   `druhe zlyhanie neprepise okamih prveho` musí PADNÚŤ. Vráť → PASS.
3. Porovnanie s `gracePeriodSeconds` dočasne zmaž (vždy vráť token) → test
   `vypadok dlhsi nez grace period odhlasi` musí PADNÚŤ. Vráť → PASS.

- [ ] **Krok 6: Commit**

```bash
git add src/lib/token-lifecycle.ts src/lib/token-lifecycle.test.ts
git commit -m "feat(auth): rozhodovanie o obnove claimov s grace period"
```

---

### Úloha 5: Verejné cesty a middleware

Deny-by-default. Rozhodovanie „je táto cesta verejná?" je čistá funkcia, aby sa dalo otestovať
bez Next runtime — a aby existoval regresný test, ktorý zachytí novú nechránenú route.

**Súbory:**
- Vytvoriť: `src/lib/public-paths.ts`, `src/lib/public-paths.test.ts`

**Rozhrania:**
- Produkuje: `function isPublicPath(pathname: string): boolean`

- [ ] **Krok 1: Napíš padajúci test**

`src/lib/public-paths.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { isPublicPath } from "@/lib/public-paths";

describe("isPublicPath", () => {
  it.each([
    "/api/auth/signin",
    "/api/auth/callback/krosdoplnky",
    "/api/auth/session",
    "/_next/static/chunks/main.js",
    "/favicon.ico",
    "/manifest.webmanifest",
    "/icon-192.png"
  ])("verejna: %s", (path) => {
    expect(isPublicPath(path)).toBe(true);
  });

  it.each(["/", "/cashflow", "/expenses", "/settings", "/kros", "/kros/callback", "/api/kros/logs", "/api/kros/payments"])(
    "chranena: %s",
    (path) => {
      expect(isPublicPath(path)).toBe(false);
    }
  );

  it("nova, nikdy nevymenovana route je chranena", () => {
    // Toto je dôvod, prečo je zoznam obrátený. Kým sa vymenúvali CHRÁNENÉ cesty, stačilo
    // pridať route a zabudnúť na ňu — presne tak visel `/api/kros/logs` verejne. Tento test
    // padne, keby sa niekto vrátil k allowlistu ochrany.
    expect(isPublicPath("/api/settings/filters")).toBe(false);
    expect(isPublicPath("/nieco/uplne/nove")).toBe(false);
  });

  it("cudzia cesta zacinajuca ako verejna nie je verejna", () => {
    // `/api/authorization-hack` nesmie prejsť len preto, že začína na `/api/auth`.
    expect(isPublicPath("/api/authorization-hack")).toBe(false);
  });
});
```

- [ ] **Krok 2: Spusti a over, že padne**

Spusti: `npm test`
Očakávaj: FAIL — `Failed to resolve import "@/lib/public-paths"`.

- [ ] **Krok 3: Implementácia**

`src/lib/public-paths.ts`:

```ts
/**
 * Zoznam VEREJNÝCH ciest, nie chránených — a to je celý zmysel tohto modulu.
 *
 * Kým sa vymenúvali chránené cesty, stačilo pridať novú route a zabudnúť ju doplniť; presne
 * tak visel `GET /api/kros/logs` verejne a vydával názvy firiem komukoľvek. Obrátený zoznam
 * znamená, že nová route je chránená v deň, kedy vznikne.
 *
 * Pridať sem niečo je vedomé rozhodnutie. Health endpoint appka dnes nemá; keby pribudol,
 * patrí sem — ale nech to niekto napíše naschvál, nie omylom.
 */
const PUBLIC_PREFIXES = [
  "/api/auth/", // handlery Auth.js: signin, callback, session, csrf
  "/_next/" // build assety Next.js
] as const;

const PUBLIC_EXACT = new Set(["/favicon.ico", "/manifest.webmanifest"]);

/** Statické súbory z `public/` — majú príponu a Next ich servíruje z koreňa. */
const PUBLIC_FILE = /\.(?:png|jpg|jpeg|svg|webp|ico|txt|xml|webmanifest|woff2?)$/i;

export function isPublicPath(pathname: string): boolean {
  if (PUBLIC_EXACT.has(pathname)) {
    return true;
  }

  if (PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
    return true;
  }

  return PUBLIC_FILE.test(pathname);
}
```

- [ ] **Krok 4: Spusti testy**

Spusti: `npm test` → PASS
Spusti: `npx tsc --noEmit` → bez chýb

- [ ] **Krok 5: Mutačná kontrola**

V `PUBLIC_PREFIXES` zmeň `"/api/auth/"` na `"/api/auth"` (bez koncového lomítka), spusti
`npm test` → test `cudzia cesta zacinajuca ako verejna nie je verejna` musí PADNÚŤ.
Vráť späť → PASS.

- [ ] **Krok 6: Commit**

```bash
git add src/lib/public-paths.ts src/lib/public-paths.test.ts
git commit -m "feat(auth): verejne cesty su vymenovane, chranene su vsetky ostatne"
```

---

### Úloha 6: Zapojenie Auth.js

Tu sa všetko spája. Rozhodovacia logika už je otestovaná v úlohách 2–5, takže tento kód je
tenká vrstva okolo nej — a to je zámer.

**Súbory:**
- Vytvoriť: `src/auth.ts`, `src/app/api/auth/[...nextauth]/route.ts`, `src/middleware.ts`
- Upraviť: `.env.example` (ak neexistuje, vytvoriť)

**Rozhrania:**
- Konzumuje: všetko z úloh 2–5.
- Produkuje: `handlers`, `auth`, `signIn`, `signOut` z `@/auth`.

- [ ] **Krok 1: Nainštaluj Auth.js**

```bash
npm install next-auth@5.0.0-beta.32
```

- [ ] **Krok 2: Over, že build s ňou prejde, PRED napísaním čohokoľvek ďalšieho**

Spusti: `npm run build`
Očakávaj: úspešný build.

> Toto je jediný krok tohto plánu, ktorý má právo zmeniť jeho zvyšok. `next-auth@5` je beta
> a hoci deklaruje `next: ^16`, deklarácia nie je dôkaz. Ak build padne na nekompatibilitu,
> **zastav a ohlás to** — spec má pripravenú náhradnú cestu (vlastný klient s `jose`), ktorá
> používa presne tie isté moduly z úloh 2–5, takže nič z doteraz napísaného sa nezahodí.

- [ ] **Krok 3: Konfigurácia Auth.js**

`src/auth.ts`:

```ts
import NextAuth from "next-auth";
import type { OAuth2Config } from "next-auth/providers";

import { fetchMe, type MeResponse, refreshTokens, serviceUrl } from "@/lib/auth-service";
import { claimsFromMe, type SsoToken } from "@/lib/sso-claims";
import { advanceToken } from "@/lib/token-lifecycle";

/**
 * Provider sa menuje `krosdoplnky`, NIE `kros`: appka už má `/api/kros/*` vo význame
 * „KROS ekonomické API" a rovnaké meno by pri čítaní kódu mýlilo.
 *
 * Vlastný provider, nie discovery — služba OIDC vrstvu nemá, takže `type: "oauth"`.
 * `scope` sa neposiela zámerne: služba scopy nepoužíva.
 */
function provider(): OAuth2Config<MeResponse> {
  return {
  id: "krosdoplnky",
  name: "KROS doplnky",
  type: "oauth",
  clientId: process.env.AUTH_SERVICE_CLIENT_ID,
  clientSecret: process.env.AUTH_SERVICE_CLIENT_SECRET,
  // PKCE aj `state` sú povinné. PKCE aj pri dôvernom klientovi so secretom — chráni pred
  // zneužitím kódu, ktorý unikol v logu proxy alebo v `Referer`.
  checks: ["pkce", "state"],
  authorization: `${serviceUrl()}/oauth/authorize`,
  token: `${serviceUrl()}/oauth/token`,
  userinfo: `${serviceUrl()}/api/me`,
  profile(profile) {
    return { id: profile.sub, email: profile.email, name: profile.name ?? null };
  }
  };
}

function seconds(name: string, fallback: number): number {
  const raw = Number(process.env[name]);

  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

/**
 * Konfigurácia je FUNKCIA, nie objekt — `NextAuth` to podporuje
 * (`config: NextAuthConfig | ((request) => Awaitable<NextAuthConfig>)`).
 *
 * Dôvod je prevádzkový: objekt na úrovni modulu by adresy endpointov zapiekol z premenných
 * dostupných v čase, keď Next modul prvý raz importuje — teda aj počas `next build`, kde
 * `AUTH_SERVICE_URL` byť nemusí. Vznikli by relatívne adresy typu `/oauth/authorize`
 * a prihlásenie by padalo až v produkcii. Funkcia sa vyhodnotí per request, s reálnym env.
 */
export const { handlers, auth, signIn, signOut } = NextAuth(() => ({
  providers: [provider()],
  // Bez databázy: claimy aj tokeny žijú v šifrovanej httpOnly cookie (JWE).
  session: { strategy: "jwt" },
  callbacks: {
    async jwt({ token, account, profile }) {
      // Prvé prihlásenie: `account` nesie tokeny, `profile` odpoveď z /api/me.
      if (account && profile) {
        const fresh: SsoToken = {
          claims: claimsFromMe(profile),
          accessToken: account.access_token ?? "",
          refreshToken: account.refresh_token ?? "",
          refreshedAt: Date.now()
        };

        return { ...token, ...fresh };
      }

      const next = await advanceToken(token as unknown as SsoToken, {
        nowMs: Date.now(),
        claimsTtlSeconds: seconds("AUTH_SERVICE_CLAIMS_TTL", 900),
        gracePeriodSeconds: seconds("AUTH_SERVICE_GRACE_PERIOD", 86400),
        refreshTokens,
        fetchMe
      });

      // `null` odhlási — Auth.js tak zahodí session.
      return next === null ? null : { ...token, ...next };
    },
    session({ session, token }) {
      const sso = token as unknown as SsoToken;

      // Do klienta ide identita a firma, NIKDY tokeny.
      return { ...session, claims: sso.claims };
    }
  }
}));
```

- [ ] **Krok 4: Route handler**

`src/app/api/auth/[...nextauth]/route.ts`:

```ts
import { handlers } from "@/auth";

// `NextAuth()` vracia `handlers: { GET, POST }` — App Router ich potrebuje ako pojmenované
// exporty tohto súboru. Overené proti typom next-auth@5.0.0-beta.32 (`NextAuthResult`).
export const { GET, POST } = handlers;
```

- [ ] **Krok 5: Middleware**

`src/middleware.ts`:

```ts
import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { isPublicPath } from "@/lib/public-paths";

/**
 * Deny-by-default: chránené je všetko, čo `isPublicPath()` neoznačí za verejné.
 * Nikdy tu nevymenúvaj chránené cesty — pozri komentár v `src/lib/public-paths.ts`.
 */
export default auth((request) => {
  if (isPublicPath(request.nextUrl.pathname)) {
    return NextResponse.next();
  }

  if (request.auth) {
    return NextResponse.next();
  }

  // API vracia 401, nie redirect: presmerovanie na HTML prihlasovaciu obrazovku by
  // z fetch volania spravilo nezrozumiteľnú chybu parsovania JSON.
  if (request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Neprihlásený" }, { status: 401 });
  }

  const signIn = new URL("/api/auth/signin", request.nextUrl.origin);
  signIn.searchParams.set("callbackUrl", request.nextUrl.pathname + request.nextUrl.search);

  return NextResponse.redirect(signIn);
});

export const config = {
  // Matcher zámerne berie VŠETKO. Rozhodovanie robí isPublicPath(), aby existovalo
  // jedno miesto pravdy a dal sa naň napísať test.
  matcher: ["/((?!_next/static|_next/image).*)"]
};
```

- [ ] **Krok 6: Premenné prostredia**

`.env.example`:

```
# Zdieľané prihlásenie (authentication_service)
AUTH_SERVICE_URL=https://login.krosdoplnky.sk
AUTH_SERVICE_CLIENT_ID=
AUTH_SERVICE_CLIENT_SECRET=
# Voliteľné, defaulty sedia s TTL v službe
# AUTH_SERVICE_CLAIMS_TTL=900
# AUTH_SERVICE_GRACE_PERIOD=86400
# AUTH_SERVICE_TIMEOUT_MS=5000

# Auth.js ním šifruje session cookie. Bez neho sa appka nerozbehne.
# Vygeneruj: openssl rand -base64 32
AUTH_SECRET=

# Musí byť presne táto hodnota — Passport validuje redirect URI presnou zhodou.
AUTH_URL=https://prehlady.krosdoplnky.sk
```

- [ ] **Krok 7: Over**

Spusti: `npm test` → PASS (všetky doterajšie testy)
Spusti: `npx tsc --noEmit` → bez chýb
Spusti: `npm run lint` → bez nových chýb
Spusti: `npm run build` → úspešný build

- [ ] **Krok 8: Commit**

```bash
git add src/auth.ts src/app/api/auth src/middleware.ts .env.example package.json package-lock.json
git commit -m "feat(auth): prihlasenie cez zdielanu sluzbu, middleware chrani vsetko"
```

---

### Úloha 7: Odhlásenie s návratom do appky

Bez `?app=` služba po ďalšom prihlásení nemá kam vrátiť a vysype človeka na svoj profil.
Presne to sa dialo `payment_connectoru`, kým sa ten parameter neposielal.

**Súbory:**
- Vytvoriť: `src/lib/sign-out-url.ts`, `src/lib/sign-out-url.test.ts`

**Rozhrania:**
- Produkuje: `function serviceSignOutUrl(): string`

- [ ] **Krok 1: Napíš padajúci test**

`src/lib/sign-out-url.test.ts`:

```ts
import { afterEach, describe, expect, it } from "vitest";

import { serviceSignOutUrl } from "@/lib/sign-out-url";

const original = { ...process.env };

afterEach(() => {
  process.env = { ...original };
});

describe("serviceSignOutUrl", () => {
  it("posiela kluc appky, aby sa dalsie prihlasenie vratilo sem", () => {
    process.env.AUTH_SERVICE_URL = "https://login.test/";
    delete process.env.AUTH_SERVICE_APP_KEY;

    expect(serviceSignOutUrl()).toBe("https://login.test/logout?app=prehlady");
  });

  it("kluc appky sa da prekonfigurovat", () => {
    process.env.AUTH_SERVICE_URL = "https://login.test";
    process.env.AUTH_SERVICE_APP_KEY = "ine";

    expect(serviceSignOutUrl()).toBe("https://login.test/logout?app=ine");
  });
});
```

- [ ] **Krok 2: Spusti a over, že padne**

Spusti: `npm test`
Očakávaj: FAIL — `Failed to resolve import "@/lib/sign-out-url"`.

- [ ] **Krok 3: Implementácia**

`src/lib/sign-out-url.ts`:

```ts
import { serviceUrl } from "@/lib/auth-service";

/**
 * Odhlásenie musí zrušiť aj session v službe, inak by ďalšie kliknutie na „Prihlásiť sa"
 * ticho prihlásilo toho istého človeka späť.
 *
 * `?app=` je tu podstatné: povie službe, z ktorej appky človek odchádza, takže opätovné
 * prihlásenie ho vráti sem a nie na profil služby. Kľúč musí existovať v allowliste
 * `AUTH_RETURN_APPS` na strane služby, inak sa vyhodnotí ako neznámy a nič sa nestane.
 */
export function serviceSignOutUrl(): string {
  const app = process.env.AUTH_SERVICE_APP_KEY ?? "prehlady";

  return `${serviceUrl()}/logout?app=${encodeURIComponent(app)}`;
}
```

- [ ] **Krok 4: Server action, ktorá odhlási**

Odhlásenie musí zbehnúť na serveri (`signOut` z `@/auth` je serverová funkcia).

`src/app/actions/sign-out.ts`:

```ts
"use server";

import { signOut } from "@/auth";
import { serviceSignOutUrl } from "@/lib/sign-out-url";

export async function signOutAction(): Promise<void> {
  // `redirectTo` vedie do služby, nie na stránku appky: session musí zaniknúť na oboch
  // stranách, inak by ďalšie kliknutie na „Prihlásiť sa" ticho prihlásilo toho istého
  // človeka späť.
  await signOut({ redirectTo: serviceSignOutUrl() });
}
```

- [ ] **Krok 5: Tlačidlo do hlavičky**

Hlavička je v `src/components/dashboard-shell.tsx`, element `<header className="app-header">`
(riadok ~75). Hneď za tlačidlo obnovy (`className="header-refresh-btn"`, riadok ~99) pridaj:

```tsx
<form action={signOutAction}>
  <button type="submit" className="header-refresh-btn" aria-label="Odhlásiť sa">
    Odhlásiť sa
  </button>
</form>
```

a na začiatok súboru import:

```ts
import { signOutAction } from "@/app/actions/sign-out";
```

> `header-refresh-btn` je použitá zámerne — je to existujúca trieda hlavičkového tlačidla
> v tejto appke, takže tlačidlo zapadne bez nového CSS. Ak dizajn potrebuje niečo iné, je to
> zmena triedy, nie logiky.

- [ ] **Krok 6: Over**

Spusti: `npm test` → PASS
Spusti: `npx tsc --noEmit` → bez chýb
Spusti: `npm run build` → úspešný build

- [ ] **Krok 7: Commit**

```bash
git add src/lib/sign-out-url.ts src/lib/sign-out-url.test.ts src/app/actions/sign-out.ts src/components/dashboard-shell.tsx
git commit -m "feat(auth): odhlasenie povie sluzbe, z ktorej appky clovek odchadza"
```

---

### Úloha 8: Runbook a predpoklady nasadenia

Musí vzniknúť **pred** nasadením, nie po ňom. Bez krokov 1–3 sa do appky po nasadení
nedostane nikto.

**Súbory:**
- Vytvoriť: `docs/SSO-prechod.md`
- Upraviť: `README.md`

- [ ] **Krok 1: Napíš `docs/SSO-prechod.md`**

Dokument so štyrmi časťami:

1. **Registrácia OAuth klienta v službe.** V kontajneri `login.krosdoplnky.sk`:

```bash
cd /var/www/html && php artisan passport:client --public=0 --name="KROS prehlady" --redirect_uri="https://prehlady.krosdoplnky.sk/api/auth/callback/krosdoplnky"
```

`--public=0` je podstatné: appka posiela `client_secret`. Verejnému klientovi (`secret` NULL)
by Passport odpovedal `invalid_client`. Passport 13 rozhoduje o dôvernosti čisto podľa
`! empty($secret)`.

2. **Premenné v službe.** Do Dokploy Environment **služby**:
   - `PASSPORT_TRUSTED_CLIENTS` doplniť o nové client ID (inak 403 namiesto preskočeného consentu)
   - `AUTH_RETURN_APPS` doplniť o `prehlady=https://prehlady.krosdoplnky.sk`
   - potom **redeploy, nie restart**

   Overiť: `php artisan auth:check-config`

3. **Premenné v appke.** Do Dokploy Environment **appky**: `AUTH_SERVICE_URL`,
   `AUTH_SERVICE_CLIENT_ID`, `AUTH_SERVICE_CLIENT_SECRET`, `AUTH_SECRET`, `AUTH_URL`.
   `AUTH_SECRET` vygeneruj `openssl rand -base64 32`.

4. **Overovací checklist po nasadení** — tabuľka s miestom na výsledok každého bodu:

| # | čo overiť | výsledok |
|---|---|---|
| 1 | `https://prehlady.krosdoplnky.sk` neprihlásený → presmeruje do služby | _(nevyplnené)_ |
| 2 | Prihlásenie → návrat do appky, prehľady sa načítajú | _(nevyplnené)_ |
| 3 | `curl https://prehlady.krosdoplnky.sk/api/kros/logs` bez session → **401**, nie dáta | _(nevyplnené)_ |
| 4 | Odhlásenie → opätovné prihlásenie vráti späť do appky, nie na profil služby | _(nevyplnené)_ |
| 5 | Po ~16 min klikania človek ostane prihlásený (obnova claimov funguje) | _(nevyplnené)_ |
| 6 | Statické assety a `/api/auth/*` fungujú aj bez session | _(nevyplnené)_ |

Bod 3 je ten, kvôli ktorému celá fáza vznikla.

- [ ] **Krok 2: Doplň `README.md`**

Sekcia „Prihlásenie" s vetou, že identitu vlastní `authentication_service`, odkazom na
`docs/SSO-prechod.md`, a poznámkou, že appka nemá vlastné prihlasovacie obrazovky.

- [ ] **Krok 3: Commit**

```bash
git add docs/SSO-prechod.md README.md
git commit -m "docs: runbook prechodu na zdielane prihlasenie"
```

---

## Čo tento plán vedome nerieši

- **Presun KROS pripojení zo `localStorage`** do server-side per-user úložiska. Zákazníkove
  KROS tokeny ostávajú v prehliadači — po tejto fáze je to najslabšie miesto appky.
- **Databáza na pamätanie filtrov.** Príde samostatne a bude sa kľúčovať `sub`-om z claimov.
- **`POST /api/kros/oauth-state`** — po tejto fáze bude za prihlásením, ale samotná slabosť
  (ktokoľvek prihlásený zaregistruje ľubovoľný `state`) ostáva.
- **`runtime-logs/` nie je v `.gitignore`.** Jeden `git add -A` od toho, aby boli názvy firiem
  v histórii repa. Jednoriadková oprava, ale mimo rozsahu tejto fázy.
- **Prepínač firiem v UI.** Appka berie `active_organization` a nič iné; človek v dvoch firmách
  vidí vždy tú s nižším ULID.

## Poznatky z fázy 2, ktoré tu platia

- **Pred nasadením pusti testy v čistom git worktree presne na tom commite, ktorý ide von** —
  nie v pracovnom strome, kde ich môžu maskovať rozrobené súbory. Fáza 2 takto do produkcie
  poslala cudzí test a rebase artefakt.
- **Prečítaj `payment_connector/docs/SSO-prechod.md`** sekciu „Čo sa pri ostrom prechode
  pokazilo" **pred** nasadením. Fáza 2 zaplatila výpadkom za chybu, ktorá tam bola popísaná.
- **Deklarovaná podpora nie je dôkaz.** `next-auth` deklaruje `next: ^16`; overuje to až build
  v úlohe 6, krok 2.
