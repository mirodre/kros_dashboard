import type { NextFetchEvent, NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Hranica pokrytia ležala presne tu: `isPublicPath` má vlastnú sadu testov, ale kód, ktorý
 * ho VOLÁ — teda ten, čo rozhoduje, či request prejde — nemal žiadny. Preto sa tu volá
 * exportovaný middleware s falošným requestom a kontrolujú sa skutočné odpovede.
 *
 * `@/auth` sa mockuje (rovnaký vzor ako `src/app/actions/sign-out.test.ts`): pravý modul
 * ťahá `next/server` a `next/headers` z next-auth, ktoré mimo Next runtime neexistujú.
 *
 * Mock ZÁMERNE vracia PRÍSĽUB funkcie, nie funkciu: pri funkcionálnej konfigurácii je
 * `initAuth` async (`node_modules/next-auth/lib/index.js`), takže `auth(handler)` prísľub
 * naozaj vracia. Mock, ktorý by vrátil funkciu, by dovolil chybu, pri ktorej Next middleware
 * vôbec nespustí, a testy by prechádzali nad fikciou.
 */
const { guardCalls } = vi.hoisted(() => ({ guardCalls: { count: 0 } }));

vi.mock("@/auth", () => ({
  auth: (handler: (request: NextRequest, event: NextFetchEvent) => unknown) =>
    Promise.resolve(async (request: NextRequest, event: NextFetchEvent) => {
      guardCalls.count += 1;

      return handler(request, event);
    })
}));

const middleware = (await import("@/middleware")).default;

const EVENT = undefined as unknown as NextFetchEvent;

/** Falošný request: middleware číta iba `nextUrl` a `auth`. */
function request(url: string, auth: unknown = null): NextRequest {
  return { nextUrl: new URL(url), auth } as unknown as NextRequest;
}

const SESSION = { claims: { sub: "01jbq2z9k7n4p6r8t0v2x4y6a8" } };

function isNext(response: Response): boolean {
  return response.headers.get("x-middleware-next") === "1";
}

beforeEach(() => {
  guardCalls.count = 0;
});

describe("middleware", () => {
  it("default export je funkcia, nie prislub", async () => {
    // Keby to bol prísľub (`export default auth(...)` pri funkcionálnej konfigurácii),
    // Next middleware vôbec nespustí — „The Middleware file must export a function named
    // `middleware` or a default function" — a neplatila by ŽIADNA ochrana.
    expect(typeof middleware).toBe("function");
  });

  it("chranena stranka bez session presmeruje na prihlasenie s cestou aj query", async () => {
    const response = await middleware(request("https://prehlady.test/cashflow?mesiac=3"), EVENT);

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://prehlady.test/prihlasenie?callbackUrl=%2Fcashflow%3Fmesiac%3D3"
    );
  });

  it("chranene API bez session vrati 401 JSON, nie redirect", async () => {
    // Celý dôvod tejto fázy: presmerovanie na HTML by z `fetch` volania spravilo
    // nezrozumiteľnú chybu parsovania JSON.
    const response = await middleware(request("https://prehlady.test/api/kros/logs"), EVENT);

    expect(response.status).toBe(401);
    expect(response.headers.get("content-type")).toContain("application/json");
    await expect(response.json()).resolves.toEqual({ error: "Neprihlásený" });
  });

  it("prihlaseny prejde na chranenu cestu", async () => {
    const response = await middleware(
      request("https://prehlady.test/api/kros/logs", SESSION),
      EVENT
    );

    expect(isNext(response)).toBe(true);
  });

  it("kros consent callback prejde bez session", async () => {
    // `firma.kros.sk` sem posiela cross-site form POST a Lax cookie sa pri ňom neposiela,
    // takže session tu nie je k dispozícii. Autorizuje jednorazový `state` v handleri.
    const response = await middleware(request("https://prehlady.test/kros/callback"), EVENT);

    expect(isNext(response)).toBe(true);
  });

  it.each([
    "https://prehlady.test/favicon.ico",
    "https://prehlady.test/icon-192.png",
    "https://prehlady.test/manifest.webmanifest",
    "https://prehlady.test/_next/static/chunks/main.js",
    "https://prehlady.test/api/auth/session",
    "https://prehlady.test/prihlasenie?callbackUrl=%2F"
  ])("verejna cesta prejde a NEPLATI auth cenu: %s", async (url) => {
    // `handleAuth` volá `getSession` ešte pred obalenou funkciou, takže skratka vnútri
    // `auth()` prišla príliš neskoro: každý asset dešifroval JWE a pri zvetraných claimoch
    // sa pokúsil o sieťovú obnovu. Počas výpadku služby by statické súbory blokovalo
    // celých `AUTH_SERVICE_TIMEOUT_MS`.
    const response = await middleware(request(url), EVENT);

    expect(isNext(response)).toBe(true);
    expect(guardCalls.count).toBe(0);
  });

  it("chranena cesta auth cenu zaplati", async () => {
    // Druhá strana toho istého tvrdenia — bez nej by test vyššie prešiel aj vtedy, keby
    // sa `auth()` nevolalo nikdy.
    await middleware(request("https://prehlady.test/"), EVENT);

    expect(guardCalls.count).toBe(1);
  });
});
