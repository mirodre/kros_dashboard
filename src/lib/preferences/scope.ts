import type { SsoClaims } from "@/lib/sso-claims";

/**
 * Kam sa nastavenia zapisujú. `tenantId` je JEDINÁ hranica medzi firmami — rola sa
 * nekontroluje (rozhodnutie z 3.9.2026, firemné nastavenia smie meniť ktokoľvek v tenante),
 * takže táto funkcia je jediné miesto, kde sa rozhoduje, do ktorej firmy zápis patrí.
 * Nikde inde sa `organizationId` na tento účel nečíta.
 */
export type PreferenceScope = {
  tenantId: string;
  userSub: string;
  /** Človek bez firmy — firemná úroveň je jeho vlastná, zdieľať sa nemá s kým. */
  isPersonalFallback: boolean;
};

/** Prefix osobného scope. Nemôže kolidovať s id firmy zo služby (tie sú ULID bez dvojbodky). */
const PERSONAL_PREFIX = "user:";

export function preferenceScope(claims: Pick<SsoClaims, "sub" | "organizationId" | "organizations">): PreferenceScope {
  const tenantId = claims.organizationId;

  // Aktívna firma mimo zoznamu členstiev je stav, ktorý služba naozaj vracia (pokrýva ho
  // test v `sso-claims.test.ts`). Zapísať doň firemné nastavenie by znamenalo písať do
  // firmy, ku ktorej členstvo nevieme doložiť — preto osobný scope, nie dôvera claimu.
  const isMember = tenantId !== null && claims.organizations.some((organization) => organization.id === tenantId);

  if (tenantId === null || !isMember) {
    return { tenantId: `${PERSONAL_PREFIX}${claims.sub}`, userSub: claims.sub, isPersonalFallback: true };
  }

  return { tenantId, userSub: claims.sub, isPersonalFallback: false };
}

/**
 * Scope zo záznamu, ktorý si appka odložila skôr (väzba OAuth `state` na firmu). Používa ho
 * `/kros/callback`, kam session nedorazí — cross-site POST Lax cookie neposiela.
 */
export function scopeFromBinding(tenantId: string, userSub: string): PreferenceScope {
  return { tenantId, userSub, isPersonalFallback: tenantId.startsWith(PERSONAL_PREFIX) };
}

/**
 * Session → scope, alebo `null` keď session nie je použiteľná (chýba, alebo v nej nie sú
 * claimy). `null` znamená 401 — a je to jediná cesta, ako scope vzniká: route handler nemá
 * ako scope poskladať z tela requestu, lebo tento modul mu na to nedá funkciu.
 *
 * Middleware chráni `/api/preferences` deny-by-default, takže bez session by sa sem request
 * nemal dostať; kontrola je tu aj tak — obrana nemá stáť na jednom mieste, ktoré sa dá
 * omylom zmeniť inde.
 */
export function scopeFromSession(session: unknown): PreferenceScope | null {
  const claims = (session as { claims?: Partial<SsoClaims> } | null)?.claims;

  if (!claims || typeof claims.sub !== "string" || claims.sub === "") {
    return null;
  }

  return preferenceScope({
    sub: claims.sub,
    organizationId: typeof claims.organizationId === "string" ? claims.organizationId : null,
    organizations: Array.isArray(claims.organizations) ? claims.organizations : []
  });
}
