import type { MeResponse } from "@/lib/auth-service";

/**
 * Claimy, ako ich vidí appka. `sub` je JEDINÉ, čo sa niekedy dostane do budúcej databázy
 * (tabuľka používateľských nastavení) — a aj to ako referencia na používateľa v službe,
 * nie ako kópia jeho dát. Rovnaká úloha, akú má `connections.organization_id` v
 * payment_connectore.
 */
export type SsoClaims = {
  sub: string;
  email: string;
  emailVerified: boolean;
  name: string | null;
  avatar: string | null;
  organizationId: string | null;
  organizationName: string | null;
  role: string | null;
};

/** Tvar dát v šifrovanej cookie. Jediné miesto, ktoré ho pozná. */
export type SsoToken = {
  claims: SsoClaims;
  accessToken: string;
  refreshToken: string;
  /** Kedy sa claimy naposledy úspešne obnovili (ms). */
  refreshedAt: number;
  /** Okamih PRVÉHO zlyhania služby (ms). Chýba, keď je všetko v poriadku. */
  degradedSince?: number;
};

function text(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

/**
 * Sploští odpoveď `/api/me` na to, čo appka potrebuje. Prepínač firiem appka nemá, takže
 * z celého zoznamu si drží iba aktívnu firmu — ostatné by boli mŕtve dáta v cookie.
 */
export function claimsFromMe(data: MeResponse): SsoClaims {
  const active = text(data.active_organization);
  const organization = active === null ? undefined : data.organizations?.find((o) => o.id === active);

  return {
    sub: data.sub,
    email: data.email,
    emailVerified: data.email_verified === true,
    name: text(data.name),
    avatar: text(data.avatar),
    organizationId: active,
    organizationName: text(organization?.name),
    role: text(organization?.role)
  };
}

export function claimsAgeSeconds(token: Pick<SsoToken, "refreshedAt">, nowMs: number): number {
  return Math.max(0, Math.floor((nowMs - token.refreshedAt) / 1000));
}
