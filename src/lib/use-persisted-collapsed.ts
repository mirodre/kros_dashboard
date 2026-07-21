"use client";

import { useEffect, useState } from "react";

/** Zapamätá zbalenie panela v localStorage (true = zbaliť). */
export function usePersistedCollapsed(storageKey: string, defaultCollapsed = false) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const [hasLoaded, setHasLoaded] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw === "1" || raw === "true") setCollapsed(true);
      else if (raw === "0" || raw === "false") setCollapsed(false);
    } catch {
      // Ignore invalid persisted value.
    } finally {
      setHasLoaded(true);
    }
  }, [storageKey]);

  useEffect(() => {
    if (!hasLoaded) return;
    localStorage.setItem(storageKey, collapsed ? "1" : "0");
  }, [collapsed, hasLoaded, storageKey]);

  return [collapsed, setCollapsed] as const;
}
