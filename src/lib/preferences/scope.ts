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

  // Rozhoduje VÝHRADNE `active_organization` zo `/api/me`. Overovať ho ešte proti zoznamu
  // členstiev vyzeralo ako obozretnosť, ale bola to chyba: `organizations` pribudli do
  // claimov až v tejto fáze, takže každá session vydaná pred nasadením ich nemá — a až do
  // najbližšej obnovy claimov (`AUTH_SERVICE_CLAIMS_TTL`, 15 min) by kontrola zhodila
  // každého do osobného scope. Zápisy z toho okna by potom po obnove „zmizli", lebo by
  // ležali pod `user:<sub>` a appka by ich hľadala pod firmou.
  //
  // Oba údaje pritom pochádzajú z tej istej odpovede služby: keď dôverujeme `sub`, nie je
  // dôvod neveriť `active_organization`. Klient ani jedno ovplyvniť nevie.
  if (tenantId === null) {
    return { tenantId: personalTenantId(claims.sub), userSub: claims.sub, isPersonalFallback: true };
  }

  return { tenantId, userSub: claims.sub, isPersonalFallback: false };
}

/** Scope človeka bez firmy. Verejné, aby sa dali dohľadať zápisy z takého okna. */
export function personalTenantId(sub: string): string {
  return `${PERSONAL_PREFIX}${sub}`;
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
