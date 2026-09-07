"use client";

import { useRef, useState } from "react";
import { formatSyncEta, getSyncFraction, useSyncProgressValue } from "@/lib/use-sync-progress";
import {
  CategoryVisibilityButton,
  type CategoryVisibilitySettings
} from "@/components/category-visibility-button";
import { SyncOverlay } from "@/components/sync-overlay";

import { signOutAction } from "@/app/actions/sign-out";

type Props = {
  children: React.ReactNode;
  isSyncing?: boolean;
  onRefresh?: () => void;
  /** Vysvetlenie dlhého prvého načítania pre obrazovku sťahovania. */
  syncNote?: string;
  title?: string;
  /** Keď má modul čo skrývať, v hlavičke pribudne prepínač zobrazených sekcií. */
  categoryVisibility?: CategoryVisibilitySettings;
};

export function DashboardShell({
  children,
  isSyncing = false,
  onRefresh,
  syncNote,
  title = "Príjmy",
  categoryVisibility
}: Props) {
  const [pullDistance, setPullDistance] = useState(0);
  const pullStartYRef = useRef<number | null>(null);
  const isPullingRef = useRef(false);
  const pullThreshold = 86;
  const syncProgress = useSyncProgressValue();
  const progress = syncProgress && syncProgress.steps.length > 0 ? syncProgress : null;
  const inlineProgress = progress && !progress.immersive ? progress : null;
  const inlinePct = inlineProgress ? Math.round(getSyncFraction(inlineProgress) * 100) : 0;
  const inlineStep = inlineProgress?.steps[inlineProgress.activeIndex];
  const inlineEta = formatSyncEta(inlineProgress?.etaSeconds);

  const handleTouchStart = (event: React.TouchEvent<HTMLElement>) => {
    if (!onRefresh || isSyncing || window.scrollY > 0) return;

    pullStartYRef.current = event.touches[0]?.clientY ?? null;
    isPullingRef.current = false;
  };

  const handleTouchMove = (event: React.TouchEvent<HTMLElement>) => {
    if (pullStartYRef.current === null || !onRefresh || isSyncing) return;

    const currentY = event.touches[0]?.clientY ?? pullStartYRef.current;
    const distance = currentY - pullStartYRef.current;
    if (distance <= 0 || window.scrollY > 0) return;

    isPullingRef.current = true;
    setPullDistance(Math.min(distance, 120));
  };

  const handleTouchEnd = () => {
    if (pullStartYRef.current === null) return;

    const shouldRefresh = isPullingRef.current && pullDistance >= pullThreshold && onRefresh && !isSyncing;
    pullStartYRef.current = null;
    isPullingRef.current = false;
    setPullDistance(0);

    if (shouldRefresh) {
      onRefresh();
    }
  };

  return (
    <main
      className="app-shell"
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchEnd}
    >
      <div
        className={pullDistance >= pullThreshold ? "pull-refresh-indicator ready" : "pull-refresh-indicator"}
        style={{
          opacity: pullDistance > 12 && !isSyncing ? 1 : 0,
          transform: `translate(-50%, ${Math.min(pullDistance * 0.35, 34)}px)`
        }}
        aria-hidden="true"
      >
        {pullDistance >= pullThreshold ? "Pusti pre obnovenie" : "Potiahni pre obnovenie"}
      </div>
      <header className="app-header">
        <div>
          <h1>{title}</h1>
        </div>
        <div className="header-actions">
          {categoryVisibility &&
          (categoryVisibility.categoryOptions.length + categoryVisibility.sectionOptions.length > 0 ||
            categoryVisibility.granularity) ? (
            <CategoryVisibilityButton {...categoryVisibility} moduleTitle={title} />
          ) : null}
          {onRefresh ? (
            <button
              type="button"
              className="header-icon-btn"
              onClick={() => onRefresh()}
              disabled={isSyncing}
              data-syncing={isSyncing}
              aria-label="Obnoviť dáta"
              title="Obnoviť dáta"
            >
              <svg className="header-refresh-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M20 11a8 8 0 1 0-.9 4.5" />
                <path d="M20 4v6h-6" />
              </svg>
            </button>
          ) : null}
          <form action={signOutAction}>
            <button type="submit" className="header-icon-btn" aria-label="Odhlásiť sa" title="Odhlásiť sa">
              <svg className="header-action-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M15 17v2a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v2" />
                <path d="M10 12h10" />
                <path d="M17 9l3 3-3 3" />
              </svg>
            </button>
          </form>
        </div>
      </header>

      {inlineProgress ? (
        <div className="sync-progress">
          <div className="sync-progress-meta">
            <span className="sync-progress-step">
              {[inlineStep?.group, inlineStep?.label, inlineProgress.detail]
                .filter(Boolean)
                .join(" · ") || "Načítavam dáta..."}
            </span>
            <span className="sync-progress-count">
              {inlinePct} %{inlineEta ? ` · ${inlineEta}` : ""}
            </span>
          </div>
          <div
            className="sync-progress-track"
            role="progressbar"
            aria-label="Priebeh načítania dát"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={inlinePct}
            aria-valuetext={`${inlinePct} %`}
          >
            <div className="sync-progress-fill" style={{ width: `${inlinePct}%` }} />
          </div>
        </div>
      ) : null}

      {children}

      {progress?.immersive ? (
        <SyncOverlay progress={progress} title={title} note={syncNote} />
      ) : null}
    </main>
  );
}
