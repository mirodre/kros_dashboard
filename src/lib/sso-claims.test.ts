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

describe("claimsFromMe — zoznam firiem", () => {
  it("drzi cely zoznam, nielen aktivnu firmu", () => {
    // Bez zoznamu sa neda rozlisit „clovek nema firmu" od „aktivna firma ukazuje mimo
    // zoznamu" — a to su dva rozne scope (osobny vs. firemny), nie jeden.
    const claims = claimsFromMe({
      sub: "01jbq2z9k7n4p6r8t0v2x4y6a8",
      email: "ja@firma.sk",
      organizations: [
        { id: "01jbq3aaaaaaaaaaaaaaaaaaaa", name: "Moja firma", role: "owner" },
        { id: "01jbq4bbbbbbbbbbbbbbbbbbbb", name: "Druha firma", role: "member" }
      ],
      active_organization: "01jbq4bbbbbbbbbbbbbbbbbbbb"
    });

    expect(claims.organizations).toEqual([
      { id: "01jbq3aaaaaaaaaaaaaaaaaaaa", name: "Moja firma", role: "owner" },
      { id: "01jbq4bbbbbbbbbbbbbbbbbbbb", name: "Druha firma", role: "member" }
    ]);
  });

  it("zahodi zaznam bez id", () => {
    // Zaznam bez id sa neda pouzit na nic — ani na porovnanie s active_organization.
    const claims = claimsFromMe({
      sub: "01jbq2z9k7n4p6r8t0v2x4y6a8",
      email: "ja@firma.sk",
      organizations: [{ name: "Bez id", role: "owner" }, { id: "01jbq3aaaaaaaaaaaaaaaaaaaa", name: "S id" }],
      active_organization: null
    });

    expect(claims.organizations).toEqual([{ id: "01jbq3aaaaaaaaaaaaaaaaaaaa", name: "S id", role: null }]);
  });

  it("bez firiem je zoznam prazdny, nie undefined", () => {
    const claims = claimsFromMe({ sub: "x", email: "ja@firma.sk", active_organization: null });

    expect(claims.organizations).toEqual([]);
  });
});
