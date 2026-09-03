export type SingleFlightOptions = {
  /** Ako dlho (ms) sa úspešný výsledok podáva aj neskorším volajúcim s tým istým kľúčom. */
  retainMs: number;
  /** Hodiny, aby sa dalo testovať bez čakania. */
  nowMs: () => number;
};

type Entry<T> = {
  promise: Promise<T>;
  /** `null` = operácia ešte beží; číslo = okamih, kedy prestane platiť úspešný výsledok. */
  expiresAt: number | null;
};

/**
 * Deduplikácia volaní tej istej operácie s tým istým kľúčom: prvý volajúci operáciu spustí,
 * ostatní dostanú TEN ISTÝ prísľub — a to nielen počas jej behu, ale aj `retainMs` po jej
 * úspešnom skončení.
 *
 * Existuje kvôli rotácii refresh tokenov. Session žije len v šifrovanej cookie, takže
 * súbežné requesty dekódujú ten istý stav a bez tejto ochrany by každý z nich zavolal obnovu
 * s tým ISTÝM refresh tokenom. Passport starý token pri rotácii revokuje
 * (`$revokeRefreshTokenAfterUse = true`), takže druhé použitie dostane 4xx
 * `Token has been revoked` — teda `SsoAuthFailed` — a človeka to odhlási. Prechodný stav
 * súbežnosti by sa prečítal ako „služba povedala nie".
 *
 * PREČO SA ÚSPEŠNÝ VÝSLEDOK DRŽÍ, A NIE MAŽE PRI SETTLE. Rotovaná `Set-Cookie` odchádza na
 * odpovedi toho requestu, ktorý obnovu spustil (`node_modules/next-auth/lib/index.js`), a
 * routy `/api/kros/*` proxujú na `api-economy.kros.sk`, takže tá odpoveď môže visieť sekundy.
 * Prehliadač teda ešte niekoľko sekúnd po skončení obnovy posiela PÔVODNÚ cookie: request,
 * ktorý medzitým vznikne (klik na navigáciu, `<Link>` prefetch), by našiel prázdnu mapu a
 * zavolal token endpoint tokenom, ktorý služba už revokovala. To je presne symptóm R1, len
 * inými dverami. Podanie toho istého rotovaného páru neskorému volajúcemu nie je riskantnejšie
 * než jeho podanie súbežnému čakateľovi (čo kód robí od začiatku), pretože Passport rotuje
 * až pri POUŽITÍ tokenu.
 *
 * Okno je zámerne rádovo desiatky sekúnd: musí prekryť pomalú upstream odpoveď plus kliknutie,
 * ale musí byť hlboko pod TTL claimov (900 s), aby sa doň nikdy nezmestili dve rotácie tej
 * istej session — inak by neskorý volajúci dostal pár, ktorý medzitým stihla revokovať
 * ĎALŠIA rotácia.
 *
 * ODMIETNUTIA SA NEDRŽIA. Prechodná nedostupnosť služby má byť okamžite skúsiteľná znova;
 * podržať ju by z jedného bliknutia urobilo výpadok na celú dĺžku okna. Zapamätať si zlyhanie
 * navyše nič nechráni — nezrotovalo sa nič, čo by sa dalo stratiť.
 *
 * VÝHRADA PRE ŠKÁLOVANIE: `Map` je v pamäti jedného procesu. Chráni súbežnosť v rámci jednej
 * instancie Node (dnes appka beží ako jedna, a runbook `docs/SSO-prechod.md` to má ako
 * podmienku nasadenia). Ak by raz bežala vo viacerých replikách, každá by mala vlastnú mapu
 * a dve repliky by sa o rotovaný token znova pobili — vtedy treba zdieľaný stav (Redis lock,
 * alebo tokeny v serverovej session ako vo fáze 2).
 *
 * Funkcia je čistá fabrika: stav si drží vrátený uzáver, nie modul. Vďaka tomu si každý test
 * vyrobí vlastnú, izolovanú instanciu a modul sa dá testovať bez siete a bez čakania.
 */
export function singleFlight<T>(
  operation: (key: string) => Promise<T>,
  options: SingleFlightOptions
): (key: string) => Promise<T> {
  const entries = new Map<string, Entry<T>>();

  /**
   * Mapa nesmie rásť bez konca v procese, ktorý žije týždne. Zametá sa pri každom volaní,
   * takže záznamy zmiznú aj pre kľúče, ktoré sa už nikdy nezopakujú (každé prihlásenie
   * vyrobí nový refresh token, teda nový kľúč). Prebiehajúce operácie sa nezametajú nikdy.
   */
  const sweep = (at: number): void => {
    for (const [key, entry] of entries) {
      if (entry.expiresAt !== null && entry.expiresAt <= at) {
        entries.delete(key);
      }
    }
  };

  return (key: string): Promise<T> => {
    const at = options.nowMs();

    sweep(at);

    const existing = entries.get(key);

    if (existing !== undefined) {
      return existing.promise;
    }

    // Volanie je ZÁMERNE mimo try/catch a pred `set`: keby operácia hodila synchrónne,
    // do mapy sa nesmie dostať prísľub, ktorý nikto neuvolní.
    const started = operation(key);

    entries.set(key, { promise: started, expiresAt: null });

    // Obe vetvy `then` sú aj tichým konzumentom prípadného odmietnutia, takže z tejto linky
    // nevznikne „unhandled rejection"; samotné odmietnutie dostanú všetci volajúci nedotknuté.
    // Kontrola `entry.promise === started` je proti prepísaniu záznamu, ktorý medzitým vznikol
    // pre ten istý kľúč po zametení.
    const retain = (): void => {
      const entry = entries.get(key);

      if (entry?.promise === started) {
        entry.expiresAt = options.nowMs() + options.retainMs;
      }
    };

    const release = (): void => {
      const entry = entries.get(key);

      if (entry?.promise === started) {
        entries.delete(key);
      }
    };

    started.then(retain, release);

    return started;
  };
}
