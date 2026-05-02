"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Granularity, KpiCard, RevenuePoint } from "@/lib/mock-data";
import { formatCurrency, formatCurrencyPrecise, formatDelta } from "@/lib/format";
import { getRevenueBucketInvoices } from "@/lib/dashboard-live";
import type { NormalizedInvoice } from "@/lib/kros-types";
import { GranularityToggle } from "./granularity-toggle";
import { KpiCarousel } from "./kpi-carousel";

type Props = {
  granularity: Granularity;
  onGranularityChange: (value: Granularity) => void;
  kpis: KpiCard[];
  points: RevenuePoint[];
  invoices?: NormalizedInvoice[];
  selectedTags?: string[];
  selectedCompanies?: string[];
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
  invoices = [],
  selectedTags = [],
  selectedCompanies = [],
  activeTagLabel,
  activeCompanyLabel,
  onClearTagFilter,
  onClearCompanyFilter,
  isLoading = false
}: Props) {
  const maxValue = Math.max(...points.map((point) => Math.max(point.current, point.previous)));
  const [activePoint, setActivePoint] = useState<RevenuePoint | null>(null);
  const [invoiceDetailPoint, setInvoiceDetailPoint] = useState<RevenuePoint | null>(null);
  const [invoiceDetailSide, setInvoiceDetailSide] = useState<"current" | "previous">("current");
  const chartRef = useRef<HTMLDivElement | null>(null);
  const tooltipTimeoutRef = useRef<number | null>(null);
  const invoiceDetails = useMemo(() => {
    if (!invoiceDetailPoint) return null;

    return getRevenueBucketInvoices({
      invoices,
      granularity,
      bucketLabel: invoiceDetailPoint.label,
      selectedTags,
      selectedCompanies
    });
  }, [invoiceDetailPoint, invoices, granularity, selectedTags, selectedCompanies]);

  useEffect(() => {
    return () => {
      if (tooltipTimeoutRef.current) {
        window.clearTimeout(tooltipTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (granularity !== "week" || !chartRef.current) return;

    chartRef.current.scrollLeft = chartRef.current.scrollWidth;
  }, [granularity, points.length]);

  const getDeltaPct = (point: RevenuePoint) => {
    if (point.previous === 0) return 100;
    return ((point.current - point.previous) / point.previous) * 100;
  };

  const getYoyBarClass = (point: RevenuePoint) => {
    if (point.current > point.previous) return "bar-yoy-up";
    if (point.current < point.previous) return "bar-yoy-down";
    return "bar-yoy-flat";
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

  const openInvoiceDetails = (point: RevenuePoint, side: "current" | "previous") => {
    if (tooltipTimeoutRef.current) {
      window.clearTimeout(tooltipTimeoutRef.current);
      tooltipTimeoutRef.current = null;
    }
    setInvoiceDetailPoint(point);
    setInvoiceDetailSide(side);
  };

  const detailInvoices = invoiceDetails?.[invoiceDetailSide] ?? [];
  const detailTotal = detailInvoices.reduce((sum, invoice) => sum + invoice.totalPrice, 0);

  return (
    <section className={invoiceDetailPoint ? "dashboard-body dashboard-section overlay-open" : "dashboard-body dashboard-section"}>
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
        <div className="bar-chart" ref={chartRef} onMouseLeave={() => setActivePoint(null)}>
          {points.map((point, index) => {
            const tooltipEdgeClass =
              index === 0 ? "edge-start" : index === points.length - 1 ? "edge-end" : "";

            return (
              <div
                role="button"
                tabIndex={0}
                className={`bar-item ${getYoyBarClass(point)}${activePoint?.label === point.label ? " active" : ""}`}
                key={point.label}
                style={{ "--bar-index": index } as React.CSSProperties}
                onMouseEnter={() => setActivePoint(point)}
                onFocus={() => setActivePoint(point)}
                onTouchStart={() => showTemporaryTooltip(point)}
                onClick={() => showTemporaryTooltip(point)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    showTemporaryTooltip(point);
                  }
                }}
              >
                {activePoint?.label === point.label ? (
                  <div className={`chart-tooltip chart-tooltip-inline ${tooltipEdgeClass}`} aria-live="polite">
                    <p className="tooltip-label">{point.label}</p>
                    <div className="tooltip-values">
                      <span>Tento rok: {formatCurrency(point.current)}</span>
                      <span>Vlani: {formatCurrency(point.previous)}</span>
                      <span className={getDeltaPct(point) >= 0 ? "delta up" : "delta down"}>
                        Rozdiel: {formatDelta(getDeltaPct(point))}
                      </span>
                    </div>
                    {invoices.length > 0 ? (
                      <button
                        type="button"
                        className="tooltip-detail-button"
                        onClick={(event) => {
                          event.stopPropagation();
                          openInvoiceDetails(point, "current");
                        }}
                      >
                        Zobraziť faktúry
                      </button>
                    ) : null}
                  </div>
                ) : null}
                <div className="bar-stack">
                  <div className="bar current" style={{ height: `${(point.current / maxValue) * 100}%` }} />
                  <div className="bar previous" style={{ height: `${(point.previous / maxValue) * 100}%` }} />
                </div>
                <p>{point.label}</p>
              </div>
            );
          })}
        </div>
      </article>

      {invoiceDetailPoint && invoiceDetails ? (
        <div className="tag-filter-overlay" onClick={() => setInvoiceDetailPoint(null)} role="presentation">
          <div
            className="tag-filter-sheet invoice-detail-sheet"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Faktúry v období"
          >
            <header className="tag-filter-head">
              <div>
                <h4>Faktúry - {invoiceDetailPoint.label}</h4>
                <p className="tag-sub">
                  {invoiceDetailSide === "current"
                    ? invoiceDetails.currentPeriodLabel
                    : invoiceDetails.previousPeriodLabel}
                </p>
              </div>
              <button type="button" className="filter-close" onClick={() => setInvoiceDetailPoint(null)}>
                Zavrieť
              </button>
            </header>

            <div className="invoice-detail-tabs">
              <button
                type="button"
                className={invoiceDetailSide === "current" ? "filter-chip active" : "filter-chip"}
                onClick={() => setInvoiceDetailSide("current")}
              >
                Tento rok
              </button>
              <button
                type="button"
                className={invoiceDetailSide === "previous" ? "filter-chip active" : "filter-chip"}
                onClick={() => setInvoiceDetailSide("previous")}
              >
                Vlani
              </button>
            </div>

            <div className="invoice-detail-summary">
              <span>{detailInvoices.length} faktúr</span>
              <strong>{formatCurrencyPrecise(detailTotal)}</strong>
            </div>

            {detailInvoices.length === 0 ? (
              <p className="tag-sub">Pre toto obdobie nie sú v lokálnej cache žiadne faktúry.</p>
            ) : (
              <ul className="invoice-list">
                {detailInvoices.map((invoice) => (
                  <li key={`${invoice.companyId ?? invoice.companyName}-${invoice.id}`}>
                    <div className="invoice-item-head">
                      <div className="invoice-item-text">
                        <p className="tag-name invoice-title-line">{invoice.partnerName ?? "Neznámy odberateľ"}</p>
                        <p className="tag-sub">
                          {new Date(invoice.issueDate).toLocaleDateString("sk-SK")}
                          {invoice.invoiceNumber ? ` • ${invoice.invoiceNumber}` : ""}
                        </p>
                      </div>
                      <strong>{formatCurrencyPrecise(invoice.totalPrice)}</strong>
                    </div>
                    <div
                      className="invoice-tags"
                      aria-label={invoice.tags.length ? "Štítky faktúry" : undefined}
                    >
                      {invoice.tags.map((tag) => (
                        <span key={tag}>{tag}</span>
                      ))}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : null}
    </section>
  );
}
