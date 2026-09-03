import type { OAuth2Config } from "next-auth/providers";

import { fetchMe, type MeResponse, serviceUrl } from "@/lib/auth-service";

/**
 * Delegovane na fetchMe, nie hola URL: prve prihlasenie musi ist tou istou overenou cestou
 * ako kazde nasledne obnovenie tokenov. fetchMe validuje tvar odpovede (typeof sub/email ===
 * "string") a rozlisuje "sluzba je dole" od "konto nema pristup" — Auth.js vlastny userinfo
 * fetch by obe tieto zaruky obisiel.
 *
 * FUNKCIA, nie konstanta na urovni modulu — z rovnakeho dovodu, pre ktory je funkciou cela
 * konfiguracia (pozri `src/auth.ts`): adresa sa musi citať z env az pri pouziti, nie pri
 * prvom importe modulu.
 */
function userinfo(): NonNullable<OAuth2Config<MeResponse>["userinfo"]> {
  return {
    url: `${serviceUrl()}/api/me`,
    async request({ tokens }: { tokens: { access_token?: string } }) {
      return fetchMe(tokens.access_token ?? "");
    }
  };
}

/**
 * Provider sa menuje `krosdoplnky`, NIE `kros`: appka už má `/api/kros/*` vo význame
 * „KROS ekonomické API" a rovnaké meno by pri čítaní kódu mýlilo.
 *
 * Vlastný provider, nie discovery — služba OIDC vrstvu nemá, takže `type: "oauth"`.
 *
 * Provider je v samostatnom module, aby sa dal testovať: `src/auth.ts` sa mimo Next runtime
 * importovať nedá (next-auth ťahá `next/server` a `next/headers`), a práve tvar authorize
 * requestu je to, čo rozhoduje, či sa vôbec dá prihlásiť.
 */
export function provider(): OAuth2Config<MeResponse> {
  return {
    id: "krosdoplnky",
    name: "KROS doplnky",
    type: "oauth",
    clientId: process.env.AUTH_SERVICE_CLIENT_ID,
    clientSecret: process.env.AUTH_SERVICE_CLIENT_SECRET,
    // PKCE aj `state` sú povinné. PKCE aj pri dôvernom klientovi so secretom — chráni pred
    // zneužitím kódu, ktorý unikol v logu proxy alebo v `Referer`.
    checks: ["pkce", "state"],
    // `scope` je PRÁZDNY, a musí tu byť NAPÍSANÝ — vynechať ho nestačí. `normalizeOAuth`
    // v `@auth/core` doplní `scope=openid profile email` každému oauth provideru, ktorý
    // v authorize URL scope nemá (`lib/utils/providers.js`), takže „scope neposielame"
    // by paradoxne poslalo tri scopy. Služba pritom nemá zaregistrovaný ani jeden
    // (`Passport::$scopes` je prázdne pole a `tokensCan` nikto nevolá), a
    // `AbstractGrant::validateScopes` hodí `invalid_scope` na prvom neznámom scope —
    // ešte pred consent obrazovkou. Prázdna hodnota prejde: Passport ju prefiltruje
    // (`array_filter` v `convertScopesQueryStringToArray`) na prázdny zoznam a
    // `Passport::$defaultScope` je tiež prázdny.
    authorization: { url: `${serviceUrl()}/oauth/authorize`, params: { scope: "" } },
    token: `${serviceUrl()}/oauth/token`,
    userinfo: userinfo(),
    profile(profile) {
      return { id: profile.sub, email: profile.email, name: profile.name ?? null };
    }
  };
}
