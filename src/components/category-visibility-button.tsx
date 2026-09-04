"use client";

import { useState } from "react";
import { SheetOverlay } from "./sheet-overlay";

export type CategoryVisibilitySettings = {
  /** Všetky kategórie, ktoré prehľad v dátach má — v poradí sekcií. */
  categories: string[];
  /** Skryté kategórie. Čo tu nie je, je zobrazené — nová kategória teda príde viditeľná. */
  hiddenCategories: string[];
  /**
   * Počet zvolených štítkov na kategóriu. Skrytie kategórie jej filter NERUŠÍ, takže to
   * treba pri prepínači vidieť — inak by čísla v prehľade zúžil filter, ktorý nikde nie je.
   */
  activeFilterCounts?: Record<string, number>;
  onHiddenCategoriesChange: (hidden: string[]) => void;
};

type Props = CategoryVisibilitySettings & {
  /** Do nadpisu dialógu, aby bolo jasné, ktorého modulu sa výber týka. */
  moduleTitle: string;
};

/**
 * Ikona v hlavičke modulu, ktorá vysunie zoznam kategórií a dá ich vypnúť. Kategórií býva
 * veľa a nie každý ich chce mať pod hlavným grafom všetky — výber je osobný, drží ho
 * `ui.*HiddenCategories`.
 */
export function CategoryVisibilityButton({
  categories,
  hiddenCategories,
  activeFilterCounts = {},
  onHiddenCategoriesChange,
  moduleTitle
}: Props) {
  const [isOpen, setIsOpen] = useState(false);

  const hiddenSet = new Set(hiddenCategories);
  const visibleCount = categories.filter((category) => !hiddenSet.has(category)).length;
  // Skrytá kategória s filtrom potichu zužuje celý prehľad — bodka na ikone je jediné
  // miesto, kde sa to v hlavičke dá zaregistrovať.
  const hasHiddenFilters = hiddenCategories.some((category) => (activeFilterCounts[category] ?? 0) > 0);

  const toggleCategory = (category: string) => {
    onHiddenCategoriesChange(
      hiddenSet.has(category)
        ? hiddenCategories.filter((name) => name !== category)
        : [...hiddenCategories, category]
    );
  };

  return (
    <>
      <button
        type="button"
        className={[
          "header-icon-btn",
          hiddenCategories.length > 0 ? "is-active" : "",
          hasHiddenFilters ? "has-hidden-filters" : ""
        ]
          .filter(Boolean)
          .join(" ")}
        onClick={() => setIsOpen(true)}
        aria-label={
          hasHiddenFilters
            ? "Zobrazené kategórie — skrytá kategória má aktívny filter"
            : "Zobrazené kategórie"
        }
        title={
          hasHiddenFilters
            ? "Zobrazené kategórie — skrytá kategória má aktívny filter"
            : "Zobrazené kategórie"
        }
      >
        <svg className="header-action-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M4 7h9" />
          <path d="M17 7h3" />
          <path d="M4 12h4" />
          <path d="M12 12h8" />
          <path d="M4 17h11" />
          <path d="M19 17h1" />
          <circle cx="15" cy="7" r="2" />
          <circle cx="10" cy="12" r="2" />
          <circle cx="17" cy="17" r="2" />
        </svg>
      </button>

      {isOpen ? (
        <SheetOverlay onClose={() => setIsOpen(false)}>
          <div
            className="tag-filter-sheet"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label={`Zobrazené kategórie – ${moduleTitle}`}
          >
            <header className="tag-filter-head">
              <h4>Zobrazené kategórie</h4>
              <button type="button" className="filter-close" onClick={() => setIsOpen(false)}>
                Zavrieť
              </button>
            </header>

            <p className="tag-filter-help">
              Vyklikaj kategórie, ktoré chceš mať pod hlavným grafom. Vypnutá kategória sa iba
              skryje — jej štítky ostávajú v grafe aj v číslach a jej filter platí ďalej.
              Kategórie s aktívnym filtrom sú označené lievikom.
            </p>

            {categories.length === 0 ? (
              <p className="tag-sub">Tento prehľad zatiaľ žiadne kategórie štítkov nemá.</p>
            ) : (
              <div className="category-visibility-options">
                {categories.map((category) => {
                  const isVisible = !hiddenSet.has(category);
                  const filterCount = activeFilterCounts[category] ?? 0;
                  return (
                    <button
                      type="button"
                      key={category}
                      className="category-visibility-row"
                      onClick={() => toggleCategory(category)}
                      aria-pressed={isVisible}
                    >
                      <span className="category-visibility-name">
                        {category}
                        {filterCount > 0 ? (
                          <span
                            className="category-filter-hint"
                            title={`Aktívny filter: ${filterCount} ${
                              filterCount === 1 ? "štítok" : filterCount < 5 ? "štítky" : "štítkov"
                            }`}
                          >
                            <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
                              <path
                                d="M3.4 4.6h13.2a.75.75 0 0 1 .58 1.23l-4.83 5.79v4.03a.75.75 0 0 1-1.12.65l-2.6-1.5a.75.75 0 0 1-.37-.65v-2.53L2.82 5.83A.75.75 0 0 1 3.4 4.6z"
                                fill="currentColor"
                              />
                            </svg>
                            {filterCount}
                          </span>
                        ) : null}
                      </span>
                      <span
                        className={isVisible ? "category-switch is-on" : "category-switch"}
                        aria-hidden="true"
                      >
                        <span className="category-switch-knob" />
                      </span>
                    </button>
                  );
                })}
              </div>
            )}

            <footer className="tag-filter-actions">
              <button
                type="button"
                className="secondary-button"
                onClick={() => onHiddenCategoriesChange([])}
                disabled={hiddenCategories.length === 0}
              >
                Zobraziť všetky
              </button>
              <button type="button" className="sync-button" onClick={() => setIsOpen(false)}>
                Hotovo ({visibleCount} z {categories.length})
              </button>
            </footer>
          </div>
        </SheetOverlay>
      ) : null}
    </>
  );
}
