"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRef, useState } from "react";
import { formatSyncEta, type SyncProgress } from "@/lib/use-sync-progress";

import { signOutAction } from "@/app/actions/sign-out";
import { useTenantName } from "./preferences-boot";

type Props = {
  children: React.ReactNode;
  isSyncing?: boolean;
  onRefresh?: () => void;
  syncProgress?: SyncProgress | null;
  title?: string;
};

export function DashboardShell({
  children,
  isSyncing = false,
  onRefresh,
  syncProgress = null,
  title = "Príjmy"
}: Props) {
  const [pullDistance, setPullDistance] = useState(0);
  const pullStartYRef = useRef<number | null>(null);
  const isPullingRef = useRef(false);
  const pullThreshold = 86;
  const pathname = usePathname();
  // Filtre sú firemné, takže človek musí vidieť, ktorej firmy ich práve mení.
  const tenantName = useTenantName();
  const progress = syncProgress && syncProgress.total > 0 ? syncProgress : null;
  const progressPct = progress
    ? Math.min(100, Math.round(((progress.done + (progress.stepFraction ?? 0)) / progress.total) * 100))
    : 0;
  const progressEta = formatSyncEta(progress?.etaSeconds);

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
          {tenantName ? <p className="header-tenant">{tenantName}</p> : null}
          <nav className="header-nav desktop-only-nav" aria-label="Navigácia prehľadov">
            <Link href="/" className={pathname === "/" ? "header-nav-link active" : "header-nav-link"}>
              Príjmy
            </Link>
            <Link
              href="/expenses"
              className={pathname === "/expenses" ? "header-nav-link active" : "header-nav-link"}
            >
              Výdavky
            </Link>
            <Link
              href="/cashflow"
              className={pathname === "/cashflow" ? "header-nav-link active" : "header-nav-link"}
            >
              Financie
            </Link>
          </nav>
        </div>
        {onRefresh ? (
          <button
            type="button"
            className="header-refresh-btn"
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
          <button type="submit" className="header-refresh-btn" aria-label="Odhlásiť sa">
            Odhlásiť sa
          </button>
        </form>
      </header>

      {progress ? (
        <div className="sync-progress">
          <div className="sync-progress-meta">
            <span className="sync-progress-step">{progress.label ?? "Načítavam dáta..."}</span>
            <span className="sync-progress-count">
              {progressPct} %{progressEta ? ` · ${progressEta}` : ""}
            </span>
          </div>
          <div
            className="sync-progress-track"
            role="progressbar"
            aria-label="Priebeh načítania dát"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progressPct}
            aria-valuetext={`${progressPct} %`}
          >
            <div className="sync-progress-fill" style={{ width: `${progressPct}%` }} />
          </div>
          <div className="sync-progress-detail">
            {[`Krok ${Math.min(progress.done + 1, progress.total)}/${progress.total}`, progress.detail]
              .filter(Boolean)
              .join(" · ")}
          </div>
        </div>
      ) : null}

      {children}

      <nav className="mobile-liquid-nav" aria-label="Hlavná navigácia">
        <Link href="/" className={pathname === "/" ? "mobile-liquid-link active" : "mobile-liquid-link"}>
          <span className="mobile-liquid-orb" aria-hidden="true">
            <span className="mobile-liquid-icon">
            <svg viewBox="0 0 24 24" fill="none">
              <path d="M4.5 10.4 12 4l7.5 6.4V20a1 1 0 0 1-1 1H5.5a1 1 0 0 1-1-1v-9.6Z" />
              <path d="M9.5 21v-5.2a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1V21" />
            </svg>
            </span>
          </span>
          <span className="mobile-liquid-label">Príjmy</span>
        </Link>
        <Link
          href="/expenses"
          className={pathname === "/expenses" ? "mobile-liquid-link active" : "mobile-liquid-link"}
        >
          <span className="mobile-liquid-orb" aria-hidden="true">
            <span className="mobile-liquid-icon">
            <svg viewBox="0 0 24 24" fill="none">
              <path d="M6 3.5h12v17l-2.4-1.6-2.4 1.6-1.2-.8-1.2.8-2.4-1.6L6 20.5v-17Z" />
              <path d="M9 8h6" />
              <path d="M9 11.5h6" />
              <path d="M9 15h3.6" />
            </svg>
            </span>
          </span>
          <span className="mobile-liquid-label">Výdavky</span>
        </Link>
        <Link
          href="/cashflow"
          className={pathname === "/cashflow" ? "mobile-liquid-link active" : "mobile-liquid-link"}
        >
          <span className="mobile-liquid-orb" aria-hidden="true">
            <span className="mobile-liquid-icon">
            <svg viewBox="0 0 24 24" fill="none">
              <path d="M4 19.5h16" />
              <rect x="5.2" y="12.2" width="3.2" height="5.6" rx="1.1" />
              <rect x="10.4" y="8.6" width="3.2" height="9.2" rx="1.1" />
              <rect x="15.6" y="5.6" width="3.2" height="12.2" rx="1.1" />
            </svg>
            </span>
          </span>
          <span className="mobile-liquid-label">Financie</span>
        </Link>
        <Link
          href="/settings"
          className={pathname === "/settings" ? "mobile-liquid-link active" : "mobile-liquid-link"}
        >
          <span className="mobile-liquid-orb" aria-hidden="true">
            <span className="mobile-liquid-icon">
            <svg viewBox="0 0 24 24" fill="none">
              <path d="m19.2 12.9.1-.9-.1-.9 2-1.5-1.9-3.3-2.4 1a7.8 7.8 0 0 0-1.6-.9L15 3.7h-6l-.3 2.7a7.8 7.8 0 0 0-1.6.9l-2.4-1L2.8 9.6l2 1.5-.1.9.1.9-2 1.5 1.9 3.3 2.4-1a7.8 7.8 0 0 0 1.6.9l.3 2.7h6l.3-2.7a7.8 7.8 0 0 0 1.6-.9l2.4 1 1.9-3.3-2-1.5Z" />
              <circle cx="12" cy="12" r="2.8" />
            </svg>
            </span>
          </span>
          <span className="mobile-liquid-label">Nastavenia</span>
        </Link>
      </nav>
    </main>
  );
}
