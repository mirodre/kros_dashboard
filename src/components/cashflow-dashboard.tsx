"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { KpiCard } from "@/lib/mock-data";
import type {
  CashflowAccountPoint,
  CashflowPoint,
  CashflowRecentTransaction
} from "@/lib/cashflow-mock-data";
import { formatCurrency, formatCurrencyPrecise } from "@/lib/format";

type Props = {
  kpis: KpiCard[];
  points: CashflowPoint[];
  accountPointsById: Record<string, CashflowPoint[]>;
  accounts: CashflowAccountPoint[];
  recentTransactions: CashflowRecentTransaction[];
  unsettledTransactions: CashflowRecentTransaction[];
  isMockData?: boolean;
  isLoading?: boolean;
  activeCompanyLabel?: string;
  onClearCompanyFilter?: () => void;
  onResetCompanyFilter?: () => void;
};

export function CashflowDashboard({
  kpis: _kpis,
  points,
  accountPointsById,
  accounts,
  recentTransactions,
  unsettledTransactions,
  isMockData = false,
  isLoading = false,
  activeCompanyLabel,
  onClearCompanyFilter,
  onResetCompanyFilter
}: Props) {
  const legendRef = useRef<HTMLUListElement | null>(null);
  const lastLegendDragEndedAtRef = useRef(0);
  const dragStateRef = useRef<{ isPointerDown: boolean; isDragging: boolean; startX: number; startScrollLeft: number }>({
    isPointerDown: false,
    isDragging: false,
    startX: 0,
    startScrollLeft: 0
  });
  const [isLegendDragging, setIsLegendDragging] = useState(false);
  const [activeSliceId, setActiveSliceId] = useState<string | "all">("all");
  const [isPieAnimated, setIsPieAnimated] = useState(false);
  const [activeFlowLabel, setActiveFlowLabel] = useState<string | null>(null);
  const [isUnsettledSheetOpen, setIsUnsettledSheetOpen] = useState(false);

  const chartData = useMemo(() => {
    const palette = [
      "#86f0be",
      "#67c9ff",
      "#9f8bff",
      "#ff9f6e",
      "#ffc46b",
      "#6de0d8",
      "#f68fc9",
      "#7aa6ff"
    ];
    const total = accounts.reduce((sum, account) => sum + Math.max(account.amount, 0), 0);

    let cumulative = -Math.PI / 2;
    return accounts.map((account, index) => {
      const value = Math.max(account.amount, 0);
      const share = total === 0 ? 0 : value / total;
      const startAngle = cumulative;
      const endAngle = cumulative + share * Math.PI * 2;
      cumulative = endAngle;
      return {
        ...account,
        value,
        share,
        color: palette[index % palette.length],
        startAngle,
        endAngle
      };
    });
  }, [accounts]);

  const totalBalance = useMemo(
    () => chartData.reduce((sum, item) => sum + item.amount, 0),
    [chartData]
  );

  const activeSlice = useMemo(
    () => chartData.find((item) => item.id === activeSliceId),
    [chartData, activeSliceId]
  );

  /** Share of real aggregate balance (signed); falls back to pie share when total ≈ 0. */
  const activeAccountSharePercent = useMemo(() => {
    if (!activeSlice) return null;
    const t = totalBalance;
    if (Math.abs(t) < 1e-9) return activeSlice.share * 100;
    return (activeSlice.amount / t) * 100;
  }, [activeSlice, totalBalance]);

  useEffect(() => {
    setActiveSliceId("all");
  }, [accounts]);

  useEffect(() => {
    setIsPieAnimated(false);
    const timeout = window.setTimeout(() => setIsPieAnimated(true), 70);
    return () => window.clearTimeout(timeout);
  }, [chartData]);

  const handleLegendPointerDown = (event: React.PointerEvent<HTMLUListElement>) => {
    const container = legendRef.current;
    if (!container) return;
    dragStateRef.current = {
      isPointerDown: true,
      isDragging: false,
      startX: event.clientX,
      startScrollLeft: container.scrollLeft
    };
  };

  const handleLegendPointerMove = (event: React.PointerEvent<HTMLUListElement>) => {
    const container = legendRef.current;
    const dragState = dragStateRef.current;
    if (!container || !dragState.isPointerDown) return;
    const deltaX = event.clientX - dragState.startX;
    if (!dragState.isDragging && Math.abs(deltaX) > 6) {
      dragState.isDragging = true;
      setIsLegendDragging(true);
    }
    if (!dragState.isDragging) return;
    container.scrollLeft = dragState.startScrollLeft - deltaX;
  };

  const stopLegendDragging = () => {
    if (dragStateRef.current.isDragging) {
      lastLegendDragEndedAtRef.current = Date.now();
    }
    dragStateRef.current.isPointerDown = false;
    dragStateRef.current.isDragging = false;
    setIsLegendDragging(false);
  };

  const handleLegendClickCapture = (event: React.MouseEvent<HTMLUListElement>) => {
    // Ignore only the immediate ghost click right after drag end.
    if (Date.now() - lastLegendDragEndedAtRef.current > 90) return;
    event.preventDefault();
    event.stopPropagation();
  };

  const filteredPoints =
    activeSliceId === "all" ? points : (accountPointsById[activeSliceId] ?? points);
  const filteredRecentTransactions =
    activeSliceId === "all"
      ? recentTransactions.slice(0, 10)
      : recentTransactions.filter((transaction) => transaction.accountId === activeSliceId).slice(0, 10);
  const filteredUnsettledTransactions =
    activeSliceId === "all"
      ? unsettledTransactions
      : unsettledTransactions.filter((transaction) => transaction.accountId === activeSliceId);
  const filteredInflow = filteredPoints.reduce((sum, point) => sum + point.inflow, 0);
  const filteredOutflow = filteredPoints.reduce((sum, point) => sum + point.outflow, 0);
  const maxFlowValue = Math.max(
    1,
    ...filteredPoints.map((point) => Math.max(point.inflow, point.outflow, Math.abs(point.inflow - point.outflow)))
  );
  const activeFlowPoint = filteredPoints.find((point) => point.label === activeFlowLabel) ?? null;
  const flowSummaryInflow = activeFlowPoint ? activeFlowPoint.inflow : filteredInflow;
  const flowSummaryOutflow = activeFlowPoint ? activeFlowPoint.outflow : filteredOutflow;
  const flowSummaryNet = flowSummaryInflow - flowSummaryOutflow;
  const shouldStretchFlowChart = filteredPoints.length > 0 && filteredPoints.length <= 8;
  const unsettledCount = unsettledTransactions.length;

  return (
    <section className={isUnsettledSheetOpen ? "dashboard-body dashboard-section overlay-open" : "dashboard-body dashboard-section"}>
      {isMockData ? <span className="active-tag-badge">Demo dáta</span> : null}
      {isLoading ? <span className="active-tag-badge">Načítavam dáta...</span> : null}
      {activeCompanyLabel ? (
        <button type="button" className="active-tag-badge" onClick={onClearCompanyFilter}>
          <span>{activeCompanyLabel}</span>
          <span className="badge-close">×</span>
        </button>
      ) : null}
      {unsettledCount > 0 ? (
        <button
          type="button"
          className="cashflow-alert-banner"
          onClick={() => setIsUnsettledSheetOpen(true)}
          aria-label={`Máte ${unsettledCount} nenapárovaných platieb`}
        >
          <span className="cashflow-alert-icon">!</span>
          <span>
            Chýba doklad pri {unsettledCount} platb{unsettledCount === 1 ? "e" : unsettledCount < 5 ? "ách" : "ách"}.
            Zobraziť výpis
          </span>
        </button>
      ) : null}

      {accounts.length === 0 && !isLoading ? (
        <article className="panel">
          <div className="cashflow-empty-state">
            <p>Pre vybraný filter firiem nemáme demo dáta.</p>
            <button type="button" className="secondary-button" onClick={onResetCompanyFilter}>
              Resetovať filter firiem
            </button>
          </div>
        </article>
      ) : null}

      <article className="panel">
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
            <svg className="cashflow-donut-svg" viewBox="0 0 320 320" role="img" aria-label="Zostatok podľa účtov">
              {chartData.map((slice, sliceIndex) => {
                const isActive = activeSliceId === slice.id;
                const outerRadius = isActive ? 136 : 126;
                const innerRadius = 90;
                const center = 160;
                const startOuterX = center + outerRadius * Math.cos(slice.startAngle);
                const startOuterY = center + outerRadius * Math.sin(slice.startAngle);
                const endOuterX = center + outerRadius * Math.cos(slice.endAngle);
                const endOuterY = center + outerRadius * Math.sin(slice.endAngle);
                const startInnerX = center + innerRadius * Math.cos(slice.startAngle);
                const startInnerY = center + innerRadius * Math.sin(slice.startAngle);
                const endInnerX = center + innerRadius * Math.cos(slice.endAngle);
                const endInnerY = center + innerRadius * Math.sin(slice.endAngle);
                const isLargeArc = slice.endAngle - slice.startAngle > Math.PI ? 1 : 0;
                const path = [
                  `M ${startOuterX} ${startOuterY}`,
                  `A ${outerRadius} ${outerRadius} 0 ${isLargeArc} 1 ${endOuterX} ${endOuterY}`,
                  `L ${endInnerX} ${endInnerY}`,
                  `A ${innerRadius} ${innerRadius} 0 ${isLargeArc} 0 ${startInnerX} ${startInnerY}`,
                  "Z"
                ].join(" ");
                const isDimmed = activeSliceId !== "all" && !isActive;
                return (
                  <path
                    key={slice.id}
                    d={path}
                    className={`cashflow-donut-slice ${isPieAnimated ? "is-animated" : ""} ${isActive ? "is-active" : ""} ${isDimmed ? "is-dimmed" : ""}`}
                    style={
                      {
                        fill: slice.color,
                        "--slice-index": sliceIndex
                      } as React.CSSProperties
                    }
                    onClick={() => setActiveSliceId((prev) => (prev === slice.id ? "all" : slice.id))}
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
              <p className="cashflow-donut-title">
                {activeSlice ? activeSlice.name : "Všetky účty"}
              </p>
              <strong>
                {formatCurrency(activeSlice ? activeSlice.amount : totalBalance)}
              </strong>
              <span>
                {activeSlice && activeAccountSharePercent !== null
                  ? `${activeAccountSharePercent.toFixed(1)} %`
                  : `${accounts.length} účtov`}
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
            <ul
              ref={legendRef}
              className={isLegendDragging ? "cashflow-donut-legend is-dragging" : "cashflow-donut-legend"}
              onPointerDown={handleLegendPointerDown}
              onPointerMove={handleLegendPointerMove}
              onPointerUp={stopLegendDragging}
              onPointerCancel={stopLegendDragging}
              onPointerLeave={() => stopLegendDragging()}
              onClickCapture={handleLegendClickCapture}
            >
              {chartData.map((slice) => (
                <li key={slice.id}>
                  <button
                    type="button"
                    className={activeSliceId === slice.id ? "cashflow-legend-item active" : "cashflow-legend-item"}
                  style={{ "--legend-accent": slice.color } as React.CSSProperties}
                    onClick={() => setActiveSliceId((prev) => (prev === slice.id ? "all" : slice.id))}
                  >
                    <span className="cashflow-legend-label">{slice.name}</span>
                    <span className="cashflow-legend-value">{formatCurrency(slice.amount)}</span>
                    {(() => {
                      const deltaValue = slice.amount - slice.previousAmount;
                      return (
                        <span className={deltaValue >= 0 ? "cashflow-legend-trend up" : "cashflow-legend-trend down"}>
                          {deltaValue >= 0 ? "+" : "-"}
                          {formatCurrency(Math.abs(deltaValue))}
                        </span>
                      );
                    })()}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </article>

      <article className="panel">
        <header className="panel-head">
          <h3>Tok peňazí v čase</h3>
        </header>
        <div className="cashflow-flow-summary">
          <div className="cashflow-flow-summary-row" role="group" aria-label="Súhrn toku peňazí">
            {activeFlowPoint ? (
              <>
                <span className="cashflow-flow-summary-period-inline">{activeFlowPoint.label}</span>
                <span className="cashflow-flow-summary-sep" aria-hidden="true">
                  ·
                </span>
              </>
            ) : null}
            <span className="cashflow-flow-summary-seg">
              <span className="cashflow-flow-summary-seg-label">Príjem</span>{" "}
              <span className="cashflow-flow-summary-seg-value">{formatCurrency(flowSummaryInflow)}</span>
            </span>
            <span className="cashflow-flow-summary-sep" aria-hidden="true">
              ·
            </span>
            <span className="cashflow-flow-summary-seg">
              <span className="cashflow-flow-summary-seg-label">Výdaj</span>{" "}
              <span className="cashflow-flow-summary-seg-value">{formatCurrency(flowSummaryOutflow)}</span>
            </span>
            <span className="cashflow-flow-summary-sep" aria-hidden="true">
              ·
            </span>
            <span className="cashflow-flow-summary-seg">
              <span className="cashflow-flow-summary-seg-label">Rozdiel</span>{" "}
              <span
                className={
                  flowSummaryNet >= 0
                    ? "cashflow-flow-summary-seg-value delta up"
                    : "cashflow-flow-summary-seg-value delta down"
                }
              >
                {formatCurrency(flowSummaryNet)}
              </span>
            </span>
          </div>
        </div>
        <div className={shouldStretchFlowChart ? "cashflow-time-chart stretch" : "cashflow-time-chart"}>
          {filteredPoints.map((point) => {
            const isActiveFlowPoint = activeFlowLabel === point.label;
            return (
              <div
                key={point.label}
                className={isActiveFlowPoint ? "cashflow-time-item active" : "cashflow-time-item"}
                onMouseEnter={() => setActiveFlowLabel(point.label)}
                onMouseLeave={() => setActiveFlowLabel(null)}
                onFocus={() => setActiveFlowLabel(point.label)}
                onBlur={() => setActiveFlowLabel(null)}
                onTouchStart={() => setActiveFlowLabel(point.label)}
              >
                <div className="cashflow-time-bars">
                  <div className="cashflow-time-bar-wrap">
                    <div
                      className="cashflow-time-bar inflow"
                      style={{ height: `${(point.inflow / maxFlowValue) * 100}%` }}
                    />
                  </div>
                  <div className="cashflow-time-bar-wrap">
                    <div
                      className="cashflow-time-bar outflow"
                      style={{ height: `${(point.outflow / maxFlowValue) * 100}%` }}
                    />
                  </div>
                </div>
                <p className="cashflow-time-label">{point.label}</p>
              </div>
            );
          })}
        </div>
      </article>

      <section className="dashboard-body">
        <article className="panel">
          <header className="panel-head">
            <h3>Posledné platby</h3>
          </header>
          <ul className="tag-list">
            {filteredRecentTransactions.map((transaction) => {
              const movementDate = new Date(transaction.bookedAt);
              const now = new Date();
              const isToday =
                movementDate.getFullYear() === now.getFullYear() &&
                movementDate.getMonth() === now.getMonth() &&
                movementDate.getDate() === now.getDate();
              const isUnmatched = !transaction.hasMatchedDocuments && !transaction.isWithoutDocument;
              const rowClass = isUnmatched ? "movement-row attention" : "movement-row";

              return (
                <li key={transaction.id} className={rowClass}>
                  <div className="movement-row-head">
                    <p className="tag-name with-today-indicator">
                      {isUnmatched ? (
                        <span
                          className="today-movement-indicator today-movement-indicator--unmatched-warn"
                          aria-label="Nenapárované — chýba doklad"
                          title="Nenapárované — chýba doklad"
                        >
                          CHÝBA DOKLAD
                        </span>
                      ) : null}
                      {isToday ? (
                        <span
                          className="today-movement-indicator today-movement-indicator--new-invoice"
                          aria-label="Dnešná platba"
                          title="Dnešná platba"
                        >
                          NEW
                        </span>
                      ) : null}
                      <span className="movement-row-partner" title={transaction.partnerName ?? "Neznámy partner"}>
                        {transaction.partnerName ?? "Neznámy partner"}
                      </span>
                    </p>
                  </div>
                  <div className="movement-row-body">
                    <div className="movement-row-meta">
                      <p className="tag-sub">
                        {movementDate.toLocaleDateString("sk-SK")} • {transaction.accountName}
                      </p>
                      {transaction.remittanceInformation ? (
                        <p className="tag-sub">{transaction.remittanceInformation}</p>
                      ) : null}
                    </div>
                    <div className="tag-values movement-row-amount">
                      <p className={transaction.amount >= 0 ? "movement-amount-text up" : "movement-amount-text down"}>
                        {formatCurrencyPrecise(transaction.amount)}
                      </p>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </article>
      </section>
      {isUnsettledSheetOpen ? (
        <div className="tag-filter-overlay" onClick={() => setIsUnsettledSheetOpen(false)}>
          <div
            className="tag-filter-sheet unsettled-payments-sheet"
            role="dialog"
            aria-modal="true"
            aria-label="Nenapárované platby"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="tag-filter-head">
              <div>
                <h4>Platby ku ktorým chýba doklad</h4>
                <p className="tag-filter-help">Tieto platby vyžadujú tvoju pozornosť.</p>
              </div>
              <button type="button" className="filter-close" onClick={() => setIsUnsettledSheetOpen(false)}>
                Zavrieť
              </button>
            </header>
            <ul className="tag-list unsettled-sheet-list">
              {filteredUnsettledTransactions.map((transaction) => {
                const movementDate = new Date(transaction.bookedAt);
                const now = new Date();
                const isToday =
                  movementDate.getFullYear() === now.getFullYear() &&
                  movementDate.getMonth() === now.getMonth() &&
                  movementDate.getDate() === now.getDate();
                return (
                  <li key={`unsettled-${transaction.id}`} className="movement-row attention">
                    <div className="movement-row-head">
                      <p className="tag-name with-today-indicator">
                        <span
                          className="today-movement-indicator today-movement-indicator--unmatched-warn"
                          aria-label="Nenapárované — chýba doklad"
                          title="Nenapárované — chýba doklad"
                        >
                          CHÝBA DOKLAD
                        </span>
                        {isToday ? (
                          <span
                            className="today-movement-indicator today-movement-indicator--new-invoice"
                            aria-label="Dnešná platba"
                            title="Dnešná platba"
                          >
                            NEW
                          </span>
                        ) : null}
                        <span className="movement-row-partner" title={transaction.partnerName ?? "Neznámy partner"}>
                          {transaction.partnerName ?? "Neznámy partner"}
                        </span>
                      </p>
                    </div>
                    <div className="movement-row-body">
                      <div className="movement-row-meta">
                        <p className="tag-sub">
                          {movementDate.toLocaleDateString("sk-SK")} • {transaction.accountName}
                        </p>
                        {transaction.remittanceInformation ? (
                          <p className="tag-sub">{transaction.remittanceInformation}</p>
                        ) : null}
                      </div>
                      <div className="tag-values movement-row-amount">
                        <p className={transaction.amount >= 0 ? "movement-amount-text up" : "movement-amount-text down"}>
                          {formatCurrencyPrecise(transaction.amount)}
                        </p>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      ) : null}
    </section>
  );
}
