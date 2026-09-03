/**
 * Jeden krok sťahovania tak, ako ho vidí používateľ — `group` je firma,
 * `label` obdobie alebo druh dát. Plán krokov poznáme pred prvým fetchom, takže
 * ho vieme aj vykresliť: načítavanie potom nie je nekonečný loader, ale mapa
 * práce, na ktorej sa vidí posun.
 */
export type SyncStep = {
  key: string;
  group: string;
  label: string;
};

export type SyncProgress = {
  steps: SyncStep[];
  /** Index práve sťahovaného kroku; -1 pred prvým krokom. */
  activeIndex: number;
  doneCount: number;
  /** Podiel rozrobeného kroku (0–1) — priebeh vnútri mesiaca. */
  stepFraction: number;
  /** Bližší popis rozrobeného kroku, napr. „doklady 96/214“. */
  detail?: string;
  /** Odhad zvyšného času; chýba, kým sa nedá rozumne spočítať. */
  etaSeconds?: number;
  /**
   * Sťahovanie na celú obrazovku. Zapíname, keď na obrazovke ešte nie sú dáta
   * alebo keď je práce na dlho — pri krátkom dosynchronizovaní nad existujúcimi
   * dátami stačí tenký pás v hlavičke.
   */
  immersive: boolean;
};
