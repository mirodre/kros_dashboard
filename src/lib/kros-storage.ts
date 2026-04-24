import type { KrosConnection } from "./kros-types";

const CONNECTIONS_KEY = "kros_dashboard_connections";
const PENDING_STATE_KEY = "kros_dashboard_pending_state";

export function readConnections(): KrosConnection[] {
  if (typeof window === "undefined") return [];

  try {
    const raw = localStorage.getItem(CONNECTIONS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as KrosConnection[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function writeConnections(connections: KrosConnection[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(CONNECTIONS_KEY, JSON.stringify(connections));
}

export function savePendingState(state: string) {
  if (typeof window === "undefined") return;
  localStorage.setItem(PENDING_STATE_KEY, state);
}

export function readPendingState() {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(PENDING_STATE_KEY);
}

export function clearPendingState() {
  if (typeof window === "undefined") return;
  localStorage.removeItem(PENDING_STATE_KEY);
}
