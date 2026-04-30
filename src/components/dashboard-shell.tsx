"use client";

import Link from "next/link";
import { useRef, useState } from "react";

type Props = {
  children: React.ReactNode;
  isSyncing?: boolean;
  onRefresh?: () => void;
};

export function DashboardShell({ children, isSyncing = false, onRefresh }: Props) {
  const [pullDistance, setPullDistance] = useState(0);
  const pullStartYRef = useRef<number | null>(null);
  const isPullingRef = useRef(false);
  const pullThreshold = 86;

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

      {children}
    </main>
  );
}
