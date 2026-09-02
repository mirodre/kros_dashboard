import NextAuth from "next-auth";
import type { OAuth2Config } from "next-auth/providers";

import { fetchMe, type MeResponse, refreshTokens, serviceUrl } from "@/lib/auth-service";
import { claimsFromMe, type SsoToken } from "@/lib/sso-claims";
import { advanceToken } from "@/lib/token-lifecycle";

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
    userinfo: `${serviceUrl()}/api/me`,
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
        // `AuthConfig["callbacks"]["jwt"]` typuje `profile` ako generický `Profile`
        // (nie je parametrizovaný `TProfile` providera), no za behu je to presne surová
        // JSON odpoveď z userinfo endpointu — teda `MeResponse`. Overené v zdroji
        // @auth/core (lib/actions/callback/oauth/callback.ts: `profile = await
        // userinfoResponse.json()`, poslané ďalej bez transformácie cez provider.profile()).
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
        refreshTokens,
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
