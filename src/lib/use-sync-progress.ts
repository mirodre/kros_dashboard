"use client";

import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import {
  clearSyncProgressForOwner,
  getServerSyncProgressSnapshot,
  getSyncProgressSnapshot,
  subscribeToSyncProgress,
  updateSyncProgress,
  writeSyncProgress
} from "@/lib/sync-progress-store";
import type { SyncProgress, SyncStep } from "@/lib/sync-progress-types";

export type { SyncProgress, SyncStep };

const MONTH_LABEL_FORMAT = new Intl.DateTimeFormat("sk-SK", { month: "long", year: "numeric" });

function parseMonthKey(monthKey: string) {
  const [year, month] = monthKey.split("-").map(Number);
  return year && month ? new Date(year, month - 1, 1) : null;
}

/** `2026-08` → `august 2026`. */
export function formatMonthKeyLabel(monthKey: string) {
  const date = parseMonthKey(monthKey);
  return date ? MONTH_LABEL_FORMAT.format(date) : monthKey;
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

/** Aktuálny priebeh sťahovania — pre komponenty, ktoré ho zobrazujú. */
export function useSyncProgressValue() {
  return useSyncExternalStore(
    subscribeToSyncProgress,
    getSyncProgressSnapshot,
    getServerSyncProgressSnapshot
  );
}

/**
 * Ovládanie priebehu pre stránku, ktorá dáta sťahuje. Zámerne nevracia samotný
 * priebeh: stránka ho nepotrebuje vykresliť (robí to `DashboardShell`) a keby
 * ho čítala, každý krok sťahovania by opäť prekresľoval celý modul.
 */
export function useSyncProgress() {
  const ownerRef = useRef<object>({});
  const startedAtRef = useRef(0);

  /** Otvorí sťahovanie na známy plán krokov; prázdny plán ho zavrie. */
  const beginSync = useCallback((steps: SyncStep[], immersive: boolean) => {
    startedAtRef.current = Date.now();
    writeSyncProgress(
      ownerRef.current,
      steps.length > 0
        ? { steps, activeIndex: -1, doneCount: 0, stepFraction: 0, immersive }
        : null
    );
  }, []);

  const startStep = useCallback((index: number) => {
    updateSyncProgress(ownerRef.current, (prev) => ({
      ...prev,
      activeIndex: index,
      stepFraction: 0,
      detail: undefined
    }));
  }, []);

  /**
   * Priebeh vnútri rozrobeného kroku — sťahovanie výdavkov ho hlási streamom,
   * takže sa progress hýbe aj počas dlhého mesiaca.
   */
  const advanceStep = useCallback((fraction: number, detail?: string) => {
    updateSyncProgress(ownerRef.current, (prev) => {
      const stepFraction = Math.min(Math.max(fraction, 0), 1);
      return {
        ...prev,
        stepFraction,
        detail,
        etaSeconds: estimateEta(
          prev.doneCount + stepFraction,
          prev.steps.length,
          startedAtRef.current
        )
      };
    });
  }, []);

  const completeStep = useCallback(() => {
    updateSyncProgress(ownerRef.current, (prev) => {
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

  const endSync = useCallback(() => writeSyncProgress(ownerRef.current, null), []);

  // Odchod na iný modul priebeh zavrie — inak by na novej stránke ostal visieť
  // ukazovateľ zo sťahovania, ktoré sme opustili.
  useEffect(() => {
    const owner = ownerRef.current;
    return () => clearSyncProgressForOwner(owner);
  }, []);

  return { beginSync, startStep, advanceStep, completeStep, endSync };
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
