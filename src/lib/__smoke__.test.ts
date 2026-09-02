import { describe, expect, it } from "vitest";

import { formatCurrency } from "@/lib/format";

describe("testovaci harness", () => {
  it("vie importovat cez alias @/", () => {
    // Zmysel tohto testu je jediný: dokázať, že vitest.config.ts alias naozaj funguje.
    // Keby nie, všetky ďalšie testy by padali na nezmyselnú chybu importu.
    expect(typeof formatCurrency).toBe("function");
  });
});
