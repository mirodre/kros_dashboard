import type { JWT } from "next-auth/jwt";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { SsoToken } from "@/lib/sso-claims";

/**
 * Testy CELÉHO SPOJENIA, nie jednotlivých čistých funkcií. `advanceToken` má vlastnú sadu
 * a prechádzala aj vtedy, keď sa výsledok pri ukladaní pokazil spreadom — chyba žila presne
 * v tom, čo `jwtCallback` naozaj vráti Auth.js. Preto sa tu volá callback tak, ako ho volá
 * `@auth/core`, a kontroluje sa objekt, ktorý ide do cookie.
 *
 * Mockuje sa MODUL `@/lib/auth-service` (rovnaký vzor ako `src/app/actions/sign-out.test.ts`),
 * nie HTTP. `importOriginal` je podstatné: `SsoAuthFailed`/`SsoUnavailable` musia ostať tie
 * pravé triedy, inak by `instanceof` v `advanceToken` neplatil a testy by merali fikciu.
 */
const { refreshTokensMock, fetchMeMock } = vi.hoisted(() => ({
  refreshTokensMock: vi.fn(),
  fetchMeMock: vi.fn()
}));

vi.mock("@/lib/auth-service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth-service")>()),
  refreshTokens: refreshTokensMock,
  fetchMe: fetchMeMock
}));

const { jwtCallback, sessionCallback } = await import("@/auth-callbacks");

const ME = {
  sub: "01jbq2z9k7n4p6r8t0v2x4y6a8",
  email: "ja@firma.sk",
  email_verified: true,
  name: "Miro Novy",
  organizations: [{ id: "01jbq3aaaaaaaaaaaaaaaaaaaa", name: "Moja firma", role: "owner" }],
  active_organization: "01jbq3aaaaaaaaaaaaaaaaaaaa"
};

/** Token, ktorého claimy sú starší ako TTL (900 s), takže callback musí obnovovať. */
function staleToken(overrides: Partial<SsoToken> = {}): JWT {
  const token: SsoToken = {
    claims: {
      sub: ME.sub,
      email: ME.email,
      emailVerified: true,
      name: "Miro",
      avatar: null,
      organizationId: "01jbq3aaaaaaaaaaaaaaaaaaaa",
      organizationName: "Moja firma",
      role: "owner"
    },
    accessToken: "AT",
    refreshToken: "RT",
    refreshedAt: Date.now() - 16 * 60_000,
    ...overrides
  };

  return token as unknown as JWT;
}

afterEach(() => {
  refreshTokensMock.mockReset();
  fetchMeMock.mockReset();
});

