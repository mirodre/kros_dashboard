"use client";

import { useEffect, useRef, useState } from "react";
import type { Granularity, KpiCard, RevenuePoint } from "@/lib/mock-data";
import { formatCurrency, formatDelta } from "@/lib/format";
import { GranularityToggle } from "./granularity-toggle";
import { KpiCarousel } from "./kpi-carousel";

type Props = {
  granularity: Granularity;
  onGranularityChange: (value: Granularity) => void;
  kpis: KpiCard[];
  points: RevenuePoint[];
  activeTagLabel?: string;
  activeCompanyLabel?: string;
  onClearTagFilter?: () => void;
  onClearCompanyFilter?: () => void;
  isLoading?: boolean;
};

export function RevenueDashboard({
  granularity,
  onGranularityChange,
  kpis,
  points,
  activeTagLabel,
  activeCompanyLabel,
  onClearTagFilter,
  onClearCompanyFilter,
  isLoading = false
}: Props) {
  const maxValue = Math.max(...points.map((point) => Math.max(point.current, point.previous)));
  const [activePoint, setActivePoint] = useState<RevenuePoint | null>(null);
  const tooltipTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (tooltipTimeoutRef.current) {
        window.clearTimeout(tooltipTimeoutRef.current);
      }
    };
  }, []);

  const getDeltaPct = (point: RevenuePoint) => {
    if (point.previous === 0) return 100;
    return ((point.current - point.previous) / point.previous) * 100;
  };

  const showTemporaryTooltip = (point: RevenuePoint) => {
    setActivePoint(point);
    if (tooltipTimeoutRef.current) {
      window.clearTimeout(tooltipTimeoutRef.current);
    }

    tooltipTimeoutRef.current = window.setTimeout(() => {
      setActivePoint(null);
      tooltipTimeoutRef.current = null;
    }, 3000);
  };

  return (
    <section className="dashboard-body dashboard-section">
      <div className="row-head">
        <div className="filters-inline">
          <GranularityToggle value={granularity} onChange={onGranularityChange} />
          {activeTagLabel ? (
            <button type="button" className="active-tag-badge" onClick={onClearTagFilter}>
              <span>{activeTagLabel}</span>
              <span className="badge-close">×</span>
            </button>
          ) : null}
          {activeCompanyLabel ? (
            <button type="button" className="active-tag-badge" onClick={onClearCompanyFilter}>
              <span>{activeCompanyLabel}</span>
              <span className="badge-close">×</span>
            </button>
          ) : null}
        </div>
      </div>

      {isLoading ? (
        <div className="dashboard-skeleton-overlay revenue-skeleton" aria-live="polite">
          <div className="skeleton-pill" />
          <div className="skeleton-number" />
          <div className="skeleton-row">
            <span />
            <span />
          </div>
          <div className="skeleton-chart">
            {Array.from({ length: 8 }).map((_, index) => (
              <span key={index} style={{ height: `${34 + ((index * 13) % 52)}%` }} />
            ))}
          </div>
        </div>
      ) : null}

      <KpiCarousel items={kpis} />

      <article className="panel">
        <div className="bar-chart" onMouseLeave={() => setActivePoint(null)}>
          {points.map((point) => (
            <button
              type="button"
              className={activePoint?.label === point.label ? "bar-item active" : "bar-item"}
              key={point.label}
              onMouseEnter={() => setActivePoint(point)}
              onFocus={() => setActivePoint(point)}
              onTouchStart={() => showTemporaryTooltip(point)}
              onClick={() => showTemporaryTooltip(point)}
            >
              {activePoint?.label === point.label ? (
                <div className="chart-tooltip chart-tooltip-inline" aria-live="polite">
                  <p className="tooltip-label">{point.label}</p>
                  <div className="tooltip-values">
                    <span>Tento rok: {formatCurrency(point.current)}</span>
                    <span>Vlani: {formatCurrency(point.previous)}</span>
                    <span className={getDeltaPct(point) >= 0 ? "delta up" : "delta down"}>
                      Rozdiel: {formatDelta(getDeltaPct(point))}
                    </span>
                  </div>
                </div>
              ) : null}
              <div className="bar-stack">
                <div className="bar current" style={{ height: `${(point.current / maxValue) * 100}%` }} />
                <div className="bar previous" style={{ height: `${(point.previous / maxValue) * 100}%` }} />
              </div>
              <p>{point.label}</p>
            </button>
          ))}
        </div>
      </article>

    </section>
  );
}
