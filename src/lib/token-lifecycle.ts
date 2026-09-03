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

  // Falsy, nie len `=== ""`: token sa dekóduje z cookie, takže jeho runtime tvar typ
  // negarantuje. Chýbajúci `refresh_token` v odpovedi služby pri prvom prihlásení uloží
  // `undefined`, a `refreshTokens(undefined)` by služba zamietla ako `SsoAuthFailed` —
  // človeka by to odhlásilo namiesto čistého „nie je čím obnoviť".
  if (!token.refreshToken) {
    return null; // Nie je čím obnoviť.
  }

  // Rotovaný pár žije MIMO `try`, aby ho zlyhanie `fetchMe` nestratilo. Len čo
  // `refreshTokens` uspeje, služba starý refresh token revokovala — keby degradovaná vetva
  // vrátila `token` nedotknutý, do cookie by sa uložil už zrušený token a hneď ďalšia obnova
  // by dostala `invalid_grant`, teda `SsoAuthFailed`, a odhlásila by. Grace period by presne
  // v tej situácii, pre ktorú existuje, nekúpila nič.
  let rotated: { accessToken: string; refreshToken: string } | null = null;

  try {
    rotated = await deps.refreshTokens(token.refreshToken);
    const claims = claimsFromMe(await deps.fetchMe(rotated.accessToken));

    return {
      claims,
      accessToken: rotated.accessToken,
      refreshToken: rotated.refreshToken,
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

    if (rotated === null) {
      return { ...token, degradedSince };
    }

    // Rotácia prebehla, spadlo až čítanie claimov: nové tokeny sa MUSIA uložiť, claimy
    // ostávajú staré (nové sa nepodarilo prečítať) a `refreshedAt` sa nehýbe, takže ďalší
    // request to skúsi znova — už novým refresh tokenom.
    return {
      ...token,
      accessToken: rotated.accessToken,
      refreshToken: rotated.refreshToken,
      degradedSince
    };
  }
}
