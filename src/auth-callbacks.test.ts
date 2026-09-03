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

const { jwtCallback } = await import("@/auth-callbacks");

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
      token: staleToken({ degradedSince: Date.now() - 3 * 24 * 3600_000 }),
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
      token: staleToken({ degradedSince: monday }),
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
});
