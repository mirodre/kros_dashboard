"use client";

import { useMemo, useState } from "react";
import { formatCurrency, formatDelta } from "@/lib/format";

type BreakdownItem = {
  name: string;
  amount: number;
  previousAmount: number;
};

type IconName = "eye" | "filter";

type SecondaryControl = {
  selectedItems: string[];
  onSelectionChange: (items: string[]) => void;
  ariaLabel: string;
  dialogTitle: string;
  dialogHelp: string;
  icon?: IconName;
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
  /** When set, the primary control renders as an icon button instead of a text button. */
  primaryIcon?: IconName;
  /** Optional second control that only collects a selection (e.g. data filter) without changing the visible rows. */
  secondaryControl?: SecondaryControl;
};

function ControlIcon({ name }: { name: IconName }) {
  if (name === "eye") {
    return (
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
        <path
          d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="12" cy="12" r="2.6" stroke="currentColor" strokeWidth="1.6" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
      <path
        d="M4 5h16l-6.2 7.4V19l-3.6-1.8v-4.8L4 5Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

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
  primaryIcon,
  secondaryControl
}: Props) {
  const [activeControl, setActiveControl] = useState<"primary" | "secondary" | null>(null);
  const [pendingSelection, setPendingSelection] = useState<string[]>(selectedItems);

  const availableNames = useMemo(
    () => availableItemNames ?? items.map((item) => item.name),
    [availableItemNames, items]
  );
  const filteredItems = useMemo(() => {
    if (selectedItems.length === 0) return items;
    return items.filter((item) => selectedItems.includes(item.name));
  }, [selectedItems, items]);

  const activeConfig =
    activeControl === "secondary" && secondaryControl
      ? {
          selectedItems: secondaryControl.selectedItems,
          onSelectionChange: secondaryControl.onSelectionChange,
          dialogTitle: secondaryControl.dialogTitle,
          dialogHelp: secondaryControl.dialogHelp,
          clearsFocus: false
        }
      : {
          selectedItems,
          onSelectionChange,
          dialogTitle,
          dialogHelp,
          clearsFocus: true
        };

  const openControl = (control: "primary" | "secondary") => {
    setPendingSelection(control === "secondary" && secondaryControl ? secondaryControl.selectedItems : selectedItems);
    setActiveControl(control);
  };

  const closeControl = () => setActiveControl(null);

  const togglePendingItem = (itemName: string) => {
    setPendingSelection((prev) =>
      prev.includes(itemName) ? prev.filter((name) => name !== itemName) : [...prev, itemName]
    );
  };

  const applyFilter = () => {
    activeConfig.onSelectionChange(pendingSelection);
    closeControl();
  };

  const resetFilter = () => {
    setPendingSelection([]);
    activeConfig.onSelectionChange([]);
    if (activeConfig.clearsFocus) {
      onFocusedItemChange(null);
    }
    closeControl();
  };

  const handleItemClick = (itemName: string) => {
    if (focusedItem === itemName) {
      onFocusedItemChange(null);
      return;
    }
    onFocusedItemChange(itemName);
  };

  return (
    <section className={activeControl ? "dashboard-body overlay-open" : "dashboard-body"}>
      <article className="panel panel-with-skeleton">
        <header className="panel-head">
          <h3>{title}</h3>
          <div className="panel-head-actions">
            {primaryIcon ? (
              <button
                type="button"
                className={selectedItems.length > 0 ? "icon-button active" : "icon-button"}
                onClick={() => openControl("primary")}
                aria-label={filterLabel}
                title={filterLabel}
              >
                <ControlIcon name={primaryIcon} />
                {selectedItems.length > 0 ? (
                  <span className="icon-button-count">{selectedItems.length}</span>
                ) : null}
              </button>
            ) : (
              <button type="button" className="secondary-button" onClick={() => openControl("primary")}>
                {filterLabel}
                {selectedItems.length > 0 ? ` (${selectedItems.length})` : ""}
              </button>
            )}

            {secondaryControl ? (
              <button
                type="button"
                className={secondaryControl.selectedItems.length > 0 ? "icon-button active" : "icon-button"}
                onClick={() => openControl("secondary")}
                aria-label={secondaryControl.ariaLabel}
                title={secondaryControl.ariaLabel}
              >
                <ControlIcon name={secondaryControl.icon ?? "filter"} />
                {secondaryControl.selectedItems.length > 0 ? (
                  <span className="icon-button-count">{secondaryControl.selectedItems.length}</span>
                ) : null}
              </button>
            ) : null}
          </div>
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

        <ul className="tag-list">
          {filteredItems.map((item) => {
            const delta = ((item.amount - item.previousAmount) / item.previousAmount) * 100;
            const isActive = focusedItem === item.name;

            return (
              <li key={item.name} className={isActive ? "active" : ""}>
                <div>
                  <p className="tag-name">{item.name}</p>
                  <p className="tag-sub">vlani {formatCurrency(item.previousAmount)}</p>
                </div>
                <div className="tag-values">
                  <p>{formatCurrency(item.amount)}</p>
                  <p className={delta >= 0 ? "delta up" : "delta down"}>{formatDelta(delta)}</p>
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
      </article>

      {activeControl ? (
        <div className="tag-filter-overlay" onClick={closeControl} role="presentation">
          <div
            className="tag-filter-sheet"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label={activeConfig.dialogTitle}
          >
            <header className="tag-filter-head">
              <h4>{activeConfig.dialogTitle}</h4>
              <button type="button" className="filter-close" onClick={closeControl}>
                Zavrieť
              </button>
            </header>

            <p className="tag-filter-help">{activeConfig.dialogHelp}</p>

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
                Použiť
              </button>
            </footer>
          </div>
        </div>
      ) : null}
    </section>
  );
}
