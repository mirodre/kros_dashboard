/**
 * Farby výsekov koláčových a donut grafov — jeden zdroj pre Domov, Financie aj
 * Výdavky, aby paleta neušla, keď sa upraví len na jednom mieste.
 *
 * Poradie je zámerné: susedné odtiene sa striedajú medzi chladnými a teplými,
 * aby dva vedľajšie výseky nikdy nesplynuli. Nové farby preto pridávaj na
 * koniec — vsunutím doprostred by sa všetkým existujúcim výsekom preskupili
 * farby a používateľ by po nasadení videl iný graf pri tých istých dátach.
 *
 * Pozor: YoY farby stĺpcov hlavného grafu (`.bar-yoy-up` / `.bar-yoy-down`
 * v `globals.css`) sú odvodené z tejto palety a ručne prepísané — CSS si
 * TypeScript naimportovať nevie. Zelený stĺpec je `#34d399`, červený je stred
 * medzi `#f87171` a `#f472b6` (čistá červená v stĺpci kričala). Keď sa niektorý
 * z týchto troch odtieňov mení, treba ho prepísať aj tam.
 */
export const CHART_SLICE_COLORS = [
  "#7b99ff",
  "#f6b73c",
  "#34d399",
  "#a78bfa",
  "#f472b6",
  "#38bdf8",
  "#fb923c",
  "#2dd4bf",
  "#a3e635",
  "#f87171"
];

/** Fallback pre CSS premenné a prázdne stavy — prvá farba palety. */
export const CHART_SLICE_COLOR_FALLBACK = CHART_SLICE_COLORS[0];
