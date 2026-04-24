"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

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

  return (
    <main className="app-shell">
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
