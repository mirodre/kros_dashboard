import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";

import { decryptToken, encryptToken, tokenKey } from "@/lib/token-crypto";

const key = randomBytes(32);

describe("sifrovanie tokenov", () => {
  it("zasifrovany token sa desifruje na povodnu hodnotu", () => {
    const token = "kros-token-abc123";

    expect(decryptToken(encryptToken(token, key), key)).toBe(token);
  });

  it("dve zasifrovania toho isteho tokenu nie su rovnake", () => {
    // Rovnake IV s rovnakym klucom je v GCM katastrofa, nie drobnost.
    const prve = encryptToken("rovnaky", key);
    const druhe = encryptToken("rovnaky", key);

    expect(prve.equals(druhe)).toBe(false);
  });

  it("iny kluc zlyha hlasno, nie ticho prazdnym retazcom", () => {
    const zasifrovane = encryptToken("kros-token-abc123", key);

    expect(() => decryptToken(zasifrovane, randomBytes(32))).toThrow();
  });

  it("zmeneny obsah neprejde ako platny token", () => {
    // GCM dava aj autenticitu: rucne upraveny riadok v DB sa ohlasi chybou.
    const zasifrovane = encryptToken("kros-token-abc123", key);
    zasifrovane[zasifrovane.length - 1] ^= 0xff;

    expect(() => decryptToken(zasifrovane, key)).toThrow();
  });

  it("prilis kratky payload sa odmietne", () => {
    expect(() => decryptToken(Buffer.alloc(8), key)).toThrow(/poškodený/);
  });

  it("chybajuci kluc v prostredi je zrozumitelna chyba konfiguracie", () => {
    const povodny = process.env.KROS_TOKEN_KEY;
    delete process.env.KROS_TOKEN_KEY;

    expect(() => tokenKey()).toThrow(/KROS_TOKEN_KEY/);

    process.env.KROS_TOKEN_KEY = "kratky";
    expect(() => tokenKey()).toThrow(/32 bajtov/);

    if (povodny === undefined) delete process.env.KROS_TOKEN_KEY;
    else process.env.KROS_TOKEN_KEY = povodny;
  });
});
