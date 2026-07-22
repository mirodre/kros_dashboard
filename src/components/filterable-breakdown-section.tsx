"use client";

import { useMemo, useState } from "react";
import { formatCurrency, formatDelta, getDeltaPct } from "@/lib/format";

type BreakdownItem = {
  name: string;
  amount: number;
  previousAmount: number;
};

type Props = {
  title: string;
  filterLabel: string;
  dialogTitle: string;
  dialogHelp: string;
  ariaLabelPrefix: string;
  items: BreakdownItem[];
  selectedItems: string[];
  availableItemNames?: string[];
  focusedItem: string | null;
  onSelectionChange: (items: string[]) => void;
  onFocusedItemChange: (item: string | null) => void;
  isLoading?: boolean;
  /** Pri výdavkoch je rast zlá správa — otočí farby delty (nárast = červená). */
  invertDeltaColor?: boolean;
  /** Ak je true, sekciu ide zbaliť (schovať zoznam). */
  collapsible?: boolean;
  collapsed?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
};

export function FilterableBreakdownSection({
  title,
  filterLabel,
  dialogTitle,
  dialogHelp,
  ariaLabelPrefix,
  items,
  selectedItems,
  availableItemNames,
  focusedItem,
  onSelectionChange,
  onFocusedItemChange,
  isLoading = false,
  invertDeltaColor = false,
  collapsible = false,
  collapsed = false,
  onCollapsedChange
}: Props) {
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [pendingSelection, setPendingSelection] = useState<string[]>(selectedItems);

  const availableNames = useMemo(
    () => availableItemNames ?? items.map((item) => item.name),
    [availableItemNames, items]
  );
  const filteredItems = useMemo(() => {
    if (selectedItems.length === 0) return items;
    return items.filter((item) => selectedItems.includes(item.name));
  }, [selectedItems, items]);

  // Celkový objem sekcie pre mini-graf podielu (koľko % z celku daný riadok tvorí).
  const shareTotal = useMemo(
    () => items.reduce((sum, item) => sum + Math.max(item.amount, 0), 0),
    [items]
  );

  const openFilter = () => {
    setPendingSelection(selectedItems);
    setIsFilterOpen(true);
  };

  const closeFilter = () => setIsFilterOpen(false);

  const togglePendingItem = (itemName: string) => {
    setPendingSelection((prev) =>
      prev.includes(itemName) ? prev.filter((name) => name !== itemName) : [...prev, itemName]
    );
  };

  const applyFilter = () => {
    onSelectionChange(pendingSelection);
    closeFilter();
  };

  const resetFilter = () => {
    setPendingSelection([]);
    onSelectionChange([]);
    onFocusedItemChange(null);
    closeFilter();
  };

  const handleItemClick = (itemName: string) => {
    if (focusedItem === itemName) {
      onFocusedItemChange(null);
      return;
    }
    onFocusedItemChange(itemName);
  };

  const toggleCollapsed = () => {
    onCollapsedChange?.(!collapsed);
  };

  return (
    <section className={isFilterOpen ? "dashboard-body overlay-open" : "dashboard-body"}>
      <article className={`panel panel-with-skeleton${collapsed ? " panel-collapsed" : ""}`}>
        <header className="panel-head">
          {collapsible ? (
            <button
              type="button"
              className="panel-collapse-toggle"
              onClick={toggleCollapsed}
              aria-expanded={!collapsed}
              aria-label={collapsed ? `Rozbaliť ${title}` : `Zbaliť ${title}`}
            >
              <span className={`panel-collapse-chevron${collapsed ? " collapsed" : ""}`} aria-hidden="true">
                ▾
              </span>
              <h3>{title}</h3>
            </button>
          ) : (
            <h3>{title}</h3>
          )}
          <button type="button" className="secondary-button" onClick={openFilter}>
            {filterLabel}
            {selectedItems.length > 0 ? ` (${selectedItems.length})` : ""}
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

            <ul className="tag-list">
              {filteredItems.map((item) => {
                const delta = getDeltaPct(item.amount, item.previousAmount);
                const isActive = focusedItem === item.name;
                const share = shareTotal > 0 ? Math.max(item.amount, 0) / shareTotal : 0;

                return (
                  <li key={item.name} className={isActive ? "active" : ""}>
                    <div className="tag-cell">
                      <p className="tag-name" title={item.name}>{item.name}</p>
                      <p className="tag-sub">
                        {(share * 100).toFixed(1)} % z celku • vlani {formatCurrency(item.previousAmount)}
                      </p>
                      <div className="tag-share-track" aria-hidden="true">
                        <div
                          className="tag-share-fill"
                          style={{ width: `${Math.min(share * 100, 100)}%` }}
                        />
                      </div>
                    </div>
                    <div className="tag-values">
                      <p>{formatCurrency(item.amount)}</p>
                      {delta !== null ? (
                        <p
                          className={
                            (invertDeltaColor ? delta <= 0 : delta >= 0) ? "delta up" : "delta down"
                          }
                        >
                          {formatDelta(delta)}
                        </p>
                      ) : null}
                    </div>
                    <button
                      type="button"
                      className="tag-row-hitbox"
                      onClick={() => handleItemClick(item.name)}
                      aria-label={`${ariaLabelPrefix} ${item.name}`}
                    />
                  </li>
                );
              })}
            </ul>
          </>
        ) : null}
      </article>

      {isFilterOpen ? (
        <div className="tag-filter-overlay" onClick={closeFilter} role="presentation">
          <div
            className="tag-filter-sheet"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label={dialogTitle}
          >
            <header className="tag-filter-head">
              <h4>{dialogTitle}</h4>
              <button type="button" className="filter-close" onClick={closeFilter}>
                Zavrieť
              </button>
            </header>

            <p className="tag-filter-help">{dialogHelp}</p>

            <div className="tag-filter-options">
              {availableNames.map((itemName) => {
                const checked = pendingSelection.includes(itemName);
                return (
                  <button
                    type="button"
                    key={itemName}
                    className={checked ? "filter-chip active" : "filter-chip"}
                    onClick={() => togglePendingItem(itemName)}
                  >
                    {itemName}
                  </button>
                );
              })}
            </div>

            <footer className="tag-filter-actions">
              <button type="button" className="secondary-button" onClick={resetFilter}>
                Reset
              </button>
              <button type="button" className="sync-button" onClick={applyFilter}>
                Použiť filter
              </button>
            </footer>
          </div>
        </div>
      ) : null}
    </section>
  );
}
