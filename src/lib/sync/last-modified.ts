/**
 * Značka `LastModifiedTimestamp`, od ktorej sa pýtame zmeny, posunutá o 5 minút
 * späť. Prekryv je zámerný: hodiny KROSu a naše nemusia sedieť na sekundu
 * a doklad, ktorý by padol do medzery, by sa už nikdy nedosynchronizoval.
 *
 * KROS API značku očakáva bez časovej zóny, preto sa skladá ručne z UTC zložiek.
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
  const milliseconds = date.getUTCMilliseconds();
  const fraction =
    milliseconds > 0 ? `.${String(milliseconds).padStart(3, "0").replace(/0+$/, "")}` : "";
  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}${fraction}`;
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
