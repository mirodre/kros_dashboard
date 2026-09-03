"use client";

import { useCallback, useRef, useState } from "react";

/**
 * Priebeh sťahovania dát z KROS API. Sync beží po krokoch (firma × mesiac,
 * prípadne firma × druh dát), ktoré poznáme ešte pred prvým fetchom — progress
 * bar preto ukazuje reálny podiel hotového, nie nekonečný loader.
 */
export type SyncProgress = {
  /** Počet dokončených krokov. */
  done: number;
  /** Celkový počet naplánovaných krokov. */
  total: number;
  /** Čo sa práve sťahuje, napr. „Firma s.r.o. · august 2026“. */
  label?: string;
  /** Podiel rozrobeného kroku (0–1) — priebeh vnútri mesiaca. */
  stepFraction?: number;
  /** Bližší popis rozrobeného kroku, napr. „rozúčtovanie 38/214“. */
  detail?: string;
  /** Odhad zvyšného času; chýba, kým sa nedá rozumne spočítať. */
  etaSeconds?: number;
};

const MONTH_LABEL_FORMAT = new Intl.DateTimeFormat("sk-SK", { month: "long", year: "numeric" });

/** `2026-08` → `august 2026` — popis práve sťahovaného mesiaca. */
export function formatMonthKeyLabel(monthKey: string) {
  const [year, month] = monthKey.split("-").map(Number);
  if (!year || !month) return monthKey;
  return MONTH_LABEL_FORMAT.format(new Date(year, month - 1, 1));
}

/** Zvyšný čas do konca sťahovania; `null`, kým sa nedá odhadnúť. */
export function formatSyncEta(etaSeconds: number | undefined) {
  if (etaSeconds === undefined || etaSeconds <= 0) return null;
  if (etaSeconds < 60) return `~ ${Math.max(Math.ceil(etaSeconds), 1)} s`;
  return `~ ${Math.ceil(etaSeconds / 60)} min`;
}

export function useSyncProgress() {
  const [progress, setProgress] = useState<SyncProgress | null>(null);
  const startedAtRef = useRef(0);

  /** Otvorí progress bar na známy počet krokov; `total` 0 ho skryje. */
  const beginSync = useCallback((total: number) => {
    startedAtRef.current = Date.now();
    setProgress(total > 0 ? { done: 0, total } : null);
  }, []);

  const startStep = useCallback((label: string) => {
    setProgress((prev) => (prev ? { ...prev, label, stepFraction: 0, detail: undefined } : prev));
  }, []);

  /**
   * Priebeh vnútri rozrobeného kroku — sťahovanie výdavkov ho hlási streamom,
   * takže bar sa hýbe aj počas dlhého mesiaca.
   */
  const advanceStep = useCallback((fraction: number, detail?: string) => {
    setProgress((prev) => {
      if (!prev) return prev;
      const stepFraction = Math.min(Math.max(fraction, 0), 1);
      return {
        ...prev,
        stepFraction,
        detail,
        etaSeconds: estimateEta(prev.done + stepFraction, prev.total, startedAtRef.current)
      };
    });
  }, []);

  const completeStep = useCallback(() => {
    setProgress((prev) => {
      if (!prev) return prev;
      const done = Math.min(prev.done + 1, prev.total);
      return {
        ...prev,
        done,
        stepFraction: 0,
        detail: undefined,
        etaSeconds: estimateEta(done, prev.total, startedAtRef.current)
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
