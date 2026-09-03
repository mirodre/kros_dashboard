import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { getPool } from "@/lib/db/pool";
import type { HandlerResult } from "@/lib/kros-connection-handlers";
import { postgresConnectionRepository, type ConnectionRepository } from "@/lib/kros-connections";
import { scopeFromSession, type PreferenceScope } from "@/lib/preferences/scope";

/**
 * Session, pool a úložisko prepojení pre všetky `/api/kros/*` routy. Rozhodovanie je
 * v `src/lib/kros-connection-handlers.ts`, ktoré sa dá otestovať; tu je len prevod na
 * `Response`.
 */
export type KrosContext = {
  scope: PreferenceScope;
  connections: ConnectionRepository;
};

export async function krosContext(): Promise<KrosContext | NextResponse> {
  const scope = scopeFromSession(await auth());
  if (!scope) {
    return NextResponse.json({ error: "Neprihlásený" }, { status: 401 });
  }

  const pool = getPool();
  if (!pool) {
    // Od fázy 2 sú prepojenia v databáze. Bez nej sa nedá načítať token, teda ani zavolať
    // KROS — a je lepšie to povedať rovno než vracať prázdne dáta, ktoré vyzerajú ako
    // firma bez tržieb.
    return NextResponse.json(
      { error: "Prepojenia s KROS vyžadujú databázu (DATABASE_URL nie je nastavená)." },
      { status: 503 }
    );
  }

  return { scope, connections: postgresConnectionRepository(pool) };
}

export function toResponse(result: HandlerResult): NextResponse {
  return NextResponse.json(result.body, { status: result.status });
}

export async function readBody(request: Request): Promise<unknown> {
  return request.json().catch(() => null);
}
