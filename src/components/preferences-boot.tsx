"use client";

import { createContext, useContext, useEffect } from "react";

import { preferenceStore } from "@/lib/use-preference";

const TenantNameContext = createContext<string | null>(null);
const ViewerSubContext = createContext<string | null>(null);

/**
 * Načíta serverové nastavenia raz po štarte appky a sprístupní názov firmy hlavičke.
 *
 * Načítanie je zámerne AŽ v efekte: stránky sa medzitým vykreslia z `localStorage`, takže
 * človek nevidí nefiltrovaný dashboard a potom preskok. Keď server neodpovie, ostáva
 * lokálny stav — appka je PWA a musí fungovať aj offline.
 */
export function PreferencesBoot({
  tenantName,
  viewerSub,
  children
}: {
  tenantName: string | null;
  viewerSub: string | null;
  children: React.ReactNode;
}) {
  useEffect(() => {
    void preferenceStore().load();
  }, []);

  return (
    <TenantNameContext.Provider value={tenantName}>
      <ViewerSubContext.Provider value={viewerSub}>{children}</ViewerSubContext.Provider>
    </TenantNameContext.Provider>
  );
}

/** Názov firmy, ktorej nastavenia sa práve menia. `null` = človek bez firmy. */
export function useTenantName(): string | null {
  return useContext(TenantNameContext);
}

/** `sub` prihláseného človeka — len na rozlíšenie „toto som nastavil ja" od „nastavil kolega". */
export function useViewerSub(): string | null {
  return useContext(ViewerSubContext);
}
