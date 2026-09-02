import { describe, expect, it } from "vitest";

import { isPublicPath } from "@/lib/public-paths";

describe("isPublicPath", () => {
  it.each([
    "/api/auth/signin",
    "/api/auth/callback/krosdoplnky",
    "/api/auth/session",
    "/_next/static/chunks/main.js",
    "/favicon.ico",
    "/manifest.webmanifest",
    "/icon-192.png"
  ])("verejna: %s", (path) => {
    expect(isPublicPath(path)).toBe(true);
  });

  it.each(["/", "/cashflow", "/expenses", "/settings", "/kros", "/kros/callback", "/api/kros/logs", "/api/kros/payments"])(
    "chranena: %s",
    (path) => {
      expect(isPublicPath(path)).toBe(false);
    }
  );

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
});
