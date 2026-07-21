"use client";

import type { ExpenseVendorPoint } from "@/lib/expenses-live";
import { formatCurrency, formatDelta, getDeltaPct } from "@/lib/format";

type Props = {
  vendors: ExpenseVendorPoint[];
  isLoading?: boolean;
};

export function ExpenseVendorsSection({ vendors, isLoading = false }: Props) {
  return (
    <section className="dashboard-body">
      <article className="panel panel-with-skeleton">
        <header className="panel-head">
          <h3>Top dodávatelia</h3>
        </header>

        {isLoading ? (
          <div className="dashboard-skeleton-overlay list-skeleton" aria-live="polite">
            {Array.from({ length: 4 }).map((_, index) => (
              <div className="skeleton-list-row" key={index}>
                <span />
                <span />
              </div>
            ))}
          </div>
        ) : null}

        {!isLoading && vendors.length === 0 ? (
          <p className="tag-filter-help">V tomto výbere zatiaľ nemáme žiadnych dodávateľov.</p>
        ) : null}

        <ul className="tag-list">
          {vendors.map((vendor) => {
            const delta = getDeltaPct(vendor.amount, vendor.previousAmount);
            return (
              <li key={vendor.name}>
                <div className="vendor-cell">
                  <p className="tag-name">{vendor.name}</p>
                  <p className="tag-sub">
                    {(vendor.share * 100).toFixed(1)} % výdavkov • {vendor.documentCount}{" "}
                    {vendor.documentCount === 1 ? "doklad" : vendor.documentCount < 5 ? "doklady" : "dokladov"}
                  </p>
                  <div className="vendor-share-track" aria-hidden="true">
                    <div className="vendor-share-fill" style={{ width: `${Math.min(vendor.share * 100, 100)}%` }} />
                  </div>
                </div>
                <div className="tag-values">
                  <p>{formatCurrency(vendor.amount)}</p>
                  {delta !== null ? (
                    <p className={delta <= 0 ? "delta up" : "delta down"}>{formatDelta(delta)}</p>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      </article>
    </section>
  );
}
