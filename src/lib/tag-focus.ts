/**
 * Rozkliknutý štítok si pamätá, v ktorej sekcii naň človek klikol.
 *
 * Dôvod: sekcia, v ktorej klik vznikol, sa vlastným focusom NEZUŽUJE — inak by po kliknutí
 * ostal jej zoznam prázdny alebo jednoriadkový a nedalo by sa preklikať na iný štítok.
 * Zvyšok prehľadu sa zúži vždy. Sekcie štítkov pod grafmi si to riešia podľa kategórie
 * (štítok patrí práve do jednej), donut Štruktúra výdavkov ale ukazuje štítky naprieč
 * kategóriami, takže sám seba vie odlíšiť len podľa toho, odkiaľ klik prišiel.
 */
export type FocusedTag = {
  tag: string;
  /** `true` = klik prišiel z donutu Štruktúra výdavkov (výsek alebo jeho legenda). */
  fromDonut: boolean;
};

/**
 * Nový zoznam focusnutých štítkov po kliknutí v sekcii. Štítky, ktoré vo focuse už boli,
 * si nechajú svoj pôvod — prepísať ho kliknutím inde by sekcii, kde focus vznikol, zrazu
 * vyprázdnilo zoznam.
 */
export function reconcileFocusedTags(
  previous: FocusedTag[],
  nextTags: string[],
  fromDonut: boolean
): FocusedTag[] {
  const previousByTag = new Map(previous.map((focused) => [focused.tag, focused]));
  const seen = new Set<string>();

  return nextTags.flatMap((tag) => {
    if (seen.has(tag)) return [];
    seen.add(tag);
    return [previousByTag.get(tag) ?? { tag, fromDonut }];
  });
}

/** Samotné názvy štítkov — pre grafy a zoznamy, ktoré sa zužujú celým focusom. */
export function focusedTagNames(focused: FocusedTag[]): string[] {
  return focused.map((item) => item.tag);
}

/** Focus, ktorý donut zužuje — teda všetko okrem klikov v ňom samotnom. */
export function focusOutsideDonut(focused: FocusedTag[]): string[] {
  return focused.filter((item) => !item.fromDonut).map((item) => item.tag);
}
