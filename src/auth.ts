import NextAuth from "next-auth";
import type { OAuth2Config } from "next-auth/providers";

import { fetchMe, type MeResponse, refreshTokens, serviceUrl } from "@/lib/auth-service";
import { singleFlight } from "@/lib/single-flight";
import { claimsFromMe, type SsoToken } from "@/lib/sso-claims";
import { advanceToken } from "@/lib/token-lifecycle";

/**
 * Obnova tokenov ide cez deduplikáciu kľúčovanú PRICHÁDZAJÚCIM refresh tokenom. Session je
 * len šifrovaná cookie, takže súbežné requesty (dva efekty na `/` + `<Link>` prefetch)
 * dekódujú ten istý stav a každý by obnovoval tým istým refresh tokenom — a služba starý
 * token pri rotácii revokuje. Prvý by vyhral, ostatných by to odhlásilo.
 *
 * Instancia je jedna na modul (teda na runtime instanciu), pretože práve o zdieľanie medzi
 * requestami tu ide — v `advanceToken` ani v `LifecycleDeps` by taký stav žiť nemohol.
 * Dôvod, prečo to je `singleFlight` a nie cache, aj výhradu pre viac replík, pozri
 * v `src/lib/single-flight.ts`.
 *
 * `fetchMe` sa nededuplikuje zámerne: je to idempotentné GET s už rotovaným access tokenom,
 * jeho opakovanie nič nezneplatní a každý request tak má vlastný pokus (zdieľaný prísľub by
 * jeden náhodný 503 rozdal všetkým).
 */
const refreshTokensOnce = singleFlight(refreshTokens);

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

function seconds(name: string, fallback: number): number {
  const raw = Number(process.env[name]);

  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
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
  callbacks: {
    async jwt({ token, account, profile }) {
      // Prvé prihlásenie: `account` nesie tokeny, `profile` odpoveď z /api/me.
      if (account && profile) {
        // Cast je stale potrebny aj po delegovani `userinfo` na fetchMe vyssie: typ `profile`
        // v `AuthConfig["callbacks"]["jwt"]` je pevne generický `Profile` (@auth/core), nie je
        // parametrizovaný `TProfile` providera — nezávisí od toho, čo vracia náš `userinfo
        // .request()`. Za behu je to presne to, čo vrátil fetchMe (teda MeResponse), pretože
        // userinfo endpoint už nemá vlastný Auth.js fetch, ktorý by ho nahradil niečím iným.
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

      // `null` odhlási — Auth.js tak zahodí session.
      return next === null ? null : { ...token, ...next };
    },
    session({ session, token }) {
      const sso = token as unknown as SsoToken;

      // Do klienta ide identita a firma, NIKDY tokeny.
      return { ...session, claims: sso.claims };
    }
  }
}));
