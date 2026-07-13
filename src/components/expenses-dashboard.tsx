"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Granularity, KpiCard, RevenuePoint } from "@/lib/mock-data";
import type { NormalizedExpense } from "@/lib/kros-types";
import type { ExpenseDueWatchlist, ExpenseTagSlice } from "@/lib/expenses-live";
import { getExpenseBucketDocs, getExpenseDocumentTypeLabel } from "@/lib/expenses-live";
import { formatCurrency, formatCurrencyPrecise, formatDelta } from "@/lib/format";
import { GranularityToggle } from "./granularity-toggle";
import { KpiCarousel } from "./kpi-carousel";
import { ExpenseRow } from "./recent-expenses-section";

type Props = {
  granularity: Granularity;
  onGranularityChange: (value: Granularity) => void;
  kpis: KpiCard[];
  points: RevenuePoint[];
  expenses: NormalizedExpense[];
  tagStructure: ExpenseTagSlice[];
  dueWatchlist: ExpenseDueWatchlist;
  selectedTags?: string[];
  selectedCompanies?: string[];
  activeTagLabel?: string;
  activeCompanyLabel?: string;
  onClearTagFilter?: () => void;
  onClearCompanyFilter?: () => void;
  onFocusTag?: (tag: string | null) => void;
  isMockData?: boolean;
  isLoading?: boolean;
};

