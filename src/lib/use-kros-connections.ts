"use client";

import { useCallback, useEffect, useState } from "react";

import { clearLegacyConnections, readLegacyConnections } from "./kros-storage";
import type { KrosConnection } from "./kros-types";

export type KrosConnectionsState = {
  connections: KrosConnection[];
  /** Kým beží prvé načítanie, nevieme, či firma prepojenia má — a nemá sa to hádať. */
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  disconnect: (companyId: number) => Promise<boolean>;
};

/**
 * Prepojenia firmy zo servera. Prehliadač dostáva len zoznam firiem — token zostáva na
 * serveri, takže na novom zariadení netreba nič preklikávať a XSS nemá čo ukradnúť.
 *
 * Súčasťou je jednorazový presun toho, čo ľuďom ostalo v `localStorage` z čias pred fázou 2:
 * nahrá sa na server a z prehliadača sa zmaže.
 */
export function useKrosConnections(): KrosConnectionsState {
  const [connections, setConnections] = useState<KrosConnection[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const legacy = readLegacyConnections();
      if (legacy.length > 0) {
        const response = await fetch("/api/kros/connections", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ connections: legacy })
        });
        // Až po potvrdenom uložení: kým sa nahrať nepodarí, sú tie tokeny jediná kópia.
        if (response.ok) clearLegacyConnections();
      }

      const response = await fetch("/api/kros/connections", { cache: "no-store" });
      const payload = (await response.json()) as { connections?: KrosConnection[]; error?: string };

      if (!response.ok) {
        setError(payload?.error ?? "Prepojenia sa nepodarilo načítať.");
        return;
      }

      setConnections(Array.isArray(payload.connections) ? payload.connections : []);
      setError(null);
    } catch {
      setError("Server neodpovedal, prepojenia sa nepodarilo načítať.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  const disconnect = useCallback(
    async (companyId: number) => {
      try {
        const response = await fetch("/api/kros/connections", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ companyId })
        });
        if (!response.ok) return false;
      } catch {
        return false;
      }

      await refresh();
      return true;
    },
    [refresh]
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { connections, isLoading, error, refresh, disconnect };
}
