import type { NextRequest } from "next/server";

import { signIn } from "@/auth";

/**
 * Jediný skok do služby, žiadna prihlasovacia obrazovka v appke.
 *
 * Bez tejto route by middleware posielal neprihláseného na `/api/auth/signin`, čo vykreslí
 * vlastnú stránku `@auth/core`. Tá pri jedinom provideri neautoredirectuje — človek by
 * dostal anglický interstitial s tlačidlom „Sign in with KROS doplnky" vnútri slovenskej
 * appky a musel by klikať druhý raz. Spec aj runbook hovoria opak: neprihlásený ide do
 * služby.
 *
 * ROUTE HANDLER, nie stránka: `signIn()` zapisuje cookies (PKCE verifier a `state`), a to
 * sa počas renderu server komponenty urobiť nedá — Next tam zápis do cookies zakazuje.
 */
export async function GET(request: NextRequest): Promise<Response> {
  // `callbackUrl` pripája middleware z cesty requestu, aby človek skončil tam, kam
  // pôvodne smeroval, nie na `/`. Cudzí origin v tejto hodnote nie je riziko: platí
  // defaultný `redirect` callback Auth.js, ktorý cieľ mimo appky zahodí a nahradí base
  // URL. Práve preto sa vlastný `redirect` callback do `src/auth.ts` nepridáva.
  const callbackUrl = request.nextUrl.searchParams.get("callbackUrl") ?? "/";

  await signIn("krosdoplnky", { redirectTo: callbackUrl });

  // Nedosiahnuteľné: `signIn()` presmerovanie robí riadiacou výnimkou (`redirect()`
  // z `next/navigation`) vo všetkých vetvách. Keby sa sem beh niekedy dostal, je to
  // chyba v predpoklade — nie dôvod poslať človeka na `/`, odkiaľ by ho middleware
  // poslal späť sem.
  throw new Error("signIn() nepresmeroval — prihlásenie sa nespustilo.");
}
