"use client";

import type { ExpenseVendorPoint } from "@/lib/expenses-live";
import { formatCurrency, formatDelta, getDeltaPct } from "@/lib/format";
import { usePersistedCollapsed } from "@/lib/use-persisted-collapsed";

type Props = {
  vendors: ExpenseVendorPoint[];
  isLoading?: boolean;
};

export function ExpenseVendorsSection({ vendors, isLoading = false }: Props) {
  const [collapsed, setCollapsed] = usePersistedCollapsed(
    "kros_dashboard_collapsed_expense_vendors"
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
            aria-label={collapsed ? "Rozbaliť Top dodávatelia" : "Zbaliť Top dodávatelia"}
          >
            <span className={`panel-collapse-chevron${collapsed ? " collapsed" : ""}`} aria-hidden="true">
              ▾
            </span>
            <h3>Top dodávatelia</h3>
          </button>
        </header>

        {!collapsed ? (
          <>
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
                      <p className="tag-name" title={vendor.name}>{vendor.name}</p>
                      <p className="tag-sub">
                        {(vendor.share * 100).toFixed(1)} % výdavkov • {vendor.documentCount}{" "}
                        {vendor.documentCount === 1
                          ? "doklad"
                          : vendor.documentCount < 5
                            ? "doklady"
                            : "dokladov"}
                      </p>
                      <div className="vendor-share-track" aria-hidden="true">
                        <div
                          className="vendor-share-fill"
                          style={{ width: `${Math.min(vendor.share * 100, 100)}%` }}
                        />
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
          </>
        ) : null}
      </article>
    </section>
  );
}
