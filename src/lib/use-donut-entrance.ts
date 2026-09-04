"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Koľko po rozbehnutí animácie ešte platí, že sa graf „usádza“. Dáta prídu vo vlnách:
 * server render má defaulty, prvý paint v prehliadači hodnoty z `localStorage` a po
 * `PreferencesBoot` ešte serverové nastavenia (a v Príjmoch/Výdavkoch potom live doklady).
 * Bez tohto okna sa vstupná animácia rozbehla pri každej vlne — graf sa vykreslil dvakrát.
 */
const SETTLE_MS = 1200;

/**
 * Vracia, či má donut nasadenú vstupnú animáciu.
 *
 * `shapeKey` je podpis výsekov (názvy a sumy), nie identita poľa — prekreslenie s tými
 * istými výsekmi (napr. klik na štítok v samotnom grafe) animáciu nespustí.
 */
export function useDonutEntrance(shapeKey: string): boolean {
  const [isAnimated, setIsAnimated] = useState(false);
  const settleUntilRef = useRef<number | null>(null);

  useEffect(() => {
    // Prázdny graf sa nemá čím animovať a nesmie spáliť okno usadenia — inak by prvé
    // skutočné dáta prišli už „po štarte“ a naskočili bez animácie.
    if (!shapeKey) return;

    const now = Date.now();
    const settleUntil = settleUntilRef.current;
    if (settleUntil !== null && now < settleUntil) return;

    settleUntilRef.current = now + SETTLE_MS;
    setIsAnimated(false);
    const timeout = window.setTimeout(() => setIsAnimated(true), 70);
    return () => window.clearTimeout(timeout);
  }, [shapeKey]);

  return isAnimated;
}
