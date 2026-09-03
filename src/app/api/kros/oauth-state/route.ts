import { NextResponse } from "next/server";

import { getPool } from "@/lib/db/pool";
import { isValidOAuthState, oauthStateStore, STATE_TTL_MS } from "@/lib/kros-oauth-state";
import { scopeFromSession } from "@/lib/preferences/scope";
import { tokenKey } from "@/lib/token-crypto";
import { auth } from "@/auth";

/**
 * Vydá jednorazový `state` a ZAPÍŠE, komu patrí. Väzbu na firmu tu nemožno vynechať:
 * callback z KROS prichádza cross-site POSTom bez session, takže `state` je jediné, podľa
 * čoho vie, do ktorej firmy prepojenie zapísať.
 *
 * Do fázy 2 sa sem dal `state` zaregistrovať aj bez prihlásenia (riziko pomenované v spec-e
 * fázy SSO) — kontrola session to zároveň zatvára.
 */
export async function POST(request: Request) {
  try {
    const scope = scopeFromSession(await auth());
    if (!scope) {
      return NextResponse.json({ error: "Neprihlásený" }, { status: 401 });
    }

    const body = (await request.json()) as { state?: string };
    if (!body.state || !isValidOAuthState(body.state)) {
      return NextResponse.json({ error: "Neplatný state parameter" }, { status: 400 });
    }

    const pool = getPool();
    if (!pool) {
      return NextResponse.json(
        { error: "Prepojenie s KROS vyžaduje databázu (DATABASE_URL nie je nastavená)." },
        { status: 503 }
      );
    }

    // Šifrovací kľúč sa overuje TU, teda skôr, než človek odíde do KROS udeliť súhlas.
    // Bez toho by chýbajúci `KROS_TOKEN_KEY` vysvitol až v callbacku — po celom kole cez
    // KROS, tesne pred zápisom — a navonok by to vyzeralo, že prepojenie prebehlo, len sa
    // „nič neuložilo". Radšej sa flow vôbec nezačne a povie prečo.
    try {
      tokenKey();
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Chýba KROS_TOKEN_KEY." },
        { status: 503 }
      );
    }

    await oauthStateStore(pool).register(
      body.state,
      { tenantId: scope.tenantId, userSub: scope.userSub },
      new Date(Date.now() + STATE_TTL_MS)
    );

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
