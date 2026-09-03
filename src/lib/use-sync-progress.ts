"use client";

import { useCallback, useRef, useState } from "react";

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
  /** Krátky popis do mriežky krokov (napr. `aug`); inak sa použije `label`. */
  short?: string;
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

const MONTH_LABEL_FORMAT = new Intl.DateTimeFormat("sk-SK", { month: "long", year: "numeric" });
const MONTH_SHORT_FORMAT = new Intl.DateTimeFormat("sk-SK", { month: "short" });

function parseMonthKey(monthKey: string) {
  const [year, month] = monthKey.split("-").map(Number);
  return year && month ? new Date(year, month - 1, 1) : null;
}

/** `2026-08` → `august 2026`. */
export function formatMonthKeyLabel(monthKey: string) {
  const date = parseMonthKey(monthKey);
  return date ? MONTH_LABEL_FORMAT.format(date) : monthKey;
}

/** `2026-08` → `aug` (mimo aktuálneho roka aj s rokom: `aug 25`). */
export function formatMonthKeyShort(monthKey: string) {
  const date = parseMonthKey(monthKey);
  if (!date) return monthKey;
  const short = MONTH_SHORT_FORMAT.format(date).replace(".", "");
  if (date.getFullYear() === new Date().getFullYear()) return short;
  return `${short} ${String(date.getFullYear()).slice(2)}`;
}

/** Zvyšný čas do konca sťahovania; `null`, kým sa nedá odhadnúť. */
export function formatSyncEta(etaSeconds: number | undefined) {
  if (etaSeconds === undefined || etaSeconds <= 0) return null;
  if (etaSeconds < 60) return `~ ${Math.max(Math.ceil(etaSeconds), 1)} s`;
  return `~ ${Math.ceil(etaSeconds / 60)} min`;
}

/** Podiel hotovej práce (0–1) vrátane rozrobeného kroku. */
export function getSyncFraction(progress: SyncProgress) {
  if (progress.steps.length === 0) return 0;
  return Math.min(1, (progress.doneCount + progress.stepFraction) / progress.steps.length);
}

export function useSyncProgress() {
  const [progress, setProgress] = useState<SyncProgress | null>(null);
  const startedAtRef = useRef(0);

  /** Otvorí sťahovanie na známy plán krokov; prázdny plán ho zavrie. */
  const beginSync = useCallback((steps: SyncStep[], immersive: boolean) => {
    startedAtRef.current = Date.now();
    setProgress(
      steps.length > 0
        ? { steps, activeIndex: -1, doneCount: 0, stepFraction: 0, immersive }
        : null
    );
  }, []);

  const startStep = useCallback((index: number) => {
    setProgress((prev) =>
      prev ? { ...prev, activeIndex: index, stepFraction: 0, detail: undefined } : prev
    );
  }, []);

  /**
   * Priebeh vnútri rozrobeného kroku — sťahovanie výdavkov ho hlási streamom,
   * takže sa progress hýbe aj počas dlhého mesiaca.
   */
  const advanceStep = useCallback((fraction: number, detail?: string) => {
    setProgress((prev) => {
      if (!prev) return prev;
      const stepFraction = Math.min(Math.max(fraction, 0), 1);
      return {
        ...prev,
        stepFraction,
        detail,
        etaSeconds: estimateEta(prev.doneCount + stepFraction, prev.steps.length, startedAtRef.current)
      };
    });
  }, []);

  const completeStep = useCallback(() => {
    setProgress((prev) => {
      if (!prev) return prev;
      const doneCount = Math.min(prev.doneCount + 1, prev.steps.length);
      return {
        ...prev,
        doneCount,
        stepFraction: 0,
        detail: undefined,
        etaSeconds: estimateEta(doneCount, prev.steps.length, startedAtRef.current)
      };
    });
  }, []);

  const endSync = useCallback(() => setProgress(null), []);

  return { progress, beginSync, startStep, advanceStep, completeStep, endSync };
}

/**
 * Odhad zvyšku z priemeru doteraz hotovej práce. Na úplnom začiatku odhad
 * nedávame — z pár sekúnd a zlomku kroku by vyšlo číslo, ktoré by len skákalo.
 */
function estimateEta(units: number, total: number, startedAt: number) {
  const remaining = total - units;
  const elapsed = Date.now() - startedAt;
  if (remaining <= 0 || units < 0.2 || elapsed < 3000) return undefined;
  return ((elapsed / units) * remaining) / 1000;
}
