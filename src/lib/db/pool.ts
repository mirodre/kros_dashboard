import { Pool } from "pg";

/**
 * Pool je jeden na runtime inštanciu a drží sa na `globalThis`, nie v module scope: dev
 * server Next.js vyhodnocuje moduly znova pri každej zmene súboru, takže by vznikal nový
 * pool pri každom uložení a Postgres by po chvíli odmietal spojenia.
 */
declare global {
  // eslint-disable-next-line no-var -- globalThis typing requires `var`
  var __krosDashboardPool: Pool | undefined;
  // eslint-disable-next-line no-var -- globalThis typing requires `var`
  var __krosDashboardPoolWarned: boolean | undefined;
}

/**
 * `null` znamená „appka beží bez databázy" a je to platný stav, nie chyba: nastavenia sú
 * doplnok, nie podmienka behu. Dashboard musí fungovať aj s prázdnym `DATABASE_URL` —
 * inak by preklep v premennej zhodil celú appku kvôli zapamätaným filtrom.
 */
export function getPool(): Pool | null {
  const connectionString = (process.env.DATABASE_URL ?? "").trim();

  if (!connectionString) {
    if (!globalThis.__krosDashboardPoolWarned) {
      globalThis.__krosDashboardPoolWarned = true;
      console.warn(
        "DATABASE_URL nie je nastavená — nastavenia sa nebudú ukladať na server a ostanú len v prehliadači."
      );
    }
    return null;
  }

  globalThis.__krosDashboardPool ??= new Pool({
    connectionString,
    // Jedna replika, pár dotazov na request. Väčší pool by len držal spojenia, ktoré
    // Postgres počíta do svojho limitu.
    max: 5,
    connectionTimeoutMillis: 5000
  });

  return globalThis.__krosDashboardPool;
}
