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
      refreshedAt: deps.nowMs,
      // `degradedSince: undefined` je tu NAPÍSANÉ naschvál a nie je to to isté ako kľúč
      // vynechať. Volajúci výsledok skladá spreadom (`{ ...token, ...next }`) a spread
      // kopíruje len kľúče, ktoré v objekte SÚ — chýbajúci kľúč starú hodnotu nezmaže,
      // len ju nechá prežiť. Session, ktorá raz prežila výpadok, by si tak pondelkovú
      // značku nosila navždy a prvé neúspešné obnovenie po prekročení grace periody by
      // ju odhlásilo, hoci medzitým sto obnov prešlo. Kľúč s hodnotou `undefined`
      // prepíše starú hodnotu a zo serializácie do cookie (JSON) vypadne.
      degradedSince: undefined
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
