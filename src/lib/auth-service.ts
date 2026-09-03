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
  const raw = (process.env.AUTH_SERVICE_URL ?? "").trim().replace(/\/+$/, "");

  // Rovnaká trieda chyby ako neplatný `AUTH_SERVICE_TIMEOUT_MS`, len tu žiadny rozumný
  // default neexistuje. Kým sa vracal prázdny reťazec, vznikali relatívne adresy typu
  // `/api/me` a `/oauth/token`; prejavilo sa to až generickou Configuration stránkou
  // Auth.js, z ktorej sa nedá zistiť, čo chýba. Chybná konfigurácia nie je ani výpadok,
  // ani výrok o prístupe, takže sa hodí von: `advanceToken` neznámu chybu vedome
  // preposiela ďalej a nikoho neodhlási.
  if (!/^https?:\/\/[^/\s]+(\/\S*)?$/.test(raw)) {
    throw new Error(
      "AUTH_SERVICE_URL nie je nastavená na absolútnu adresu prihlasovacej služby (napr. https://login.krosdoplnky.sk)."
    );
  }

  return raw;
}

function timeoutMs(): number {
  const raw = Number(process.env.AUTH_SERVICE_TIMEOUT_MS);

  // Hodnota sa musí validovať, nie len obmedziť zdola: `Math.max(1000, NaN)` je `NaN`
  // a `AbortSignal.timeout(NaN)` v Node 20 hodí `RangeError`, ktorý `send()` nižšie prekryje
  // na `SsoUnavailable`. Preklep v premennej (`abc`, `5 s`) by teda vyzeral ako trvalý
  // výpadok služby: nikto by sa neprihlásil a existujúce session by po grace perióde
  // ticho dožili. Rovnaký guard ako `seconds()` v `src/auth-callbacks.ts`.
  const configured = Number.isFinite(raw) && raw > 0 ? raw : 5000;

  return Math.max(1000, configured);
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
