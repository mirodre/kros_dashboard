"use client";

import { useEffect, useState } from "react";
import type { KrosConnection } from "./kros-types";
import {
  buildTagCategoryIndex,
  EMPTY_TAG_CATEGORY_INDEX,
  type TagCategoryIndex
} from "./tag-categories";

/**
 * Načíta kategórie štítkov z KROS (/api/kros/tags) pre pripojené firmy a vráti
 * index názov-štítku → kategória. Obnoví sa pri zmene firiem a pri manuálnom Sync
 * (`refreshNonce`).
 */
export function useTagCategoryIndex(
  connections: KrosConnection[],
  refreshNonce = 0
): TagCategoryIndex {
  const [index, setIndex] = useState<TagCategoryIndex>(EMPTY_TAG_CATEGORY_INDEX);
  const connectionKey = connections
    .map((connection) => connection.companyId)
    .sort((a, b) => a - b)
    .join(",");

  useEffect(() => {
    if (connections.length === 0) {
      setIndex(EMPTY_TAG_CATEGORY_INDEX);
      return;
    }

    const abortController = new AbortController();

    const loadTags = async () => {
      try {
        const response = await fetch("/api/kros/tags", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ companies: connections }),
          signal: abortController.signal
        });

        const payload = await response.json();
        if (!response.ok) return;

        const rawTags = Array.isArray(payload?.data) ? (payload.data as unknown[]) : [];
        if (!abortController.signal.aborted) {
          setIndex(buildTagCategoryIndex(rawTags));
        }
      } catch {
        // Kategórie sú doplnkové — ak sa nenačítajú, prehľad spadne na jedinú sekciu.
      }
    };

    loadTags();

    return () => abortController.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fetch podľa firiem + Sync
  }, [connectionKey, refreshNonce]);

  return index;
}
