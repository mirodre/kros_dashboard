import NextAuth from "next-auth";
import type { OAuth2Config } from "next-auth/providers";

import { jwtCallback, sessionCallback } from "@/auth-callbacks";
import { fetchMe, type MeResponse, serviceUrl } from "@/lib/auth-service";
import { SIGN_IN_PATH } from "@/lib/public-paths";

/**
 * Delegovane na fetchMe, nie hola URL: prve prihlasenie musi ist tou istou overenou cestou
 * ako kazde nasledne obnovenie tokenov. fetchMe validuje tvar odpovede (typeof sub/email ===
 * "string") a rozlisuje "sluzba je dole" od "konto nema pristup" — Auth.js vlastny userinfo
 * fetch by obe tieto zaruky obisiel.
 */
const userinfo: NonNullable<OAuth2Config<MeResponse>["userinfo"]> = {
  url: `${serviceUrl()}/api/me`,
  async request({ tokens }: { tokens: { access_token?: string } }) {
    return fetchMe(tokens.access_token ?? "");
  }
};

/**
 * Provider sa menuje `krosdoplnky`, NIE `kros`: appka už má `/api/kros/*` vo význame
 * „KROS ekonomické API" a rovnaké meno by pri čítaní kódu mýlilo.
 *
 * Vlastný provider, nie discovery — služba OIDC vrstvu nemá, takže `type: "oauth"`.
 * `scope` sa neposiela zámerne: služba scopy nepoužíva.
 */
function provider(): OAuth2Config<MeResponse> {
  return {
    id: "krosdoplnky",
    name: "KROS doplnky",
    type: "oauth",
    clientId: process.env.AUTH_SERVICE_CLIENT_ID,
    clientSecret: process.env.AUTH_SERVICE_CLIENT_SECRET,
    // PKCE aj `state` sú povinné. PKCE aj pri dôvernom klientovi so secretom — chráni pred
    // zneužitím kódu, ktorý unikol v logu proxy alebo v `Referer`.
    checks: ["pkce", "state"],
    authorization: `${serviceUrl()}/oauth/authorize`,
    token: `${serviceUrl()}/oauth/token`,
    userinfo,
    profile(profile) {
      return { id: profile.sub, email: profile.email, name: profile.name ?? null };
    }
  };
}

/**
 * Konfigurácia je FUNKCIA, nie objekt — `NextAuth` to podporuje
 * (`config: NextAuthConfig | ((request) => Awaitable<NextAuthConfig>)`).
 *
 * Dôvod je prevádzkový: objekt na úrovni modulu by adresy endpointov zapiekol z premenných
 * dostupných v čase, keď Next modul prvý raz importuje — teda aj počas `next build`, kde
 * `AUTH_SERVICE_URL` byť nemusí. Vznikli by relatívne adresy typu `/oauth/authorize`
 * a prihlásenie by padalo až v produkcii. Funkcia sa vyhodnotí per request, s reálnym env.
 */
export const { handlers, auth, signIn, signOut } = NextAuth(() => ({
  providers: [provider()],
  // Bez databázy: claimy aj tokeny žijú v šifrovanej httpOnly cookie (JWE).
  session: { strategy: "jwt" },
  // Vlastná prihlasovacia route namiesto default stránky `@auth/core` — tá pri jedinom
  // provideri neautoredirectuje a vypýtala by druhé kliknutie. Platí to aj pre `GET
  // /api/auth/signin`, ktoré sem Auth.js teraz presmeruje samo.
  pages: { signIn: SIGN_IN_PATH },
  // Callbacky sú v `src/auth-callbacks.ts`, aby sa dali testovať — tento modul sa mimo
  // Next runtime importovať nedá. Tu sa len zapájajú.
  callbacks: {
    jwt: jwtCallback,
    session: sessionCallback
  }
}));
