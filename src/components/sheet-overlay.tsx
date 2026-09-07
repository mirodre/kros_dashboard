"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

type Props = {
  children: React.ReactNode;
  /** Zavretie po kliknutí na stmavené pozadie. Samotný obsah si klik zastaví sám. */
  onClose: () => void;
};

/**
 * Spodné dialógy (zoznam dokladov, filtre, potvrdenia) vykresľujeme portálom priamo
 * do `document.body`.
 *
 * Dôvod: `.app-shell` má `isolation: isolate`, teda vlastný stacking context, a hlavné
 * menu žije v `layout.tsx` ako jeho súrodenec. Čokoľvek vnútri `.app-shell` preto
 * ostáva POD menu, nech má akokoľvek vysoký z-index — menu potom prekrylo spodok
 * dialógu a pri krátkom zozname (jeden doklad) z neho nebolo vidieť nič. Portálom sa
 * dialóg dostane na rovnakú úroveň ako menu a jeho z-index (`.tag-filter-overlay`)
 * už reálne platí.
 */
export function SheetOverlay({ children, onClose }: Props) {
  // Portál sa dá otvoriť až po pripojení na klientovi — počas SSR `document` nie je.
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  if (!isMounted) return null;

  return createPortal(
    <div className="tag-filter-overlay" onClick={onClose} role="presentation">
      {children}
    </div>,
    document.body
  );
}
