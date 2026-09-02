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

    const [, init] = spy.mock.calls[0] as unknown as [string, RequestInit];
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer AT");
  });

  it.each([401, 403])("stav %i je zamietnutie, nie vypadok", async (status) => {
    vi.stubGlobal("fetch", vi.fn(async () => respond(status, { error: "nope" })));

    await expect(fetchMe("AT")).rejects.toBeInstanceOf(SsoAuthFailed);
  });

  it.each([500, 502, 503, 429])("stav %i je vypadok, nie zamietnutie", async (status) => {
    vi.stubGlobal("fetch", vi.fn(async () => respond(status, "nginx")));

    // Bez kontroly spravy prejde test aj keby JSON parsing neuspel.
    // Regex skontroluje, ze chyba pochadzala z assertNotAnOutage, nie z fallback.
    try {
      await fetchMe("AT");
      throw new Error("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(SsoUnavailable);
      expect((error as Error).message).toMatch(new RegExp(String(status)));
    }
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

    const [url, init] = spy.mock.calls[0] as unknown as [string, RequestInit];
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
