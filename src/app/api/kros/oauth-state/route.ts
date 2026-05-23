import { NextResponse } from "next/server";
import { isValidOAuthState, registerOAuthState } from "@/lib/kros-oauth-state";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { state?: string };
    if (!body.state || !isValidOAuthState(body.state)) {
      return NextResponse.json({ error: "Neplatný state parameter" }, { status: 400 });
    }

    await registerOAuthState(body.state);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Nepodarilo sa uložiť OAuth state"
      },
      { status: 500 }
    );
  }
}
