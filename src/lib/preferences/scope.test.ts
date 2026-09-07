import { describe, expect, it } from "vitest";

import { preferenceScope, scopeFromBinding } from "@/lib/preferences/scope";

const sub = "01jbq2z9k7n4p6r8t0v2x4y6a8";

describe("preferenceScope", () => {
  it("clen firmy dostane tenant scope", () => {
    const scope = preferenceScope({
      sub,
      organizationId: "01jbq3aaaaaaaaaaaaaaaaaaaa",
      organizations: [{ id: "01jbq3aaaaaaaaaaaaaaaaaaaa", name: "Moja firma", role: "member" }]
    });

    expect(scope).toEqual({ tenantId: "01jbq3aaaaaaaaaaaaaaaaaaaa", userSub: sub, isPersonalFallback: false });
  });

  it("clovek bez firmy dostane osobny scope", () => {
    const scope = preferenceScope({ sub, organizationId: null, organizations: [] });

    expect(scope.tenantId).toBe(`user:${sub}`);
    expect(scope.isPersonalFallback).toBe(true);
  });

  it("rozhoduje aktivna firma, aj ked zoznam clenstiev v claimoch chyba", () => {
    // Presne stav kazdej session vydanej PRED nasadenim tejto fazy: `organizations` v nej
    // este nie su. Keby sa tenant overoval proti zoznamu, cely 15-minutovy interval do
    // obnovy claimov by ludia zapisovali pod osobny scope — a po obnove by im to zmizlo.
    const scope = preferenceScope({ sub, organizationId: "01jbq3aaaaaaaaaaaaaaaaaaaa", organizations: [] });

    expect(scope.tenantId).toBe("01jbq3aaaaaaaaaaaaaaaaaaaa");
    expect(scope.isPersonalFallback).toBe(false);
  });

  it("scope sa nemeni tym, ci uz doslo obnovenie claimov", () => {
    const stareClaimy = preferenceScope({ sub, organizationId: "tenant-a", organizations: [] });
    const svezieClaimy = preferenceScope({
      sub,
      organizationId: "tenant-a",
      organizations: [{ id: "tenant-a", name: "Firma A", role: "member" }]
    });

    expect(stareClaimy).toEqual(svezieClaimy);
  });

  it("osobny scope dvoch ludi sa nikdy nestretne", () => {
    const prvy = preferenceScope({ sub: "aaa", organizationId: null, organizations: [] });
    const druhy = preferenceScope({ sub: "bbb", organizationId: null, organizations: [] });

    expect(prvy.tenantId).not.toBe(druhy.tenantId);
  });
});

describe("scopeFromBinding", () => {
  it("firemny tenant zo state ostava firemny", () => {
    const scope = scopeFromBinding("tenant-a", "clovek-a");

    expect(scope).toEqual({ tenantId: "tenant-a", userSub: "clovek-a", isPersonalFallback: false });
  });

  it("osobny tenant sa rozpozna, nehada sa", () => {
    // Callback z KROS nema session, takze scope vznika z tohto zaznamu — a nesmie tvrdit
    // „je to firma", ked to firma nie je.
    expect(scopeFromBinding(`user:${"clovek-a"}`, "clovek-a").isPersonalFallback).toBe(true);
  });
});
