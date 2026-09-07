import { describe, expect, it } from "vitest";

import { isPublicPath, SIGN_IN_PATH } from "@/lib/public-paths";

describe("isPublicPath", () => {
  it.each([
    "/api/auth/signin",
    "/api/auth/callback/krosdoplnky",
    "/api/auth/session",
    "/_next/static/chunks/main.js",
    "/favicon.ico",
    "/manifest.webmanifest",
    "/icon-192.png",
    // KROS integration-consent posiela sem cross-site form POST; sameSite=lax cookie sa
    // pri nom neposle, takze session tu nie je k dispozicii. Autorizuje jednorazovy `state`,
    // ktory handler overuje sam (oauthStateStore.consume) — `/kros` samotne ostava chranene.
    "/kros/callback",
    // Prihlasovacia route musi byt verejna, inak by ju middleware chranil a poslal
    // neprihlaseneho zase na nu — redirect loop.
    "/prihlasenie"
  ])("verejna: %s", (path) => {
    expect(isPublicPath(path)).toBe(true);
  });

  it.each(["/", "/cashflow", "/expenses", "/settings", "/kros", "/api/kros/logs", "/api/kros/payments"])(
    "chranena: %s",
    (path) => {
      expect(isPublicPath(path)).toBe(false);
    }
  );

  it("vynimka pre /kros/callback je presna zhoda, nie predpona", () => {
    // `/kros` bez callbacku ostava chranene a nic pod `/kros/callback/` nesmie preberat
    // vynimku — inak by sa predponou dala obist ochrana celeho `/kros/*` stromu.
    expect(isPublicPath("/kros")).toBe(false);
    expect(isPublicPath("/kros/callback/extra")).toBe(false);
  });

  it("cesta, na ktoru middleware posiela neprihlaseneho, je verejna", () => {
    // Toto je ta vazba, ktora drzi middleware a tento zoznam v sulade: keby sa
    // SIGN_IN_PATH premenovala a v allowliste ostal stary literal, vznikol by
    // redirect loop — middleware by posielal na cestu, ktoru sam chrani.
    expect(isPublicPath(SIGN_IN_PATH)).toBe(true);
  });

  it("vynimka pre prihlasenie je presna zhoda, nie predpona", () => {
    // Pod `/prihlasenie` nic nie je; predpona by zverejnila lubovolnu buducu route,
    // ktora by tam pribudla.
    expect(isPublicPath("/prihlasenie/nieco")).toBe(false);
    expect(isPublicPath("/prihlasenie-inak")).toBe(false);
  });

  it("nova, nikdy nevymenovana route je chranena", () => {
    // Toto je dôvod, prečo je zoznam obrátený. Kým sa vymenúvali CHRÁNENÉ cesty, stačilo
    // pridať route a zabudnúť na ňu — presne tak visel `/api/kros/logs` verejne. Tento test
    // padne, keby sa niekto vrátil k allowlistu ochrany.
    expect(isPublicPath("/api/settings/filters")).toBe(false);
    expect(isPublicPath("/nieco/uplne/nove")).toBe(false);
  });

  it("cudzia cesta zacinajuca ako verejna nie je verejna", () => {
    // `/api/authorization-hack` nesmie prejsť len preto, že začína na `/api/auth`.
    expect(isPublicPath("/api/authorization-hack")).toBe(false);
  });

  it("api route s priponou nie je verejny subor", () => {
    // Route handler pod /api/ s priponou (napr. /api/kros/export.xml) je dynamicky,
    // nie staticky subor. Klasifikovanie podla pripony by znova ohrozilo /api/kros/logs.
    expect(isPublicPath("/api/kros/export.xml")).toBe(false);
  });

  it("vlozen staticke subory su verejne", () => {
    // Subory z public/ (ako /fonts/inter.woff2) su staticky, nie route handlery.
    expect(isPublicPath("/fonts/inter.woff2")).toBe(true);
  });
});
