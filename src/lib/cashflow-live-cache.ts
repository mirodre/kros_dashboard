/** Session + in-memory snapshot for live Peniaze (cashflow) data — see `src/app/cashflow/page.tsx`. */
export const CASHFLOW_LIVE_CACHE_KEY = "kros_dashboard_cashflow_live_cache_v1";

export function clearCashflowLiveCache(): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.removeItem(CASHFLOW_LIVE_CACHE_KEY);
  } catch {
    // Ignore storage access errors (private mode, quota).
  }
  try {
    delete (globalThis as { __krosCashflowLiveCache?: unknown }).__krosCashflowLiveCache;
  } catch {
    // Ignore if global is sealed in an unusual environment.
  }
}
