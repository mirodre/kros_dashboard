import { afterEach, describe, expect, it } from "vitest";

import { serviceSignOutUrl } from "@/lib/sign-out-url";

const original = { ...process.env };

afterEach(() => {
  process.env = { ...original };
});

describe("serviceSignOutUrl", () => {
  it("posiela kluc appky, aby sa dalsie prihlasenie vratilo sem", () => {
    process.env.AUTH_SERVICE_URL = "https://login.test/";
    delete process.env.AUTH_SERVICE_APP_KEY;

    expect(serviceSignOutUrl()).toBe("https://login.test/logout?app=prehlady");
  });

  it("kluc appky sa da prekonfigurovat", () => {
    process.env.AUTH_SERVICE_URL = "https://login.test";
    process.env.AUTH_SERVICE_APP_KEY = "ine";

    expect(serviceSignOutUrl()).toBe("https://login.test/logout?app=ine");
  });
});
