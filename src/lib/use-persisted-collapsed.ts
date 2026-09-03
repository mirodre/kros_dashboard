"use client";

import { usePreference } from "./use-preference";

/** Kľúče registra, ktorých hodnota je „panel je zbalený". */
export type CollapsedPreferenceKey =
  | "ui.collapsed.companies"
  | "ui.collapsed.expensesCompanies"
  | "ui.collapsed.recentInvoices"
  | "ui.collapsed.recentExpenses"
  | "ui.collapsed.expenseVendors";

/**
 * Zapamätá zbalenie panela. Zbalenie je OSOBNÉ nastavenie (register v
 * `src/lib/preferences/registry.ts`): zdieľať ho firme by znamenalo, že jedno kliknutie
 * prestaví obrazovku všetkým kolegom.
 */
export function usePersistedCollapsed(key: CollapsedPreferenceKey) {
  return usePreference(key);
}
