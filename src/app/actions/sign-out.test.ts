import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Nič iné v tejto sade nechytí zlý cieľ presmerovania — ani `npm test`, ani `tsc`, ani
 * `lint` nezareagujú, keď niekto omylom vráti `redirect("/")` alebo `signOut({ redirectTo })`.
 * Zlý cieľ znamená, že človek si ponechá živú session v službe (presne zlyhanie, ktorému
 * má táto úloha zabrániť), preto sa poradie a presné argumenty volaní overujú tu.
 */

const { signOutMock, redirectMock } = vi.hoisted(() => ({
  signOutMock: vi.fn(async () => undefined),
  redirectMock: vi.fn()
}));

vi.mock("@/auth", () => ({
  signOut: signOutMock
}));

vi.mock("next/navigation", () => ({
  redirect: redirectMock
}));

import { signOutAction } from "@/app/actions/sign-out";

const original = { ...process.env };

afterEach(() => {
  process.env = { ...original };
  signOutMock.mockClear();
  redirectMock.mockClear();
});

describe("signOutAction", () => {
  it("najprv zrusi lokalnu session bez presmerovania cez Auth.js", async () => {
    process.env.AUTH_SERVICE_URL = "https://login.test";
    delete process.env.AUTH_SERVICE_APP_KEY;

    await signOutAction();

    expect(signOutMock).toHaveBeenCalledWith({ redirect: false });
  });

  it("presmeruje presne na sign-out URL sluzby", async () => {
    process.env.AUTH_SERVICE_URL = "https://login.test";
    delete process.env.AUTH_SERVICE_APP_KEY;

    await signOutAction();

    expect(redirectMock).toHaveBeenCalledWith("https://login.test/logout?app=prehlady");
  });

  it("lokalna session sa zrusi PRED cross-origin skokom do sluzby", async () => {
    process.env.AUTH_SERVICE_URL = "https://login.test";
    delete process.env.AUTH_SERVICE_APP_KEY;

    const callOrder: string[] = [];
    signOutMock.mockImplementationOnce(async () => {
      callOrder.push("signOut");
    });
    redirectMock.mockImplementationOnce(() => {
      callOrder.push("redirect");
    });

    await signOutAction();

    expect(callOrder).toEqual(["signOut", "redirect"]);
  });
});
