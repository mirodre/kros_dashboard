import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { getPool } from "@/lib/db/pool";
import type { HandlerResult } from "@/lib/preferences/handlers";
import { postgresRepository, type PreferenceRepository } from "@/lib/preferences/repository";
import { scopeFromSession, type PreferenceScope } from "@/lib/preferences/scope";

/**
 * Spoločný predok oboch route súborov. Rozhodovanie tu žiadne nie je — to je v
 * `src/lib/preferences/handlers.ts`, ktorý sa dá otestovať. Tu je len session, pool
 * a prevod na `Response`.
 */
export type PreferenceContext = {
  scope: PreferenceScope;
  repository: PreferenceRepository;
};

export async function preferenceContext(): Promise<PreferenceContext | NextResponse> {
  const scope = scopeFromSession(await auth());
  if (!scope) {
    // 401, nie redirect: `/api/*` volá fetch, presmerovanie na HTML by z toho spravilo
    // nezrozumiteľnú chybu parsovania JSON (rovnaká úvaha ako v `src/middleware.ts`).
    return NextResponse.json({ error: "Neprihlásený" }, { status: 401 });
  }

  const pool = getPool();
  if (!pool) {
    return NextResponse.json(
      { error: "Nastavenia sa na tomto serveri neukladajú." },
      { status: 503 }
    );
  }

  return { scope, repository: postgresRepository(pool) };
}

export function toResponse(result: HandlerResult): NextResponse {
  return NextResponse.json(result.body, { status: result.status });
}

/** Neplatné JSON telo je `null` — handlery ho odmietnu ako každé iné neplatné telo. */
export async function readBody(request: Request): Promise<unknown> {
  return request.json().catch(() => null);
}