describe("jwtCallback", () => {
  it("uspesna obnova zmaze degradedSince aj z ulozeneho tokenu", async () => {
    // Regresia: `advanceToken` kľúč `degradedSince` na úspešnej ceste len nekopíroval,
    // ale volajúci skladá `{ ...token, ...next }` — a spread chýbajúcim kľúčom starú
    // hodnotu nezmaže. Pondelkový blip tak prežil v cookie navždy.
    refreshTokensMock.mockResolvedValue({ accessToken: "AT2", refreshToken: "RT2" });
    fetchMeMock.mockResolvedValue(ME);

    const next = await jwtCallback({
      token: staleToken({ refreshToken: "RT-degradovany", degradedSince: Date.now() - 3 * 24 * 3600_000 }),
      account: null
    });

    expect(next?.degradedSince).toBeUndefined();
    // A naozaj vypadne aj zo serializácie, ktorou Auth.js token šifruje do cookie.
    expect(JSON.parse(JSON.stringify(next))).not.toHaveProperty("degradedSince");
  });

  it("patminutovy vypadok neodhlasi session, ktora uz raz vypadok prezila", async () => {
    // Hlavná požiadavka plánu, na úrovni spojenia. Kým `degradedSince` prežíval, session
    // s pondelkovým blipom v cookie sa v stredu odhlásila pri PRVOM neúspešnom obnovení.
    const monday = Date.now() - 3 * 24 * 3600_000;

    refreshTokensMock.mockResolvedValueOnce({ accessToken: "AT2", refreshToken: "RT2" });
    fetchMeMock.mockResolvedValueOnce(ME);

    const healthy = await jwtCallback({
      token: staleToken({ refreshToken: "RT-streda", degradedSince: monday }),
      account: null
    });

    const { SsoUnavailable } = await import("@/lib/auth-service");
    refreshTokensMock.mockRejectedValueOnce(new SsoUnavailable("503"));

    const outage = await jwtCallback({
      token: { ...healthy, refreshedAt: Date.now() - 16 * 60_000 } as JWT,
      account: null
    });

    // Session žije a grace period sa počíta od TOHTO výpadku, nie od pondelka.
    expect(outage).not.toBeNull();
    expect(outage?.degradedSince).toBeGreaterThan(monday);
    expect(outage?.accessToken).toBe("AT2");
  });

  it("dva subezne requesty s tym istym zvetranym tokenom obnovia tokeny raz", async () => {
    // To iste ako v `token-lifecycle.test.ts`, ale na SPOJENI: dokazuje, ze deduplikacia
    // je naozaj zapojena v `src/auth-callbacks.ts`, nie len ze existuje. Bez nej by druhy
    // request pouzil uz revokovany refresh token, dostal 4xx a cloveka by to odhlasilo.
    let releaseRefresh!: (tokens: { accessToken: string; refreshToken: string }) => void;
    const rotated = new Promise<{ accessToken: string; refreshToken: string }>((resolve) => {
      releaseRefresh = resolve;
    });
    refreshTokensMock.mockReturnValue(rotated);
    fetchMeMock.mockResolvedValue(ME);

    const both = Promise.all([
      jwtCallback({ token: staleToken({ refreshToken: "RT-subezne" }), account: null }),
      jwtCallback({ token: staleToken({ refreshToken: "RT-subezne" }), account: null })
    ]);
    releaseRefresh({ accessToken: "AT2", refreshToken: "RT2" });
    const [first, second] = await both;

    expect(refreshTokensMock).toHaveBeenCalledTimes(1);
    expect(refreshTokensMock).toHaveBeenCalledWith("RT-subezne");
    // Obe session ziju a obe maju rotovany par.
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(first?.refreshToken).toBe("RT2");
    expect(second?.refreshToken).toBe("RT2");
  });

  it("neskory request po skonceni obnovy dostane ten isty rotovany par", async () => {
    // Rotovana Set-Cookie odchadza az na odpovedi requestu, ktory obnovu spustil, a ta moze
    // pri proxovani na api-economy.kros.sk visiet sekundy. Neskory request (klik, prefetch)
    // teda pride este s POVODNOU cookie — a bez retencie by zavolal token endpoint tokenom,
    // ktory sluzba uz revokovala, dostal invalid_grant a session by zomrela.
    refreshTokensMock.mockResolvedValue({ accessToken: "AT2", refreshToken: "RT2" });
    fetchMeMock.mockResolvedValue(ME);

    const first = await jwtCallback({
      token: staleToken({ refreshToken: "RT-neskory" }),
      account: null
    });
    const late = await jwtCallback({
      token: staleToken({ refreshToken: "RT-neskory" }),
      account: null
    });

    expect(refreshTokensMock).toHaveBeenCalledTimes(1);
    expect(first?.refreshToken).toBe("RT2");
    expect(late?.refreshToken).toBe("RT2");
  });

  it("prve prihlasenie ulozi claimy z /api/me a tokeny z accountu", async () => {
    const next = await jwtCallback({
      token: { sub: "auth-js-vlastne-sub" } as unknown as JWT,
      account: { provider: "krosdoplnky", access_token: "AT1", refresh_token: "RT1" } as never,
      profile: ME as never
    });

    expect(next?.claims).toMatchObject({ sub: ME.sub, email: ME.email, name: "Miro Novy" });
    expect(next?.accessToken).toBe("AT1");
    expect(next?.refreshToken).toBe("RT1");
    // Bez znacky casu by prvy dalsi request obnovoval hned.
    expect(next?.refreshedAt).toBeGreaterThan(0);
    expect(refreshTokensMock).not.toHaveBeenCalled();
  });

  it("zamietnuty grant vrati null, cim Auth.js session zahodi", async () => {
    const { SsoAuthFailed } = await import("@/lib/auth-service");
    refreshTokensMock.mockRejectedValue(new SsoAuthFailed("invalid_grant"));

    await expect(
      jwtCallback({ token: staleToken({ refreshToken: "RT-zamietnuty" }), account: null })
    ).resolves.toBeNull();
  });
});

describe("sessionCallback", () => {
  const session = { expires: "2026-09-30T00:00:00.000Z", user: { name: "Miro", email: ME.email } };

  it("do session nikdy nepusti access ani refresh token", () => {
    const result = sessionCallback({
      session: session as never,
      token: staleToken({ accessToken: "TAJNY-AT", refreshToken: "TAJNY-RT" })
    });

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("TAJNY-AT");
    expect(serialized).not.toContain("TAJNY-RT");
    expect(serialized).not.toContain("accessToken");
    expect(serialized).not.toContain("refreshToken");
  });

  it("session.user sa nerozchadza s claimami", () => {
    // `{ ...token, ...next }` nikdy neaktualizuje `token.name`/`token.email`, z ktorych si
    // Auth.js sklada `user`, a `user.id` je uz od zaciatku nahodne UUID. Bez tohto prepisu
    // by `session.user.email` bol po prvej obnove natrvalo zvetrany.
    const result = sessionCallback({
      session: { ...session, user: { name: "Stare Meno", email: "stary@firma.sk" } } as never,
      token: staleToken()
    });

    expect(result.user?.email).toBe(result.claims.email);
    expect(result.user?.name).toBe(result.claims.name);
    expect(result.user?.id).toBe(result.claims.sub);
  });

  it("claims.sub je v session dostupny", () => {
    // Predpoklad buducich per-user dat: `sub` je jedina identita, ktora sa niekedy dostane
    // do vlastnej tabulky.
    const result = sessionCallback({ session: session as never, token: staleToken() });

    expect(result.claims.sub).toBe(ME.sub);
    expect(result.claims.organizationId).toBe("01jbq3aaaaaaaaaaaaaaaaaaaa");
  });
});
