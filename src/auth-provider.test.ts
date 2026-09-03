import { describe, expect, it } from "vitest";

import { provider } from "@/auth-provider";

/**
 * Tvar authorize requestu rozhoduje, či sa vôbec dá prihlásiť, a chyba v ňom je viditeľná
 * až v produkcii — služba odpovie `invalid_scope` ešte pred consent obrazovkou.
 *
 * Test ZÁMERNE pretláča našu konfiguráciu cez `parseProviders` z `@auth/core`, teda cez ten
 * istý kód, ktorý beží za behu (`normalizeOAuth` v ňom scope dopĺňa). Kontrolovať len náš
 * objekt by nestačilo: chybou nebolo, čo píšeme, ale čo za nás doplní knižnica. Import ide
 * po ceste do `node_modules`, pretože `lib/utils/providers.js` nie je v `exports` balíka —
 * ak sa cesta pri aktualizácii `@auth/core` pohne, tento test padne, a to je presne ten
 * signál, že tvar authorize requestu treba znova overiť.
 */
type NormalizedProvider = { id: string; authorization?: { url: URL } };
type ParseProviders = (params: {
  url: URL;
  providerId: string;
  config: { basePath: string; providers: unknown[] };
}) => { provider?: NormalizedProvider };

const parseProviders = (
  (await import("../node_modules/@auth/core/lib/utils/providers.js")) as {
    default: ParseProviders;
  }
).default;

function authorizeUrl(): URL {
  process.env.AUTH_SERVICE_URL = "https://login.test";

  const { provider: normalized } = parseProviders({
    url: new URL("https://prehlady.test/api/auth"),
    providerId: "krosdoplnky",
    config: { basePath: "/api/auth", providers: [provider()] }
  });

  if (normalized?.authorization === undefined) {
    throw new Error("provider krosdoplnky nemá authorization endpoint");
  }

  return normalized.authorization.url;
}

describe("provider krosdoplnky", () => {
  it("authorize request nepyta ziadny scope", () => {
    // Služba nemá zaregistrovaný ani jeden scope (`Passport::$scopes` je prázdne pole),
    // takže `openid`/`profile`/`email` by skončili ako `invalid_scope` a prihlásiť sa
    // nedalo vôbec.
    const scope = authorizeUrl().searchParams.get("scope");

    expect(scope).toBe("");
    expect(scope).not.toContain("openid");
    expect(scope).not.toContain("profile");
    expect(scope).not.toContain("email");
  });

  it("authorize ide na endpoint sluzby", () => {
    // Keby sa `params` pridali bez `url`, `normalizeEndpoint` použije `https://authjs.dev`
    // ako výplň — prihlásenie by odišlo na cudzí origin.
    const url = authorizeUrl();

    expect(url.origin).toBe("https://login.test");
    expect(url.pathname).toBe("/oauth/authorize");
  });
});
