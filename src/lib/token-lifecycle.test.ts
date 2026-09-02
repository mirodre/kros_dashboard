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

  it("neznama chyba sa preposle dalej", async () => {
    // Chyba, ktorá nie je ani SsoAuthFailed, ani SsoUnavailable, nie je výrok o prístupe
    // ani o dostupnosti. Prehltnúť by ju znamenalo buď zbytočne odhlásiť, alebo držať
    // nažive session pri bugu, čo s prístupom ani dostupnosťou nemá nič spoločné.
    const d = deps({
      nowMs: NOW + 16 * 60_000,
      refreshTokens: vi.fn(async () => {
        throw new Error("boom");
      })
    });

    await expect(advanceToken(token(), d)).rejects.toThrow("boom");
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
