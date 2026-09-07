"use client";

import { useEffect, useState } from "react";
import type { KpiCard } from "@/lib/mock-data";
import type {
  CashflowAccountPoint,
  CashflowPoint,
  CashflowRecentTransaction
} from "@/lib/cashflow-mock-data";
import { formatCurrency, formatCurrencyPrecise } from "@/lib/format";
import { isSameCalendarDay, parseDocumentDate } from "@/lib/document-date";
import { AccountsDonut } from "./accounts-donut";
import { SheetOverlay } from "./sheet-overlay";

type Props = {
  kpis: KpiCard[];
  points: CashflowPoint[];
  accountPointsById: Record<string, CashflowPoint[]>;
  accounts: CashflowAccountPoint[];
  recentTransactions: CashflowRecentTransaction[];
  unsettledTransactions: CashflowRecentTransaction[];
  isMockData?: boolean;
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
  activeCompanyLabel,
  onClearCompanyFilter,
  onResetCompanyFilter
}: Props) {
  const [activeSliceId, setActiveSliceId] = useState<string | "all">("all");
  const [activeFlowLabel, setActiveFlowLabel] = useState<string | null>(null);
  const [isUnsettledSheetOpen, setIsUnsettledSheetOpen] = useState(false);

  useEffect(() => {
    setActiveSliceId("all");
  }, [accounts]);

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
    <section className="dashboard-body dashboard-section">
      {isMockData ? <span className="active-tag-badge">Demo dáta</span> : null}
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

      {accounts.length === 0 ? (
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
        <AccountsDonut
          accounts={accounts}
          activeAccountId={activeSliceId}
          onActiveAccountChange={setActiveSliceId}
        />
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
              const movementDate = parseDocumentDate(transaction.bookedAt);
              const isToday = isSameCalendarDay(transaction.bookedAt, new Date());
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
                        {movementDate?.toLocaleDateString("sk-SK") ?? "—"} • {transaction.accountName}
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
        <SheetOverlay onClose={() => setIsUnsettledSheetOpen(false)}>
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
                const movementDate = parseDocumentDate(transaction.bookedAt);
                const isToday = isSameCalendarDay(transaction.bookedAt, new Date());
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
                          {movementDate?.toLocaleDateString("sk-SK") ?? "—"} • {transaction.accountName}
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
        </SheetOverlay>
      ) : null}
    </section>
  );
}
