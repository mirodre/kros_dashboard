import { type fetchMe, type refreshTokens, SsoAuthFailed, SsoUnavailable } from "@/lib/auth-service";
import { claimsAgeSeconds, claimsFromMe, type SsoToken } from "@/lib/sso-claims";

export type LifecycleDeps = {
  nowMs: number;
  claimsTtlSeconds: number;
  gracePeriodSeconds: number;
  refreshTokens: typeof refreshTokens;
  fetchMe: typeof fetchMe;
};

/**
 * Rozhodne, čo sa má stať s tokenom na tomto requeste. `null` znamená odhlás.
 *
 * Celé jadro je rozlíšenie dvoch zlyhaní. Bez neho by boli len dve možnosti a obe zlé: buď
 * pri každom výpadku služby odhlásiť všetkých, alebo nechať zrušené konto žiť ďalej.
 *
 * Závislosti sa vstrekujú, aby sa táto funkcia dala testovať bez Auth.js runtime aj bez siete.
 */
export async function advanceToken(token: SsoToken, deps: LifecycleDeps): Promise<SsoToken | null> {
  if (claimsAgeSeconds(token, deps.nowMs) < deps.claimsTtlSeconds) {
    return token;
  }

  if (token.refreshToken === "") {
    return null; // Nie je čím obnoviť.
  }

  try {
    const tokens = await deps.refreshTokens(token.refreshToken);
    const claims = claimsFromMe(await deps.fetchMe(tokens.accessToken));

    return {
      claims,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      refreshedAt: deps.nowMs
      // `degradedSince` sa zámerne nekopíruje — úspešná obnova ruší beh grace periody.
    };
  } catch (error) {
    if (error instanceof SsoAuthFailed) {
      return null;
    }

    if (!(error instanceof SsoUnavailable)) {
      throw error; // Neznáma chyba nie je výrok o prístupe ani o dostupnosti.
    }

    // Okamih PRVÉHO zlyhania sa nikdy neprepisuje.
    const degradedSince = token.degradedSince ?? deps.nowMs;

    if (deps.nowMs - degradedSince > deps.gracePeriodSeconds * 1000) {
      return null;
    }

    return { ...token, degradedSince };
  }
}
