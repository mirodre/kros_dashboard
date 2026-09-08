/**
 * Farby výsekov koláčových a donut grafov — jeden zdroj pre Domov, Financie aj
 * Výdavky, aby paleta neušla, keď sa upraví len na jednom mieste.
 *
 * Poradie je zámerné: susedné odtiene sa striedajú medzi chladnými a teplými,
 * aby dva vedľajšie výseky nikdy nesplynuli. Nové farby preto pridávaj na
 * koniec — vsunutím doprostred by sa všetkým existujúcim výsekom preskupili
 * farby a používateľ by po nasadení videl iný graf pri tých istých dátach.
 *
 * Pozor: `#34d399` a `#f87171` z tejto palety sú zároveň ručne prepísané v
 * `globals.css` ako YoY farby stĺpcov hlavného grafu (`.bar-yoy-up` /
 * `.bar-yoy-down`) — CSS si TypeScript naimportovať nevie. Keď sa tieto dva
 * odtiene menia, treba ich prepísať aj tam.
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
