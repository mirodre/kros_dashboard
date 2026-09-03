import type { NextAuthRequest } from "next-auth";
import { NextResponse } from "next/server";
import type { NextFetchEvent, NextRequest } from "next/server";

import { auth } from "@/auth";
import { isPublicPath, SIGN_IN_PATH } from "@/lib/public-paths";

/**
 * Rozhodnutie pre CHRÁNENÉ cesty. Beží až za `auth()`, takže má k dispozícii session.
 *
 * Druhý parameter je nepoužitý a je tu kvôli typom: `auth()` má dva preťažené tvary
 * (route handler a middleware) a jednoparametrová funkcia sedí na oba — TypeScript by
 * vybral ten prvý a čakal `ctx.params`. Dvojparametrový podpis vyberá ten middleware.
 */
const guardProtected = auth((request: NextAuthRequest, _event: NextFetchEvent) => {
  if (request.auth) {
    return NextResponse.next();
  }

  // API vracia 401, nie redirect: presmerovanie na HTML prihlasovaciu obrazovku by
  // z fetch volania spravilo nezrozumiteľnú chybu parsovania JSON.
  if (request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Neprihlásený" }, { status: 401 });
  }

  // `SIGN_IN_PATH`, nie `/api/auth/signin`: default stránka Auth.js by pri jedinom
  // provideri vypýtala druhé kliknutie a bola by po anglicky. Naša route skočí do služby.
  const signIn = new URL(SIGN_IN_PATH, request.nextUrl.origin);
  signIn.searchParams.set("callbackUrl", request.nextUrl.pathname + request.nextUrl.search);

  return NextResponse.redirect(signIn);
});

/**
 * Deny-by-default: chránené je všetko, čo `isPublicPath()` neoznačí za verejné.
 * Nikdy tu nevymenúvaj chránené cesty — pozri komentár v `src/lib/public-paths.ts`.
 *
 * Verejné cesty sa vyhodnocujú PRED `auth()`, a to je celý dôvod tvaru tohto súboru.
 * `auth(handler)` (presnejšie `handleAuth` v `node_modules/next-auth/lib/index.js`) volá
 * `getSession` ešte pred obalenou funkciou, takže kým bola skratka vnútri, každý
 * `/favicon.ico`, `/icon-192.png`, `/manifest.webmanifest` aj `/api/auth/*` dešifroval
 * JWE — a pri zvetraných claimoch sa navyše každý z nich pokúšal o sieťovú obnovu. Výpadok
 * služby by tak zablokoval aj statické assety na celý `AUTH_SERVICE_TIMEOUT_MS` a tie
 * requesty by zbytočne rozširovali okno súbežnosti pri rotácii refresh tokenu.
 *
 * `auth(handler)` vracia pri FUNKCIONÁLNEJ konfigurácii PRÍSĽUB, nie funkciu: `initAuth`
 * je v tom prípade `async (...args) => ...` a obalenú funkciu rozpozná až vnútri
 * (`node_modules/next-auth/lib/index.js`). Deklarovaný typ tvrdí opak, next-auth si ho
 * v `index.js` potláča `@ts-expect-error`. Preto `await` — a preto tu default export MUSÍ
 * byť skutočná funkcia: `export default auth(...)` exportoval prísľub a Next middleware
 * vôbec nespustil („The Middleware file must export a function named `middleware` or a
 * default function"), takže neplatila ŽIADNA ochrana.
 */
export default async function middleware(
  request: NextRequest,
  event: NextFetchEvent
): Promise<Response> {
  if (isPublicPath(request.nextUrl.pathname)) {
    return NextResponse.next();
  }

  const guard = await guardProtected;

  // `?? next()` je len kvôli typom: `NextMiddleware` smie vrátiť `undefined`, `handleAuth`
  // ale vždy vracia odpoveď.
  return (await guard(request, event)) ?? NextResponse.next();
}

export const config = {
  // Matcher zámerne berie VŠETKO. Rozhodovanie robí isPublicPath(), aby existovalo
  // jedno miesto pravdy a dal sa naň napísať test.
  matcher: ["/((?!_next/static|_next/image).*)"]
};
