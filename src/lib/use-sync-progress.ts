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
  /** Odhad zvyšného času; chýba, kým nie je hotový prvý krok. */
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
    setProgress((prev) => (prev ? { ...prev, label } : prev));
  }, []);

  /** Priemerný čas hotových krokov je zároveň odhadom zvyšku. */
  const completeStep = useCallback(() => {
    setProgress((prev) => {
      if (!prev) return prev;
      const done = Math.min(prev.done + 1, prev.total);
      const remaining = prev.total - done;
      const elapsed = Date.now() - startedAtRef.current;
      return {
        ...prev,
        done,
        etaSeconds: remaining > 0 ? ((elapsed / done) * remaining) / 1000 : undefined
      };
    });
  }, []);

  const endSync = useCallback(() => setProgress(null), []);

  return { progress, beginSync, startStep, completeStep, endSync };
}
