import NextAuth from "next-auth";

import { jwtCallback, sessionCallback } from "@/auth-callbacks";
import { provider } from "@/auth-provider";
import { SIGN_IN_PATH } from "@/lib/public-paths";

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
