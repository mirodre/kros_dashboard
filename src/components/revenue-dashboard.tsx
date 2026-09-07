"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Granularity, KpiCard, RevenuePoint } from "@/lib/mock-data";
import { formatCurrency, formatCurrencyPrecise, formatDelta, getDeltaPct } from "@/lib/format";
import { parseDocumentDate } from "@/lib/document-date";
import { getInvoiceAnalyticsDate, getRevenueBucketInvoices } from "@/lib/dashboard-live";
import { formatPeriodFocusLabel } from "@/lib/period-buckets";
import type { NormalizedInvoice } from "@/lib/kros-types";
import { useScrollToEnd } from "@/lib/use-scroll-to-end";
import { chartTooltipStyle, useChartTooltipLeft } from "@/lib/use-chart-tooltip-left";
import { KpiCarousel } from "./kpi-carousel";
import { SheetOverlay } from "./sheet-overlay";

type Props = {
  granularity: Granularity;
  kpis: KpiCard[];
  points: RevenuePoint[];
  invoices?: NormalizedInvoice[];
  selectedTags?: string[];
  selectedCompanies?: string[];
  activeTagLabel?: string;
  activeCompanyLabel?: string;
  onClearTagFilter?: () => void;
  onClearCompanyFilter?: () => void;
  /**
   * Štítok stĺpca, na ktorý sa kliklo. Sekcie pod grafom sú podľa neho odfiltrované,
   * graf sám nie — inak by po kliknutí ostal jediný stĺpec a nedalo by sa preklikať inam.
   */
  focusedPeriod?: string | null;
  onFocusedPeriodChange?: (label: string | null) => void;
};

export function RevenueDashboard({
  granularity,
  kpis,
  points,
  invoices = [],
  selectedTags = [],
  selectedCompanies = [],
  activeTagLabel,
  activeCompanyLabel,
  onClearTagFilter,
  onClearCompanyFilter,
  focusedPeriod = null,
  onFocusedPeriodChange
}: Props) {
  const maxValue = Math.max(...points.map((point) => Math.max(point.current, point.previous)));
  const [activePoint, setActivePoint] = useState<RevenuePoint | null>(null);
  const [invoiceDetailPoint, setInvoiceDetailPoint] = useState<RevenuePoint | null>(null);
  const [invoiceDetailSide, setInvoiceDetailSide] = useState<"current" | "previous">("current");
  const chartRef = useRef<HTMLDivElement | null>(null);
  const chartWrapRef = useRef<HTMLDivElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
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

  useScrollToEnd(chartRef, `${granularity}:${points.length}`);

  /**
   * Bublina s číslami stojí MIMO `.bar-chart` — ten sa posúva, takže by ju orezal
   * (podrobnosti v `use-chart-tooltip-left.ts`). Bod berieme z aktuálneho `points`,
   * nie zo stavu: po zmene dát by inak bublina ukazovala staré čísla.
   */
  const activeIndex = activePoint ? points.findIndex((point) => point.label === activePoint.label) : -1;
  const tooltipPoint = activeIndex >= 0 ? points[activeIndex] : null;
  const tooltipDelta = tooltipPoint ? getDeltaPct(tooltipPoint.current, tooltipPoint.previous) : null;
  const tooltipLeft = useChartTooltipLeft({
    wrapRef: chartWrapRef,
    scrollRef: chartRef,
    tooltipRef,
    columnSelector: ".bar-item",
    activeIndex,
    resetKey: `${granularity}:${points.length}`
  });

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

  // Klik na stĺpec zúži sekcie pod grafom; opätovný klik na ten istý stĺpec filter zruší.
  const togglePeriodFocus = (point: RevenuePoint) => {
    if (!onFocusedPeriodChange) return;
    onFocusedPeriodChange(focusedPeriod === point.label ? null : point.label);
  };

  const activatePoint = (point: RevenuePoint) => {
    showTemporaryTooltip(point);
    togglePeriodFocus(point);
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
    <section className="dashboard-body dashboard-section">
      <div className="row-head">
        <div className="filters-inline">
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
          {focusedPeriod ? (
            <button
              type="button"
              className="active-tag-badge"
              onClick={() => onFocusedPeriodChange?.(null)}
            >
              <span>{formatPeriodFocusLabel(granularity, focusedPeriod)}</span>
              <span className="badge-close">×</span>
            </button>
          ) : null}
        </div>
      </div>

      <KpiCarousel items={kpis} />

      <article className="panel">
        {/* Obal je neposúvateľný, aby mal kam sadnúť tooltip; `onMouseLeave` je na ňom,
            a nie na grafe, nech bublina prežije prejdenie myšou z stĺpca na jej tlačidlo. */}
        <div className="bar-chart-wrap" ref={chartWrapRef} onMouseLeave={() => setActivePoint(null)}>
          <div
            className={focusedPeriod ? "bar-chart has-period-focus" : "bar-chart"}
            ref={chartRef}
          >
            {points.map((point, index) => (
              <div
                role="button"
                tabIndex={0}
                className={`bar-item ${getYoyBarClass(point)}${activePoint?.label === point.label ? " active" : ""}${focusedPeriod === point.label ? " is-period-focused" : ""}`}
                key={point.label}
                style={{ "--bar-index": index } as React.CSSProperties}
                aria-pressed={onFocusedPeriodChange ? focusedPeriod === point.label : undefined}
                onMouseEnter={() => setActivePoint(point)}
                onFocus={() => setActivePoint(point)}
                onTouchStart={() => showTemporaryTooltip(point)}
                onClick={() => activatePoint(point)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    activatePoint(point);
                  }
                }}
              >
                <div className="bar-stack">
                  <div className="bar current" style={{ height: `${(point.current / maxValue) * 100}%` }} />
                  <div className="bar previous" style={{ height: `${(point.previous / maxValue) * 100}%` }} />
                </div>
                <p>{point.label}</p>
              </div>
            ))}
          </div>

          {tooltipPoint ? (
            <div
              ref={tooltipRef}
              className="chart-tooltip bar-chart-tooltip"
              aria-live="polite"
              style={chartTooltipStyle(tooltipLeft)}
            >
              <p className="tooltip-label">{tooltipPoint.label}</p>
              <div className="tooltip-values">
                <span>Tento rok: {formatCurrency(tooltipPoint.current)}</span>
                <span>Vlani: {formatCurrency(tooltipPoint.previous)}</span>
                {tooltipDelta !== null ? (
                  <span className={tooltipDelta >= 0 ? "delta up" : "delta down"}>
                    Rozdiel: {formatDelta(tooltipDelta)}
                  </span>
                ) : null}
              </div>
              {invoices.length > 0 ? (
                <button
                  type="button"
                  className="tooltip-detail-button"
                  onClick={() => openInvoiceDetails(tooltipPoint, "current")}
                >
                  Zobraziť faktúry
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      </article>

      {invoiceDetailPoint && invoiceDetails ? (
        <SheetOverlay onClose={() => setInvoiceDetailPoint(null)}>
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
                          {parseDocumentDate(getInvoiceAnalyticsDate(invoice))?.toLocaleDateString("sk-SK") ?? "—"}
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
        </SheetOverlay>
      ) : null}
    </section>
  );
}
