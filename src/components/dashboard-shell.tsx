"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

type Props = {
  children: React.ReactNode;
  lastSyncedAt?: string | null;
  isSyncing?: boolean;
  onRefresh?: () => void;
};

function formatLastSync(value?: string | null, now = Date.now()) {
  if (!value) return "zatiaľ neprebehla";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "zatiaľ neprebehla";

  const diffSeconds = Math.max(0, Math.floor((now - date.getTime()) / 1000));
  if (diffSeconds < 10) return "práve teraz";
  if (diffSeconds < 60) return `pred ${diffSeconds} s`;

  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) return `pred ${diffMinutes} min`;

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `pred ${diffHours} hod`;

  const diffDays = Math.floor(diffHours / 24);
  if (diffDays === 1) return "pred 1 dňom";
  return `pred ${diffDays} dňami`;
}

export function DashboardShell({ children, lastSyncedAt, isSyncing = false, onRefresh }: Props) {
  const [syncElapsedSeconds, setSyncElapsedSeconds] = useState(0);
  const [relativeNow, setRelativeNow] = useState(Date.now());
  const [pullDistance, setPullDistance] = useState(0);
  const pullStartYRef = useRef<number | null>(null);
  const isPullingRef = useRef(false);
  const pullThreshold = 86;

  useEffect(() => {
    if (!isSyncing) {
      setSyncElapsedSeconds(0);
      return;
    }

    const startedAt = Date.now();
    setSyncElapsedSeconds(0);
    const intervalId = window.setInterval(() => {
      setSyncElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);

    return () => window.clearInterval(intervalId);
  }, [isSyncing]);

  useEffect(() => {
    if (!lastSyncedAt || isSyncing) return;

    setRelativeNow(Date.now());
    const intervalId = window.setInterval(() => {
      setRelativeNow(Date.now());
    }, 30000);

    return () => window.clearInterval(intervalId);
  }, [lastSyncedAt, isSyncing]);

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
          <h1>Biznis dashboard</h1>
        </div>
        <Link href="/settings" className="header-icon-link" aria-label="Nastavenia">
          ⚙
        </Link>
      </header>

      <section className="status-row">
        <p>
          {isSyncing
            ? `Synchronizujem dáta... ${syncElapsedSeconds}s`
            : `Naposledy synchronizované: ${formatLastSync(lastSyncedAt, relativeNow)}`}
        </p>
        <button
          type="button"
          className="status-refresh"
          aria-label="Aktualizovať dáta"
          onClick={onRefresh}
          disabled={isSyncing || !onRefresh}
        >
          ↻
        </button>
      </section>

      {children}
    </main>
  );
}
