import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { isPublicPath, SIGN_IN_PATH } from "@/lib/public-paths";

/**
 * Deny-by-default: chránené je všetko, čo `isPublicPath()` neoznačí za verejné.
 * Nikdy tu nevymenúvaj chránené cesty — pozri komentár v `src/lib/public-paths.ts`.
 */
export default auth((request) => {
  if (isPublicPath(request.nextUrl.pathname)) {
    return NextResponse.next();
  }

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

export const config = {
  // Matcher zámerne berie VŠETKO. Rozhodovanie robí isPublicPath(), aby existovalo
  // jedno miesto pravdy a dal sa naň napísať test.
  matcher: ["/((?!_next/static|_next/image).*)"]
};
