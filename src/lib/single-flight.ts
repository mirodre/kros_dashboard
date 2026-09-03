/**
 * Deduplikácia súbežných volaní tej istej operácie s tým istým kľúčom: prvý volajúci
 * operáciu spustí, ostatní dostanú TEN ISTÝ prebiehajúci prísľub.
 *
 * Existuje kvôli rotácii refresh tokenov. Session žije len v šifrovanej cookie, takže
 * súbežné requesty dekódujú tú istú cookie, uvidia ten istý `refreshedAt` a bez tejto
 * ochrany by každý z nich zavolal obnovu s tým ISTÝM refresh tokenom. Passport starý
 * token pri rotácii revokuje (`$revokeRefreshTokenAfterUse = true`), takže druhé použitie
 * dostane 4xx `Token has been revoked` — teda `SsoAuthFailed` — a človeka to odhlási.
 * Prechodný stav súbežnosti by sa prečítal ako „služba povedala nie".
 *
 * Fáza 2 (`payment_connector`) na to nenarazila, pretože tokeny drží v serverovej Laravel
 * session a session lock súbežné requesty tej istej session serializuje. Bezstavová cookie
 * ten lock nemá, takže si ho appka musí spraviť sama.
 *
 * VÝHRADA PRE ŠKÁLOVANIE: `Map` je v pamäti jedného procesu. Chráni súbežnosť v rámci
 * jednej instancie Node (dnes appka beží ako jedna). Ak by raz bežala vo viacerých
 * replikách alebo vo viacerých runtime instanciách naraz, každá by mala vlastnú mapu
 * a dve repliky by sa o rotovaný token znova pobili — vtedy treba zdieľaný stav
 * (Redis lock, alebo tokeny v serverovej session ako vo fáze 2).
 *
 * Funkcia je čistá fabrika: stav si drží vrátený uzáver, nie modul. Vďaka tomu si každý
 * test vyrobí vlastnú, izolovanú instanciu a modul sa dá testovať bez siete.
 */
export function singleFlight<T>(
  operation: (key: string) => Promise<T>
): (key: string) => Promise<T> {
  const inFlight = new Map<string, Promise<T>>();

  return (key: string): Promise<T> => {
    const running = inFlight.get(key);

    if (running !== undefined) {
      return running;
    }

    // Volanie je ZÁMERNE mimo try/catch a pred `set`: keby operácia hodila synchrónne,
    // do mapy sa nesmie dostať prísľub, ktorý nikto neuvolní.
    const started = operation(key);

    inFlight.set(key, started);

    // Uvoľnenie pri settle, nie len pri úspechu — inak by prvé zlyhanie zamrzlo kľúč
    // navždy a session s tým refresh tokenom by sa už nikdy neobnovila. Obe vetvy `then`
    // sú aj tichým konzumentom prípadného odmietnutia, takže z tejto linky nevznikne
    // „unhandled rejection"; samotné odmietnutie dostanú všetci volajúci nedotknuté.
    const release = (): void => {
      inFlight.delete(key);
    };

    started.then(release, release);

    return started;
  };
}
