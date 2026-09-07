import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Šifrovanie KROS tokenov v pokoji. Token je dlhodobý prístup k účtovným dátam firmy —
 * v databáze nesmie ležať čitateľný, aby jej záloha alebo dump neboli rovno prístupom
 * do KROS.
 *
 * AES-256-GCM: dáva aj autenticitu, takže zmenený riadok sa pri dešifrovaní ohlási chybou
 * a neprejde ako platný token. Vlastné IV per riadok — opakované IV s tým istým kľúčom je
 * v GCM katastrofa, nie drobnosť.
 */
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;

/** Kľúč z prostredia. Chýbajúci alebo pokazený je chyba konfigurácie, nie stav na prežitie. */
export function tokenKey(): Buffer {
  const raw = (process.env.KROS_TOKEN_KEY ?? "").trim();

  if (!raw) {
    throw new Error(
      "KROS_TOKEN_KEY nie je nastavená — bez nej sa prepojenia na KROS nedajú uložiť. Vygeneruj: openssl rand -base64 32"
    );
  }

  const key = Buffer.from(raw, "base64");
  if (key.length !== KEY_BYTES) {
    throw new Error(`KROS_TOKEN_KEY musí byť 32 bajtov v base64 (má ${key.length}).`);
  }

  return key;
}

export function encryptToken(plaintext: string, key: Buffer = tokenKey()): Buffer {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);

  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]);
}

export function decryptToken(payload: Buffer, key: Buffer = tokenKey()): string {
  if (payload.length <= IV_BYTES + TAG_BYTES) {
    throw new Error("Zašifrovaný token je poškodený (príliš krátky).");
  }

  const iv = payload.subarray(0, IV_BYTES);
  const tag = payload.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const encrypted = payload.subarray(IV_BYTES + TAG_BYTES);

  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);

  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}
