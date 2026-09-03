import { describe, expect, it, vi } from "vitest";

import { SsoAuthFailed, SsoUnavailable } from "@/lib/auth-service";
import { singleFlight } from "@/lib/single-flight";
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

  it("zlyhanie fetchMe po rotacii nestrati novy refresh token", async () => {
    // Sluzba stary refresh token pri rotacii revokuje. Keby degradovana vetva vratila
    // povodny token, v cookie by ostal uz zruseny token a hned dalsia obnova by dostala
    // invalid_grant → odhlasenie. Grace period by v presne tej situacii, pre ktoru
    // existuje, nekupila nic.
    const d = deps({
      nowMs: NOW + 16 * 60_000,
      fetchMe: vi.fn(async () => {
        throw new SsoUnavailable("503");
      })
    });

    const next = await advanceToken(token(), d);

    expect(next?.accessToken).toBe("AT2");
    expect(next?.refreshToken).toBe("RT2");
    // Claimy sa precitat nepodarilo, takze ostavaju stare — a znacka casu sa nehybe,
    // aby dalsi request obnovu skusil znova.
    expect(next?.claims.name).toBe("Miro");
    expect(next?.refreshedAt).toBe(NOW);
    expect(next?.degradedSince).toBe(NOW + 16 * 60_000);
  });

  it("dva subezne requesty s tym istym zvetranym tokenom obnovia tokeny raz", async () => {
    // Toto je celá chyba R1 v jednom teste. Session je len cookie, takže súbežné requesty
    // dekódujú ten istý stav a bez deduplikácie by obnovu spustil každý z nich s TÝM ISTÝM
    // refresh tokenom. Passport ho pri rotácii revokuje, takže druhé použitie skončí
    // `SsoAuthFailed` a človeka to odhlási.
    let releaseRefresh!: (tokens: { accessToken: string; refreshToken: string }) => void;
    const rotated = new Promise<{ accessToken: string; refreshToken: string }>((resolve) => {
      releaseRefresh = resolve;
    });
    const refresh = vi.fn(async () => rotated);
    const d = deps({
      nowMs: NOW + 16 * 60_000,
      refreshTokens: singleFlight(refresh, { retainMs: 60_000, nowMs: () => NOW })
    });

    const both = Promise.all([advanceToken(token(), d), advanceToken(token(), d)]);
    releaseRefresh({ accessToken: "AT2", refreshToken: "RT2" });
    const [first, second] = await both;

    expect(refresh).toHaveBeenCalledTimes(1);
    // Obe session žijú a obe majú rotovaný pár — ani jedna nedostala `null`.
    expect(first?.refreshToken).toBe("RT2");
    expect(second?.refreshToken).toBe("RT2");
    expect(first?.accessToken).toBe("AT2");
    expect(second?.accessToken).toBe("AT2");
    // `fetchMe` sa ZÁMERNE nededuplikuje: je to idempotentné GET s rotovaným access
    // tokenom, opakovanie nič nerotuje a každý request tak má vlastný pokus.
    expect(d.fetchMe).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["prazdny", ""],
    ["chybajuci", undefined]
  ])("%s refresh token odhlasi bez volania sluzby", async (_popis, value) => {
    // `undefined` je realny tvar z cookie, ked odpoved sluzby refresh token neobsahovala.
    // Bez guardu by sa zavolalo refreshTokens(undefined), sluzba by to zamietla ako
    // SsoAuthFailed a clovek by dostal odhlasenie namiesto cisteho "nie je cim obnovit".
    const d = deps({ nowMs: NOW + 16 * 60_000 });
    const stale = token({ refreshToken: value as unknown as string });

    await expect(advanceToken(stale, d)).resolves.toBeNull();
    expect(d.refreshTokens).not.toHaveBeenCalled();
  });
});