export function ExpensesDashboard({
  granularity,
  onGranularityChange,
  kpis,
  points,
  expenses,
  tagStructure,
  dueWatchlist,
  selectedTags = [],
  selectedCompanies = [],
  activeTagLabel,
  activeCompanyLabel,
  onClearTagFilter,
  onClearCompanyFilter,
  onFocusTag,
  isMockData = false,
  isLoading = false
}: Props) {
  const [activePoint, setActivePoint] = useState<RevenuePoint | null>(null);
  const [detailPoint, setDetailPoint] = useState<RevenuePoint | null>(null);
  const [detailSide, setDetailSide] = useState<"current" | "previous">("current");
  const [isDueSheetOpen, setIsDueSheetOpen] = useState(false);
  const [dueSheetTab, setDueSheetTab] = useState<"overdue" | "upcoming">("overdue");
  const [isPieAnimated, setIsPieAnimated] = useState(false);
  const chartRef = useRef<HTMLDivElement | null>(null);
  const tooltipTimeoutRef = useRef<number | null>(null);

  const maxValue = Math.max(1, ...points.map((point) => Math.max(point.current, point.previous)));

  const bucketDocs = useMemo(() => {
    if (!detailPoint) return null;
    return getExpenseBucketDocs({
      expenses,
      granularity,
      bucketLabel: detailPoint.label,
      selectedTags,
      selectedCompanies
    });
  }, [detailPoint, expenses, granularity, selectedTags, selectedCompanies]);

  const donutData = useMemo(() => {
    // Largest slices get rank 0,1,… — rovnaká paleta a rozostup ako donut v module Peniaze.
    const palette = [
      "#ff9f6e",
      "#9f8bff",
      "#67c9ff",
      "#86f0be",
      "#f68fc9",
      "#6de0d8",
      "#ffc46b",
      "#9edc7a"
    ];
    const positive = tagStructure.filter((slice) => slice.amount > 0);
    const total = positive.reduce((sum, slice) => sum + slice.amount, 0);

    let cumulative = -Math.PI / 2;
    return positive.map((slice, index) => {
      const share = total === 0 ? 0 : slice.amount / total;
      const startAngle = cumulative;
      const endAngle = cumulative + share * Math.PI * 2;
      cumulative = endAngle;
      return {
        ...slice,
        share,
        color: palette[index % palette.length],
        startAngle,
        endAngle
      };
    });
  }, [tagStructure]);

  const donutTotal = useMemo(
    () => donutData.reduce((sum, slice) => sum + slice.amount, 0),
    [donutData]
  );
  const donutDocumentCount = useMemo(
    () => donutData.reduce((sum, slice) => sum + slice.documentCount, 0),
    [donutData]
  );
  const activeSlice = useMemo(
    () => (activeTagLabel ? donutData.find((slice) => slice.name === activeTagLabel) ?? null : null),
    [donutData, activeTagLabel]
  );

  useEffect(() => {
    setIsPieAnimated(false);
    const timeout = window.setTimeout(() => setIsPieAnimated(true), 70);
    return () => window.clearTimeout(timeout);
  }, [donutData]);

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
    if (point.previous === 0) return point.current === 0 ? 0 : 100;
    return ((point.current - point.previous) / point.previous) * 100;
  };

  // Pri výdavkoch je pokles dobrá správa — zelenú dostane nižší stĺpec ako vlani.
  const getYoyBarClass = (point: RevenuePoint) => {
    if (point.current < point.previous) return "bar-yoy-up";
    if (point.current > point.previous) return "bar-yoy-down";
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

  const openDocDetails = (point: RevenuePoint, side: "current" | "previous") => {
    if (tooltipTimeoutRef.current) {
      window.clearTimeout(tooltipTimeoutRef.current);
      tooltipTimeoutRef.current = null;
    }
    setDetailPoint(point);
    setDetailSide(side);
  };

  const handleSliceClick = (tagName: string) => {
    if (!onFocusTag) return;
    onFocusTag(activeTagLabel === tagName ? null : tagName);
  };

  const detailDocs = bucketDocs?.[detailSide] ?? [];
  const detailTotal = detailDocs.reduce((sum, expense) => sum + expense.totalPriceInclVat, 0);

  const overdueCount = dueWatchlist.overdue.length;
  const dueSheetDocs = dueSheetTab === "overdue" ? dueWatchlist.overdue : dueWatchlist.upcoming;
  const dueSheetTotal = dueSheetTab === "overdue" ? dueWatchlist.overdueTotal : dueWatchlist.upcomingTotal;
  const isOverlayOpen = detailPoint !== null || isDueSheetOpen;

  return (
    <section className={isOverlayOpen ? "dashboard-body dashboard-section overlay-open" : "dashboard-body dashboard-section"}>
      <div className="row-head">
        <div className="filters-inline">
          <GranularityToggle value={granularity} onChange={onGranularityChange} />
          {isMockData ? <span className="active-tag-badge">Demo dáta</span> : null}
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

      {overdueCount > 0 ? (
        <button
          type="button"
          className="cashflow-alert-banner"
          onClick={() => {
            setDueSheetTab("overdue");
            setIsDueSheetOpen(true);
          }}
          aria-label={`Máte ${overdueCount} dokladov po splatnosti`}
        >
          <span className="cashflow-alert-icon">!</span>
          <span>
            Po splatnosti {overdueCount === 1 ? "je 1 doklad" : overdueCount < 5 ? `sú ${overdueCount} doklady` : `je ${overdueCount} dokladov`}{" "}
            za {formatCurrency(dueWatchlist.overdueTotal)}. Zobraziť zoznam
          </span>
        </button>
      ) : null}

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

      <KpiCarousel items={kpis} invertDeltaColor />

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
                      <span className={getDeltaPct(point) <= 0 ? "delta up" : "delta down"}>
                        Rozdiel: {formatDelta(getDeltaPct(point))}
                      </span>
                    </div>
                    {expenses.length > 0 ? (
                      <button
                        type="button"
                        className="tooltip-detail-button"
                        onClick={(event) => {
                          event.stopPropagation();
                          openDocDetails(point, "current");
                        }}
                      >
                        Zobraziť doklady
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

      <article className="panel">
        <header className="panel-head">
          <h3>Štruktúra výdavkov podľa štítkov</h3>
        </header>
        <div className={isLoading ? "cashflow-donut-wrap loading" : "cashflow-donut-wrap"}>
          <div className="cashflow-donut-card">
            {isLoading ? (
              <div className="cashflow-donut-skeleton" aria-hidden="true">
                <div className="cashflow-donut-skeleton-ring" />
                <div className="cashflow-donut-skeleton-center">
                  <span />
                  <span />
                </div>
              </div>
            ) : (
              <svg className="cashflow-donut-svg" viewBox="0 0 320 320" role="img" aria-label="Výdavky podľa štítkov">
                {donutData.map((slice, sliceIndex) => {
                  const isActive = activeTagLabel === slice.name;
                  const outerRadius = isActive ? 136 : 126;
                  const innerRadius = 90;
                  const center = 160;
                  // Math.sin/cos sa líšia v poslednom bite medzi Node a prehliadačom —
                  // bez zaokrúhlenia by sa atribút `d` nezhodoval pri SSR hydratácii.
                  const coord = (value: number) => value.toFixed(2);
                  const startOuterX = coord(center + outerRadius * Math.cos(slice.startAngle));
                  const startOuterY = coord(center + outerRadius * Math.sin(slice.startAngle));
                  const endOuterX = coord(center + outerRadius * Math.cos(slice.endAngle));
                  const endOuterY = coord(center + outerRadius * Math.sin(slice.endAngle));
                  const startInnerX = coord(center + innerRadius * Math.cos(slice.startAngle));
                  const startInnerY = coord(center + innerRadius * Math.sin(slice.startAngle));
                  const endInnerX = coord(center + innerRadius * Math.cos(slice.endAngle));
                  const endInnerY = coord(center + innerRadius * Math.sin(slice.endAngle));
                  const isLargeArc = slice.endAngle - slice.startAngle > Math.PI ? 1 : 0;
                  const path = [
                    `M ${startOuterX} ${startOuterY}`,
                    `A ${outerRadius} ${outerRadius} 0 ${isLargeArc} 1 ${endOuterX} ${endOuterY}`,
                    `L ${endInnerX} ${endInnerY}`,
                    `A ${innerRadius} ${innerRadius} 0 ${isLargeArc} 0 ${startInnerX} ${startInnerY}`,
                    "Z"
                  ].join(" ");
                  const isDimmed = Boolean(activeTagLabel) && !isActive;
                  return (
                    <path
                      key={slice.name}
                      d={path}
                      className={`cashflow-donut-slice ${isPieAnimated ? "is-animated" : ""} ${isActive ? "is-active" : ""} ${isDimmed ? "is-dimmed" : ""}`}
                      style={
                        {
                          fill: slice.color,
                          "--slice-index": sliceIndex
                        } as React.CSSProperties
                      }
                      onClick={() => handleSliceClick(slice.name)}
                    />
                  );
                })}
                <circle
                  cx="160"
                  cy="160"
                  r="84"
                  className={isPieAnimated ? "cashflow-donut-hole is-animated" : "cashflow-donut-hole"}
                />
              </svg>
            )}
            <div className="cashflow-donut-center">
              <p className="cashflow-donut-title">{activeSlice ? activeSlice.name : "Výdavky tento rok"}</p>
              <strong>{formatCurrency(activeSlice ? activeSlice.amount : donutTotal)}</strong>
              <span>
                {activeSlice
                  ? `${(activeSlice.share * 100).toFixed(1)} % • ${activeSlice.documentCount} dokladov`
                  : `${donutDocumentCount} dokladov`}
              </span>
            </div>
          </div>

          {isLoading ? (
            <ul className="cashflow-donut-legend skeleton" aria-hidden="true">
              {Array.from({ length: 5 }).map((_, index) => (
                <li key={`legend-skeleton-${index}`}>
                  <div className="cashflow-legend-item skeleton" />
                </li>
              ))}
            </ul>
          ) : (
            <ul className="cashflow-donut-legend">
              {donutData.map((slice) => {
                const deltaValue = slice.amount - slice.previousAmount;
                return (
                  <li key={slice.name}>
                    <button
                      type="button"
                      className={activeTagLabel === slice.name ? "cashflow-legend-item active" : "cashflow-legend-item"}
                      style={{ "--legend-accent": slice.color } as React.CSSProperties}
                      onClick={() => handleSliceClick(slice.name)}
                    >
                      <span className="cashflow-legend-label">{slice.name}</span>
                      <span className="cashflow-legend-value">{formatCurrency(slice.amount)}</span>
                      <span className={deltaValue <= 0 ? "cashflow-legend-trend up" : "cashflow-legend-trend down"}>
                        {deltaValue >= 0 ? "+" : "-"}
                        {formatCurrency(Math.abs(deltaValue))}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </article>

      {detailPoint && bucketDocs ? (
        <div className="tag-filter-overlay" onClick={() => setDetailPoint(null)} role="presentation">
          <div
            className="tag-filter-sheet invoice-detail-sheet"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Výdavky v období"
          >
            <header className="tag-filter-head">
              <div>
                <h4>Výdavky - {detailPoint.label}</h4>
                <p className="tag-sub">
                  {detailSide === "current" ? bucketDocs.currentPeriodLabel : bucketDocs.previousPeriodLabel}
                </p>
              </div>
              <button type="button" className="filter-close" onClick={() => setDetailPoint(null)}>
                Zavrieť
              </button>
            </header>

            <div className="invoice-detail-tabs">
              <button
                type="button"
                className={detailSide === "current" ? "filter-chip active" : "filter-chip"}
                onClick={() => setDetailSide("current")}
              >
                Tento rok
              </button>
              <button
                type="button"
                className={detailSide === "previous" ? "filter-chip active" : "filter-chip"}
                onClick={() => setDetailSide("previous")}
              >
                Vlani
              </button>
            </div>

            <div className="invoice-detail-summary">
              <span>
                {detailDocs.length} {detailDocs.length === 1 ? "doklad" : detailDocs.length < 5 ? "doklady" : "dokladov"}
              </span>
              <strong>{formatCurrencyPrecise(detailTotal)}</strong>
            </div>

            {detailDocs.length === 0 ? (
              <p className="tag-sub">Pre toto obdobie nie sú v lokálnej cache žiadne doklady.</p>
            ) : (
              <ul className="invoice-list">
                {detailDocs.map((expense) => (
                  <li key={`${expense.companyId ?? expense.companyName}-${expense.id}`}>
                    <div className="invoice-item-head">
                      <div className="invoice-item-text">
                        <p className="tag-name invoice-title-line">{expense.partnerName ?? "Neznámy dodávateľ"}</p>
                        <p className="tag-sub">
                          {new Date(expense.issueDate).toLocaleDateString("sk-SK")} •{" "}
                          {getExpenseDocumentTypeLabel(expense.documentType)}
                          {expense.documentNumber ? ` • ${expense.documentNumber}` : ""}
                        </p>
                      </div>
                      <strong>{formatCurrencyPrecise(expense.totalPriceInclVat)}</strong>
                    </div>
                    <div className="invoice-tags" aria-label={expense.tags.length ? "Štítky dokladu" : undefined}>
                      {expense.tags.map((tag) => (
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

      {isDueSheetOpen ? (
        <div className="tag-filter-overlay" onClick={() => setIsDueSheetOpen(false)}>
          <div
            className="tag-filter-sheet unsettled-payments-sheet"
            role="dialog"
            aria-modal="true"
            aria-label="Neuhradené doklady"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="tag-filter-head">
              <div>
                <h4>Neuhradené doklady</h4>
                <p className="tag-filter-help">Stráž si splatnosti, nech neplatíš penále.</p>
              </div>
              <button type="button" className="filter-close" onClick={() => setIsDueSheetOpen(false)}>
                Zavrieť
              </button>
            </header>

            <div className="invoice-detail-tabs">
              <button
                type="button"
                className={dueSheetTab === "overdue" ? "filter-chip active" : "filter-chip"}
                onClick={() => setDueSheetTab("overdue")}
              >
                Po splatnosti ({dueWatchlist.overdue.length})
              </button>
              <button
                type="button"
                className={dueSheetTab === "upcoming" ? "filter-chip active" : "filter-chip"}
                onClick={() => setDueSheetTab("upcoming")}
              >
                Čaká na úhradu ({dueWatchlist.upcoming.length})
              </button>
            </div>

            <div className="invoice-detail-summary">
              <span>
                {dueSheetDocs.length} {dueSheetDocs.length === 1 ? "doklad" : dueSheetDocs.length < 5 ? "doklady" : "dokladov"}
              </span>
              <strong>{formatCurrencyPrecise(dueSheetTotal)}</strong>
            </div>

            {dueSheetDocs.length === 0 ? (
              <p className="tag-sub">
                {dueSheetTab === "overdue"
                  ? "Skvelé, nič nie je po splatnosti."
                  : "Žiadne doklady nečakajú na úhradu."}
              </p>
            ) : (
              <ul className="tag-list unsettled-sheet-list">
                {dueSheetDocs.map((expense) => (
                  <ExpenseRow key={`due-${expense.companyId ?? expense.companyName}-${expense.id}`} expense={expense} />
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : null}
    </section>
  );
}
