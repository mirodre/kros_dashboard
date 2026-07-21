"use client";

import type { NormalizedExpense } from "@/lib/kros-types";
import {
  getExpenseDocumentTypeLabel,
  isExpenseOverdue,
  isExpenseUnpaid
} from "@/lib/expenses-live";
import { formatCurrencyPrecise } from "@/lib/format";
import { usePersistedCollapsed } from "@/lib/use-persisted-collapsed";

function formatDueDate(expense: NormalizedExpense) {
  if (!expense.dueDate) return null;
  const due = new Date(expense.dueDate);
  if (Number.isNaN(due.getTime())) return null;
  return due.toLocaleDateString("sk-SK");
}

/** Riadok výdavkového dokladu — zdieľaný sekciou Posledné výdavky a sheetom splatností. */
export function ExpenseRow({ expense }: { expense: NormalizedExpense }) {
  const issueDate = new Date(expense.issueDate);
  const now = new Date();
  const isToday =
    issueDate.getFullYear() === now.getFullYear() &&
    issueDate.getMonth() === now.getMonth() &&
    issueDate.getDate() === now.getDate();
  const overdue = isExpenseOverdue(expense);
  const unpaid = !overdue && isExpenseUnpaid(expense);
  const dueLabel = formatDueDate(expense);

  return (
    <li className={overdue ? "movement-row attention" : "movement-row"}>
      <div className="movement-row-head">
        <p className="tag-name with-today-indicator">
          {overdue ? (
            <span
              className="today-movement-indicator today-movement-indicator--unmatched-warn"
              aria-label="Po splatnosti"
              title="Po splatnosti"
            >
              PO SPLATNOSTI
            </span>
          ) : null}
          {unpaid ? (
            <span
              className="today-movement-indicator today-movement-indicator--unpaid"
              aria-label="Čaká na úhradu"
              title="Čaká na úhradu"
            >
              NEUHRADENÉ
            </span>
          ) : null}
          {isToday ? (
            <span
              className="today-movement-indicator today-movement-indicator--new-invoice"
              aria-label="Dnešný doklad"
              title="Dnešný doklad"
            >
              NEW
            </span>
          ) : null}
          <span className="movement-row-partner" title={expense.partnerName ?? "Neznámy dodávateľ"}>
            {expense.partnerName ?? "Neznámy dodávateľ"}
          </span>
        </p>
      </div>
      <div className="movement-row-body">
        <div className="movement-row-meta">
          <p className="tag-sub">
            {issueDate.toLocaleDateString("sk-SK")} • {getExpenseDocumentTypeLabel(expense.documentType)}
            {expense.documentNumber ? ` • ${expense.documentNumber}` : ""}
          </p>
          {(overdue || unpaid) && dueLabel ? (
            <p className="tag-sub">Splatnosť {dueLabel}</p>
          ) : null}
          {expense.tags.length > 0 ? (
            <div className="invoice-tags" aria-label="Štítky dokladu">
              {expense.tags.map((tag) => (
                <span key={tag}>{tag}</span>
              ))}
            </div>
          ) : null}
        </div>
        <div className="tag-values movement-row-amount">
          <p className={expense.totalPriceInclVat < 0 ? "movement-amount-text up" : "movement-amount-text down"}>
            {formatCurrencyPrecise(-expense.totalPriceInclVat)}
          </p>
        </div>
      </div>
    </li>
  );
}

type Props = {
  expenses: NormalizedExpense[];
  isLoading?: boolean;
};

export function RecentExpensesSection({ expenses, isLoading = false }: Props) {
  const [collapsed, setCollapsed] = usePersistedCollapsed(
    "kros_dashboard_collapsed_recent_expenses"
  );

  return (
    <section className="dashboard-body">
      <article className={`panel panel-with-skeleton${collapsed ? " panel-collapsed" : ""}`}>
        <header className="panel-head">
          <button
            type="button"
            className="panel-collapse-toggle"
            onClick={() => setCollapsed(!collapsed)}
            aria-expanded={!collapsed}
            aria-label={collapsed ? "Rozbaliť Posledné výdavky" : "Zbaliť Posledné výdavky"}
          >
            <span className={`panel-collapse-chevron${collapsed ? " collapsed" : ""}`} aria-hidden="true">
              ▾
            </span>
            <h3>Posledné výdavky</h3>
          </button>
        </header>

        {!collapsed ? (
          <>
            {isLoading ? (
              <div className="dashboard-skeleton-overlay list-skeleton" aria-live="polite">
                {Array.from({ length: 5 }).map((_, index) => (
                  <div className="skeleton-list-row" key={`expense-skeleton-${index}`}>
                    <span />
                    <span />
                  </div>
                ))}
              </div>
            ) : null}

            {!isLoading && expenses.length === 0 ? (
              <p className="tag-filter-help">V tomto výbere zatiaľ nemáme žiadne výdavky.</p>
            ) : null}

            {!isLoading && expenses.length > 0 ? (
              <ul className="tag-list">
                {expenses.map((expense) => (
                  <ExpenseRow key={`${expense.companyId ?? expense.companyName}-${expense.id}`} expense={expense} />
                ))}
              </ul>
            ) : null}
          </>
        ) : null}
      </article>
    </section>
  );
}
