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
  // Táto route je zároveň `pages.signIn`, takže sem Auth.js posiela aj CHYBY prihlásenia:
  // `OAuthCallbackError` je `SignInError`, teda `kind === "signIn"`, a `@auth/core/index.js`
  // presmeruje takú chybu na `pages.signIn` s `?error=`. Vzniká, keď služba vráti `error=`
  // na redirect URI alebo keď padne výmena kódu za tokeny (zlý `AUTH_SERVICE_CLIENT_SECRET`,
  // zrušený grant, `invalid_scope`). Keby sme sem prihlásenie spustili znova, vznikol by
  // nekonečný cyklus: služba už dala klientovi súhlas, takže žiadna interakcia cyklus
  // nepreruší — beží až do `ERR_TOO_MANY_REDIRECTS` a páli autorizačný kód na každom kole.
  // A udrelo by to presne pri ladení nasadenia, keď je diagnostika najpotrebnejšia.
  const error = request.nextUrl.searchParams.get("error");

  if (error !== null) {
    return failure(error);
  }

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

/**
 * Chybová odpoveď je HTML priamo z route handlera, nie samostatná stránka ani `pages.error`.
 * Dôvod: prihlásenie tak má JEDNU vstupnú cestu a jedno miesto, ktoré rozhoduje, či sa skáče
 * do služby, alebo sa ukazuje chyba. Samostatná stránka by navyše potrebovala vlastný záznam
 * vo `PUBLIC_EXACT` (`isPublicPath` porovnáva presne, takže `/prihlasenie/chyba` by sama
 * presmerovala na prihlásenie) a route by na ňu aj tak musela presmerovať.
 *
 * Kód chyby je vidieť zámerne — je to prvá vec, ktorú človek pri ladení nasadenia potrebuje
 * povedať. Odkaz späť je BEZ query, aby ďalší pokus bol jedno vedomé kliknutie a nie
 * automatický cyklus.
 */
function failure(error: string): Response {
  const body = `<!doctype html>
<html lang="sk">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Prihlásenie sa nepodarilo</title></head>
<body style="font-family: system-ui, sans-serif; margin: 3rem auto; max-width: 32rem; line-height: 1.5">
<h1 style="font-size: 1.25rem">Prihlásenie sa nepodarilo</h1>
<p>Prihlasovacia služba odmietla prihlásenie. Kód chyby: <code>${escapeHtml(error)}</code>.</p>
<p><a href="/prihlasenie">Skúsiť znova</a></p>
</body>
</html>`;

  return new Response(body, {
    // 400, nie 200: prihlásenie sa naozaj nepodarilo a odpoveď sa nemá nikde cachovať.
    status: 400,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" }
  });
}

/** Kód chyby prichádza z query, teda od klienta — do HTML nesmie ísť neescapovaný. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
