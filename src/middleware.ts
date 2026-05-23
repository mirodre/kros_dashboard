import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  isAuthConfigured,
  SESSION_COOKIE_NAME,
  verifySessionToken
} from "@/lib/auth-session";

const PUBLIC_PATHS = new Set(["/login", "/api/auth/login"]);

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|manifest.webmanifest).*)"]
};

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (!isAuthConfigured()) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        { error: "Server nie je nakonfigurovaný (AUTH_SECRET, DASHBOARD_PASSWORD)" },
        { status: 503 }
      );
    }

    return new NextResponse(
      "Server nie je zabezpečený. Nastav AUTH_SECRET a DASHBOARD_PASSWORD v prostredí.",
      { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } }
    );
  }

  const sessionToken = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const isAuthenticated = await verifySessionToken(sessionToken);

  if (PUBLIC_PATHS.has(pathname)) {
    if (isAuthenticated && pathname === "/login") {
      return NextResponse.redirect(new URL("/", request.url));
    }
    return NextResponse.next();
  }

  if (isAuthenticated) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Neautorizovaný prístup" }, { status: 401 });
  }

  const loginUrl = new URL("/login", request.url);
  const nextPath = `${pathname}${request.nextUrl.search}`;
  if (nextPath && nextPath !== "/") {
    loginUrl.searchParams.set("next", nextPath);
  }
  return NextResponse.redirect(loginUrl);
}
