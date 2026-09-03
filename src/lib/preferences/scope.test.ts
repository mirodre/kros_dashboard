import { describe, expect, it } from "vitest";

import { preferenceScope } from "@/lib/preferences/scope";

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

  it("aktivna firma mimo zoznamu clenstiev NEDA tenant scope", () => {
    // Sluzba tento stav naozaj vracia (pozri sso-claims.test.ts). Doverovat mu by znamenalo
    // zapisat firemne nastavenie do firmy, ku ktorej clenstvo nevieme dolozit.
    const scope = preferenceScope({
      sub,
      organizationId: "chybajuca",
      organizations: [{ id: "01jbq3aaaaaaaaaaaaaaaaaaaa", name: "Ina", role: "owner" }]
    });

    expect(scope.tenantId).toBe(`user:${sub}`);
    expect(scope.isPersonalFallback).toBe(true);
  });

  it("osobny scope dvoch ludi sa nikdy nestretne", () => {
    const prvy = preferenceScope({ sub: "aaa", organizationId: null, organizations: [] });
    const druhy = preferenceScope({ sub: "bbb", organizationId: null, organizations: [] });

    expect(prvy.tenantId).not.toBe(druhy.tenantId);
  });
});
