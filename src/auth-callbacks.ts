import type { Account, Profile, Session } from "next-auth";
import type { JWT } from "next-auth/jwt";

import { fetchMe, type MeResponse, refreshTokens } from "@/lib/auth-service";
import { singleFlight } from "@/lib/single-flight";
import { claimsFromMe, type SsoClaims, type SsoToken } from "@/lib/sso-claims";
import { advanceToken } from "@/lib/token-lifecycle";

/**
 * Callbacky `jwt` a `session` sú tu, a nie v literáli `NextAuth(() => ...)`, kvôli
 * testovateľnosti: `src/auth.ts` sa v testoch importovať nedá (next-auth ťahá `next/server`
 * a `next/headers`, ktoré mimo Next runtime nie sú), zatiaľ čo tento modul má z next-auth
 * len `import type`, ktorý sa pri kompilácii vytratí. Rozhodujú o tom, čo je v cookie a čo
 * sa dostane do klienta — teda presne to, na čo testy byť musia. Chovanie sa presunom
 * nezmenilo; `src/auth.ts` ich len zapája.
 */

/**
 * Obnova tokenov ide cez deduplikáciu kľúčovanú PRICHÁDZAJÚCIM refresh tokenom. Session je
 * len šifrovaná cookie, takže súbežné requesty (dva efekty na `/` + `<Link>` prefetch)
 * dekódujú ten istý stav a každý by obnovoval tým istým refresh tokenom — a služba starý
 * token pri rotácii revokuje. Prvý by vyhral, ostatných by to odhlásilo.
 *
 * Instancia je jedna na modul (teda na runtime instanciu), pretože práve o zdieľanie medzi
 * requestami tu ide — v `advanceToken` ani v `LifecycleDeps` by taký stav žiť nemohol.
 * Dôvod, prečo je to `singleFlight` a nie cache, aj výhradu pre viac replík, pozri
 * v `src/lib/single-flight.ts`.
 *
 * `fetchMe` sa nededuplikuje zámerne: je to idempotentné GET s už rotovaným access tokenom,
 * jeho opakovanie nič nezneplatní a každý request tak má vlastný pokus (zdieľaný prísľub by
 * jeden náhodný 503 rozdal všetkým).
 */
const refreshTokensOnce = singleFlight(refreshTokens);

function seconds(name: string, fallback: number): number {
  const raw = Number(process.env[name]);

  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

/** `null` odhlási — Auth.js tak zahodí session. */
export async function jwtCallback({
  token,
  account,
  profile
}: {
  token: JWT;
  account?: Account | null;
  profile?: Profile | null;
}): Promise<JWT | null> {
  // Prvé prihlásenie: `account` nesie tokeny, `profile` odpoveď z /api/me.
  if (account && profile) {
    // Cast je stale potrebny aj po delegovani `userinfo` na fetchMe v `src/auth.ts`: typ
    // `profile` v `AuthConfig["callbacks"]["jwt"]` je pevne generický `Profile` (@auth/core),
    // nie je parametrizovaný `TProfile` providera — nezávisí od toho, čo vracia náš
    // `userinfo.request()`. Za behu je to presne to, čo vrátil fetchMe (teda MeResponse),
    // pretože userinfo endpoint už nemá vlastný Auth.js fetch, ktorý by ho nahradil niečím iným.
    const fresh: SsoToken = {
      claims: claimsFromMe(profile as unknown as MeResponse),
      accessToken: account.access_token ?? "",
      refreshToken: account.refresh_token ?? "",
      refreshedAt: Date.now()
    };

    return { ...token, ...fresh };
  }

  const next = await advanceToken(token as unknown as SsoToken, {
    nowMs: Date.now(),
    claimsTtlSeconds: seconds("AUTH_SERVICE_CLAIMS_TTL", 900),
    gracePeriodSeconds: seconds("AUTH_SERVICE_GRACE_PERIOD", 86400),
    refreshTokens: refreshTokensOnce,
    fetchMe
  });

  return next === null ? null : { ...token, ...next };
}

export function sessionCallback({
  session,
  token
}: {
  session: Session;
  token: JWT;
}): Session & { claims: SsoClaims } {
  const sso = token as unknown as SsoToken;

  // Do klienta ide identita a firma, NIKDY tokeny.
  return { ...session, claims: sso.claims };
}
