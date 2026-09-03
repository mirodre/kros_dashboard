import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearSyncProgressForOwner,
  getSyncProgressSnapshot,
  resetSyncProgressStore,
  subscribeToSyncProgress,
  updateSyncProgress,
  writeSyncProgress
} from "@/lib/sync-progress-store";
import type { SyncProgress } from "@/lib/sync-progress-types";

function progress(overrides: Partial<SyncProgress> = {}): SyncProgress {
  return {
    steps: [{ key: "a", group: "Firma", label: "január 2026" }],
    activeIndex: 0,
    doneCount: 0,
    stepFraction: 0,
    immersive: true,
    ...overrides
  };
}

describe("sync progress store", () => {
  beforeEach(() => {
    resetSyncProgressStore();
  });

  it("upovedomí odberateľov o zápise", () => {
    const owner = {};
    const listener = vi.fn();
    subscribeToSyncProgress(listener);

    writeSyncProgress(owner, progress());

    expect(listener).toHaveBeenCalledTimes(1);
    expect(getSyncProgressSnapshot()).not.toBeNull();
  });

  it("nezavolá odberateľov, keď sa hodnota nemení", () => {
    const owner = {};
    const listener = vi.fn();
    subscribeToSyncProgress(listener);

    writeSyncProgress(owner, null);

    expect(listener).not.toHaveBeenCalled();
  });

  it("prepíše len rozrobený priebeh", () => {
    const owner = {};

    updateSyncProgress(owner, (prev) => ({ ...prev, doneCount: 5 }));
    expect(getSyncProgressSnapshot()).toBeNull();

    writeSyncProgress(owner, progress());
    updateSyncProgress(owner, (prev) => ({ ...prev, doneCount: 1 }));

    expect(getSyncProgressSnapshot()?.doneCount).toBe(1);
  });

  it("odchod zo stránky zavrie jej vlastný priebeh", () => {
    const owner = {};
    writeSyncProgress(owner, progress());

    clearSyncProgressForOwner(owner);

    expect(getSyncProgressSnapshot()).toBeNull();
  });

  it("odchod zo stránky nechá bežať priebeh nového modulu", () => {
    // Pri prekliku sa nová stránka stihne namontovať skôr, než sa odmontuje
    // stará — jej upratovanie nesmie zhasnúť sťahovanie, ktoré už beží.
    const leavingPage = {};
    const arrivingPage = {};
    writeSyncProgress(leavingPage, progress());
    writeSyncProgress(arrivingPage, progress({ immersive: false }));

    clearSyncProgressForOwner(leavingPage);

    expect(getSyncProgressSnapshot()?.immersive).toBe(false);
  });
});
