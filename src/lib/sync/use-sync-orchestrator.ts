"use client";

import { startTransition, useCallback, useEffect, useRef, useState } from "react";
import type { Granularity } from "@/lib/mock-data";
import type { KrosConnection } from "@/lib/kros-types";
import { useSyncProgress } from "@/lib/use-sync-progress";
import { EMPTY_SYNC_DATA, type AnySyncEngine, type SyncData } from "./types";

const LAST_SYNC_STORAGE_KEY = "kros_dashboard_last_sync_at";

/** Od koľkých krokov je sťahovanie „na dlho" a patrí naň celá obrazovka. */
const IMMERSIVE_STEP_THRESHOLD = 3;

type Options = {
  /** Všetky prepojené firmy — prázdne pole znamená demo režim. */
  connections: KrosConnection[];
  /** Firmy po aplikovaní filtra; len tie sa synchronizujú. */
  syncConnections: KrosConnection[];
  granularity: Granularity;
  /**
   * Prvý render beží ešte pred pripojením k store-u nastavení, takže sa sťahovanie
   * odkladá o tik. Bez toho by prvý fetch šiel s prázdnym filtrom a hneď za ním
   * druhý so skutočným.
   */
  enabled: boolean;
};

/**
 * Poháňa sťahovanie pre ľubovoľnú kombináciu domén. Modul si vypýta jeden engine,
 * Domov tri — plány sa zreťazia za seba a bežia pod JEDNÝM ukazovateľom priebehu.
 * To je dôvod, prečo enginy o `sync-progress-store` nevedia: vlastník musí byť
 * jeden, inak si dve domény prepisujú ten istý ukazovateľ.
 *
 * Pole `engines` musí byť modulová konštanta, nie literál v tele komponentu —
 * inak sa efekt spustí pri každom rendere odznova.
 */
export function useSyncOrchestrator(engines: AnySyncEngine[], options: Options) {
  const { connections, syncConnections, granularity, enabled } = options;
  const [data, setData] = useState<SyncData>(EMPTY_SYNC_DATA);
  const [isSyncing, setIsSyncing] = useState(false);
  const [hasResolvedFirstData, setHasResolvedFirstData] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const handledRefreshNonceRef = useRef(0);
  const { beginSync, startStep, advanceStep, completeStep, endSync } = useSyncProgress();

  const refresh = useCallback(() => setRefreshNonce((value) => value + 1), []);

  useEffect(() => {
    if (!enabled) return;

    // Bez prepojenia (demo) aj bez prieniku filtra s prepojenými firmami je výsledok
    // ten istý: prázdne dáta a hotovo. Rozdiel medzi tými dvoma stavmi rieši stránka,
    // nie sťahovanie.
    if (connections.length === 0 || syncConnections.length === 0) {
      setData(EMPTY_SYNC_DATA);
      setIsSyncing(false);
      setHasResolvedFirstData(true);
      setError(null);
      endSync();
      return;
    }

    const abortController = new AbortController();
    const companyIds = syncConnections.map((connection) => connection.companyId);
    const isManualRefresh = refreshNonce !== handledRefreshNonceRef.current;

    const hydrateAll = async () => {
      const parts = await Promise.all(engines.map((engine) => engine.hydrate(companyIds)));
      const merged = parts.reduce<SyncData>(
        (accumulator, part) => ({ ...accumulator, ...part }),
        { ...EMPTY_SYNC_DATA }
      );
      if (!abortController.signal.aborted) {
        // Prepočet dashboardu z dokladov je drahý. Ako transition ho React vie
        // prerušiť, keď medzitým klikneš v menu — appka tak ostáva ovládateľná.
        startTransition(() => setData(merged));
        setHasResolvedFirstData(true);
      }
      return merged;
    };

    const countRows = (value: SyncData) =>
      value.invoices.length + value.expenses.length + value.accounts.length + value.transactions.length;

    const run = async () => {
      const cached = await hydrateAll();
      setError(null);

      try {
        // Najprv plán: čo všetko treba stiahnuť. Počet krokov je podklad pre
        // ukazovateľ priebehu, preto ho zisťujeme ešte pred prvým fetchom.
        const planned: { engine: AnySyncEngine; step: unknown }[] = [];
        for (const engine of engines) {
          const steps = await engine.plan({
            connections: syncConnections,
            companyIds,
            granularity,
            isManualRefresh,
            signal: abortController.signal
          });
          for (const step of steps) planned.push({ engine, step });
        }

        if (abortController.signal.aborted) return;

        // Bez dát na obrazovke (alebo pri práci na dlho) sťahujeme naplno,
        // krátke dosynchronizovanie nad existujúcimi dátami stačí v hlavičke.
        beginSync(
          planned.map(({ engine, step }) => engine.describe(step)),
          countRows(cached) === 0 || planned.length >= IMMERSIVE_STEP_THRESHOLD
        );
        if (planned.length === 0) return;

        setIsSyncing(true);
        // Log KROS volaní čistíme raz na začiatku sťahovania, nie raz za modul —
        // inak by Domov premazal to, čo práve zapísal jeho vlastný prvý engine.
        await fetch("/api/kros/logs", { method: "DELETE" });

        for (const [index, { engine, step }] of planned.entries()) {
          if (abortController.signal.aborted) return;

          startStep(index);
          await engine.run(step, {
            signal: abortController.signal,
            onProgress: advanceStep
          });
          completeStep();
          await hydrateAll();
        }

        localStorage.setItem(LAST_SYNC_STORAGE_KEY, new Date().toISOString());
      } catch (caught) {
        if (!abortController.signal.aborted) {
          setError(caught instanceof Error ? caught.message : "Načítanie dát zlyhalo.");
        }
      } finally {
        if (!abortController.signal.aborted) {
          handledRefreshNonceRef.current = refreshNonce;
          setIsSyncing(false);
          endSync();
        }
      }
    };

    run();

    return () => abortController.abort();
  }, [
    engines,
    connections,
    syncConnections,
    granularity,
    enabled,
    refreshNonce,
    beginSync,
    startStep,
    advanceStep,
    completeStep,
    endSync
  ]);

  return { data, isSyncing, hasResolvedFirstData, error, refresh };
}
