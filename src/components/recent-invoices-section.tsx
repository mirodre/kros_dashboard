"use client";

import type { NormalizedInvoice } from "@/lib/kros-types";
import { formatCurrencyPrecise } from "@/lib/format";

type Props = {
  invoices: NormalizedInvoice[];
  isLoading?: boolean;
};

function parseIssueDate(issueDate: string): Date {
  return new Date(issueDate.includes("T") ? issueDate : `${issueDate}T12:00:00`);
}

export function RecentInvoicesSection({ invoices, isLoading = false }: Props) {
  return (
    <section className="dashboard-body">
      <article className="panel panel-with-skeleton">
        <header className="panel-head">
          <h3>Posledné faktúry</h3>
        </header>

        {isLoading ? (
          <div className="dashboard-skeleton-overlay list-skeleton" aria-live="polite">
            {Array.from({ length: 5 }).map((_, index) => (
              <div className="skeleton-list-row" key={`invoice-skeleton-${index}`}>
                <span />
                <span />
              </div>
            ))}
          </div>
        ) : null}

        {!isLoading && invoices.length === 0 ? (
          <p className="tag-filter-help recent-invoices-empty">V tomto výbere zatiaľ nemáme žiadne faktúry.</p>
        ) : null}

        {!isLoading && invoices.length > 0 ? (
          <ul className="invoice-list recent-invoices-list">
            {invoices.map((invoice) => {
              const issueDate = parseIssueDate(invoice.issueDate);
              const now = new Date();
              const isToday =
                issueDate.getFullYear() === now.getFullYear() &&
                issueDate.getMonth() === now.getMonth() &&
                issueDate.getDate() === now.getDate();

              return (
                <li key={invoice.id}>
                  <div className="invoice-item-head">
                    <div className="invoice-item-text">
                      <p className="tag-name invoice-title-line with-today-indicator">
                        {isToday ? (
                          <span
                            className="today-movement-indicator today-movement-indicator--new-invoice"
                            aria-label="Nová faktúra — vystavená dnes"
                            title="Nová faktúra — vystavená dnes"
                          >
                            NEW
                          </span>
                        ) : null}
                        {invoice.partnerName ?? "Neznámy odberateľ"}
                      </p>
                      <p className="tag-sub">
                        {issueDate.toLocaleDateString("sk-SK")}
                        {invoice.invoiceNumber ? ` • ${invoice.invoiceNumber}` : ""}
                      </p>
                    </div>
                    <strong>{formatCurrencyPrecise(invoice.totalPrice)}</strong>
                  </div>
                  {invoice.tags.length > 0 ? (
                    <div className="invoice-tags" aria-label="Štítky faktúry">
                      {invoice.tags.map((tag) => (
                        <span key={tag}>{tag}</span>
                      ))}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : null}
      </article>
    </section>
  );
}
