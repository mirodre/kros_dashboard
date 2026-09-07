/**
 * Uložený výber firiem sa aplikuje ako PRIENIK s tým, čo je na tomto zariadení dostupné.
 *
 * Kým filtre žili v prehliadači, bola nezhoda výnimka. Odkedy sú viazané na firmu a človek
 * ich má na každom zariadení, je to bežný stav: notebook prepojený na tri firmy, telefón na
 * jednu. Tichá nula je najhoršia možná odpoveď — vyzerá ako „firma nemá tržby", nie ako
 * „tento filter sem nesedí". Preto príznak `noneAvailable`, ktorý si stránka premieta do
 * hlášky.
 */
export type CompanyFilterResult<T> = {
  /** Firmy, s ktorými sa má pracovať. Prázdny výber znamená všetky dostupné. */
  companies: T[];
  /** Výber nie je prázdny, ale ani jedna vybraná firma tu nie je dostupná. */
  noneAvailable: boolean;
};

export function applyCompanyFilter<T>(
  available: readonly T[],
  selected: readonly string[],
  nameOf: (item: T) => string
): CompanyFilterResult<T> {
  if (selected.length === 0) {
    return { companies: [...available], noneAvailable: false };
  }

  const wanted = new Set(selected);
  const companies = available.filter((item) => wanted.has(nameOf(item)));

  return {
    companies,
    // Bez pripojenia nie je čo filtrovať — vtedy je na mieste hláška o prepojení s KROS,
    // nie o nesediacom filtri.
    noneAvailable: companies.length === 0 && available.length > 0
  };
}
