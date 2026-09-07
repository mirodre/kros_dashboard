"use client";

import { createContext, useContext, useEffect } from "react";

import { preferenceStore } from "@/lib/use-preference";

const ViewerSubContext = createContext<string | null>(null);

/**
 * Načíta serverové nastavenia raz po štarte appky.
 *
 * Načítanie je zámerne AŽ v efekte: stránky sa medzitým vykreslia z `localStorage`, takže
 * človek nevidí nefiltrovaný dashboard a potom preskok. Keď server neodpovie, ostáva
 * lokálny stav — appka je PWA a musí fungovať aj offline.
 */
export function PreferencesBoot({
  viewerSub,
  children
}: {
  viewerSub: string | null;
  children: React.ReactNode;
}) {
  useEffect(() => {
    void preferenceStore().load();
  }, []);

  return <ViewerSubContext.Provider value={viewerSub}>{children}</ViewerSubContext.Provider>;
}

/** `sub` prihláseného človeka — len na rozlíšenie „toto som nastavil ja" od „nastavil kolega". */
export function useViewerSub(): string | null {
  return useContext(ViewerSubContext);
}
