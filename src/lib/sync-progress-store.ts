import type { SyncProgress } from "@/lib/sync-progress-types";

/**
 * Priebeh sťahovania držíme mimo Reactu, v malom store.
 *
 * Sťahovanie hlási posun aj niekoľkokrát za sekundu. Keby priebeh žil v state
 * stránky modulu, každé tiknutie by prekreslilo celý dashboard (grafy, zoznamy,
 * doklady) — a kým to trvá, appka nereaguje na klikanie. Takto sa prekreslí len
 * ukazovateľ priebehu, ktorý na store počúva.
 */
type ProgressListener = () => void;

const listeners = new Set<ProgressListener>();
let currentProgress: SyncProgress | null = null;
/** Kto priebeh naposledy nastavil — pri odchode zo stránky ho upratuje len on. */
let currentOwner: object | null = null;

export function subscribeToSyncProgress(listener: ProgressListener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getSyncProgressSnapshot() {
  return currentProgress;
}

/** Na serveri sa priebeh nikdy nevykresľuje — HTML tak sedí s prvým klientskym renderom. */
export function getServerSyncProgressSnapshot(): SyncProgress | null {
  return null;
}

/** Zapíše priebeh a označí jeho vlastníka (stránku, ktorá sťahuje). */
export function writeSyncProgress(owner: object, next: SyncProgress | null) {
  if (currentProgress === next) return;
  currentProgress = next;
  currentOwner = next ? owner : null;
  for (const listener of listeners) listener();
}

/** Prepíše rozrobený priebeh; keď žiadny nebeží, nerobí nič. */
export function updateSyncProgress(
  owner: object,
  mapper: (prev: SyncProgress) => SyncProgress | null
) {
  if (!currentProgress) return;
  writeSyncProgress(owner, mapper(currentProgress));
}

/**
 * Upratanie pri odchode zo stránky. Cudzí priebeh (medzitým ho otvorila nová
 * stránka, na ktorú sa práve prekliklo) necháva bežať — inak by nový modul
 * stratil svoj ukazovateľ ešte skôr, než by ho stihol ukázať.
 */
export function clearSyncProgressForOwner(owner: object) {
  if (currentOwner !== owner) return;
  writeSyncProgress(owner, null);
}

/** Len pre testy — store je modulový, medzi testami ho treba vynulovať. */
export function resetSyncProgressStore() {
  currentProgress = null;
  currentOwner = null;
  listeners.clear();
}
