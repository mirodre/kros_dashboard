import type { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Táto route je zároveň `pages.signIn`, takže sem Auth.js posiela aj chyby prihlásenia
 * (`OAuthCallbackError` má `kind === "signIn"`). Keby na ne odpovedala novým `signIn()`,
 * vznikol by nekonečný cyklus bez akejkoľvek interakcie — a nič iné v tejto sade by to
 * nezachytilo.
 *
 * `@/auth` sa mockuje: pravý modul ťahá `next/server` a `next/headers` z next-auth, ktoré
 * mimo Next runtime neexistujú. Mock zároveň napodobňuje, že `signIn()` presmerováva
 * riadiacou výnimkou.
 */
const { signInMock } = vi.hoisted(() => ({
  signInMock: vi.fn(async () => {
    throw new Error("NEXT_REDIRECT");
  })
}));

vi.mock("@/auth", () => ({ signIn: signInMock }));

const { GET } = await import("@/app/prihlasenie/route");

function request(url: string): NextRequest {
  return { nextUrl: new URL(url) } as unknown as NextRequest;
}

afterEach(() => {
  signInMock.mockClear();
});

describe("GET /prihlasenie", () => {
  it("request s chybou NEPRESMERUJE do sluzby", async () => {
    // Bez tohto by cyklus bežal do ERR_TOO_MANY_REDIRECTS a pálil autorizačný kód na
    // každom kole — služba už klientovi dala súhlas, takže ho nič nepreruší.
    const response = await GET(
      request("https://prehlady.test/prihlasenie?error=OAuthCallbackError&callbackUrl=%2F")
    );

    expect(signInMock).not.toHaveBeenCalled();
    expect(response.status).toBe(400);
    expect(response.headers.get("location")).toBeNull();
  });

  it("chybova odpoved ukaze kod chyby a odkaz na novy pokus bez query", async () => {
    const response = await GET(request("https://prehlady.test/prihlasenie?error=OAuthCallbackError"));
    const body = await response.text();

    expect(response.headers.get("content-type")).toContain("text/html");
    expect(body).toContain("OAuthCallbackError");
    expect(body).toContain('href="/prihlasenie"');
    // Odkaz nesmie nesť `error`, inak by „skúsiť znova" viedlo znova na chybu.
    expect(body).not.toContain('href="/prihlasenie?');
  });

  it("kod chyby z query sa do HTML escapuje", async () => {
    // Hodnota prichádza od klienta; do HTML nesmie ísť neescapovaná.
    const response = await GET(
      request("https://prehlady.test/prihlasenie?error=%3Cscript%3Ealert(1)%3C%2Fscript%3E")
    );
    const body = await response.text();

    expect(body).not.toContain("<script>alert(1)</script>");
    expect(body).toContain("&lt;script&gt;");
  });

  it("bez chyby spusti prihlasenie a prenesie callbackUrl", async () => {
    await expect(
      GET(request("https://prehlady.test/prihlasenie?callbackUrl=%2Fcashflow%3Fmesiac%3D3"))
    ).rejects.toThrow("NEXT_REDIRECT");

    expect(signInMock).toHaveBeenCalledWith("krosdoplnky", { redirectTo: "/cashflow?mesiac=3" });
  });

  it("bez callbackUrl skonci prihlaseny na koreni", async () => {
    await expect(GET(request("https://prehlady.test/prihlasenie"))).rejects.toThrow("NEXT_REDIRECT");

    expect(signInMock).toHaveBeenCalledWith("krosdoplnky", { redirectTo: "/" });
  });
});
