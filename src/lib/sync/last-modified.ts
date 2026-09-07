/**
 * Značka `LastModifiedTimestamp`, od ktorej sa pýtame zmeny, posunutá o 5 minút
 * späť. Prekryv je zámerný: hodiny KROSu a naše nemusia sedieť na sekundu
 * a doklad, ktorý by padol do medzery, by sa už nikdy nedosynchronizoval.
 *
 * KROS API značku očakáva bez časovej zóny A BEZ ZLOMKU SEKUNDY, preto sa skladá
 * ručne z UTC zložiek a sekundy sa zaokrúhľujú dole. So zlomkom (`...29.2` aj
 * `...29.200`) API filter potichu zahodí a vráti CELÚ históriu — merané na jednej
 * firme: 433 dokladov namiesto jedného. Keďže značka z KROSu zlomok skoro vždy
 * má, bez tohto orezania sa z každého ručného obnovenia stane plné sťahovanie.
 *
 * Orezanie posúva okno len dole (o zlomok sekundy), takže žiadnu zmenu nezmešká.
 */
export function withLastModifiedOverlap(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  date.setMinutes(date.getMinutes() - 5);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const hours = String(date.getUTCHours()).padStart(2, "0");
  const minutes = String(date.getUTCMinutes()).padStart(2, "0");
  const seconds = String(date.getUTCSeconds()).padStart(2, "0");
  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}`;
}

/**
 * Najnovšia značka zmeny v dávke. `fallback` je predchádzajúca značka firmy —
 * dávka bez zmien ju nesmie zahodiť, inak by sa inkrementálny sync vrátil
 * na začiatok a stiahol všetko odznova.
 */
export function getMaxLastModified<T extends { lastModifiedTimestamp?: string }>(
  items: T[],
  fallback?: string
) {
  return items.reduce<string | undefined>((max, item) => {
    if (!item.lastModifiedTimestamp) return max;
    if (!max) return item.lastModifiedTimestamp;
    return new Date(item.lastModifiedTimestamp).getTime() > new Date(max).getTime()
      ? item.lastModifiedTimestamp
      : max;
  }, fallback);
}
