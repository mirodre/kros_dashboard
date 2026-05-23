import { NextResponse } from "next/server";
import {
  createSessionToken,
  getSessionCookieOptions,
  isAuthConfigured,
  SESSION_COOKIE_NAME,
  verifyDashboardPassword
} from "@/lib/auth-session";

export async function POST(request: Request) {
  if (!isAuthConfigured()) {
    return NextResponse.json(
      { error: "Server nie je nakonfigurovaný (AUTH_SECRET, DASHBOARD_PASSWORD)" },
      { status: 503 }
    );
  }

  try {
    const body = (await request.json()) as { password?: string };
    if (!body.password || !verifyDashboardPassword(body.password)) {
      return NextResponse.json({ error: "Nesprávne heslo" }, { status: 401 });
    }

    const response = NextResponse.json({ ok: true });
    response.cookies.set(SESSION_COOKIE_NAME, await createSessionToken(), getSessionCookieOptions());
    return response;
  } catch {
    return NextResponse.json({ error: "Neplatná požiadavka" }, { status: 400 });
  }
}
