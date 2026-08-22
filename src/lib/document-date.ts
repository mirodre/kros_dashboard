/**
 * Dátumy dokladov (vystavenie, dodanie/DUZP, splatnosť) sú z pohľadu prehľadov
 * kalendárne dni, nie časové okamihy. KROS API ich ale vracia ako ISO reťazce,
 * ktoré môžu nesť aj čas či časovú zónu (napr. `2026-08-31T22:00:00Z`).
 *
 * `new Date(...)` taký reťazec preloží do lokálneho času, čím sa doklad vie
 * presunúť o deň dopredu alebo dozadu — a tým aj do iného týždňa, mesiaca či
 * roku v grafoch a KPI. Preto z reťazca berieme výhradne dátumovú zložku a čas
 * ignorujeme: doklad patrí do obdobia podľa dátumu, ktorý je na ňom napísaný.
 */

const ISO_DATE_PREFIX = /^(\d{4})-(\d{2})-(\d{2})/;
const SK_DATE = /^(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})/;

function localDate(year: number, month: number, day: number) {
  const date = new Date(year, month - 1, day);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Dátum dokladu ako lokálna polnoc — čas a časová zóna vstupu sa ignorujú.
 * Vracia `null`, ak sa dátum nedá prečítať (volajúci taký doklad vynechá).
 */
export function parseDocumentDate(value: string | null | undefined): Date | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;

  const iso = ISO_DATE_PREFIX.exec(trimmed);
  if (iso) return localDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  const sk = SK_DATE.exec(trimmed);
  if (sk) return localDate(Number(sk[3]), Number(sk[2]), Number(sk[1]));

  // Neznámy formát — necháme rozhodnúť engine, ale ponecháme si len deň.
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return null;
  return localDate(parsed.getFullYear(), parsed.getMonth() + 1, parsed.getDate());
}

/** Čas lokálnej polnoci dátumu dokladu; `null` pri nečitateľnom dátume. */
export function getDocumentDateTime(value: string | null | undefined): number | null {
  return parseDocumentDate(value)?.getTime() ?? null;
}

/** Dátum dokladu je použiteľný v prehľadoch. */
export function isValidDocumentDate(value: string | null | undefined): boolean {
  return parseDocumentDate(value) !== null;
}

/** Dátumová zložka v tvare `YYYY-MM-DD` (pre parametre KROS API). */
export function toDateOnlyString(value: string | null | undefined): string | null {
  const date = parseDocumentDate(value);
  if (!date) return null;
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/** Rovnaký kalendárny deň, bez ohľadu na čas vo vstupoch. */
export function isSameCalendarDay(value: string | null | undefined, reference: Date): boolean {
  const date = parseDocumentDate(value);
  if (!date) return false;
  return (
    date.getFullYear() === reference.getFullYear() &&
    date.getMonth() === reference.getMonth() &&
    date.getDate() === reference.getDate()
  );
}
