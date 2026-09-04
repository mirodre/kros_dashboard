"use client";

import { useState } from "react";
import { SheetOverlay } from "./sheet-overlay";

export type VisibilityOption = {
  /** Kategórie štítkov majú `id` rovné svojmu názvu, pevné sekcie prefix `section:`. */
  id: string;
  label: string;
  /**
   * Počet zvolených položiek, ak na sekcii visí filter. Skrytie sekcie filter NERUŠÍ,
   * takže to treba pri prepínači vidieť — inak by čísla v prehľade zúžil filter, ktorý
   * nikde nie je.
   */
  filterCount?: number;
};

export type CategoryVisibilitySettings = {
  /** Kategórie štítkov v poradí sekcií. */
  categoryOptions: VisibilityOption[];
  /** Pevné sekcie modulu (dodávatelia, doklady, firmy). */
  sectionOptions: VisibilityOption[];
  hiddenIds: string[];
  onHiddenIdsChange: (hidden: string[]) => void;
};

type Props = CategoryVisibilitySettings & {
  /** Do nadpisu dialógu, aby bolo jasné, ktorého modulu sa výber týka. */
  moduleTitle: string;
};

/**
 * Ikona v hlavičke modulu, ktorá vysunie zoznam sekcií pod hlavným grafom a dá ich vypnúť.
 * Kategórií štítkov býva veľa a nie každý ich chce mať všetky — výber je osobný, drží ho
 * `ui.*HiddenSections`.
 */
export function CategoryVisibilityButton({
  categoryOptions,
  sectionOptions,
  hiddenIds,
  onHiddenIdsChange,
  moduleTitle
}: Props) {
  const [isOpen, setIsOpen] = useState(false);

  const allOptions = [...categoryOptions, ...sectionOptions];
  const hiddenSet = new Set(hiddenIds);
  const visibleCount = allOptions.filter((option) => !hiddenSet.has(option.id)).length;
  // Skrytá sekcia s filtrom potichu zužuje celý prehľad — bodka na ikone je jediné
  // miesto, kde sa to v hlavičke dá zaregistrovať.
  const hasHiddenFilters = allOptions.some(
    (option) => hiddenSet.has(option.id) && (option.filterCount ?? 0) > 0
  );

  const toggleOption = (id: string) => {
    onHiddenIdsChange(
      hiddenSet.has(id) ? hiddenIds.filter((hidden) => hidden !== id) : [...hiddenIds, id]
    );
  };

  const label = hasHiddenFilters
    ? "Zobrazené sekcie — skrytá sekcia má aktívny filter"
    : "Zobrazené sekcie";

  const renderOptions = (options: VisibilityOption[], groupLabel: string) => {
    if (options.length === 0) return null;

    return (
      <div className="category-visibility-group">
        <p className="category-visibility-group-label">{groupLabel}</p>
        <div className="category-visibility-options">
          {options.map((option) => {
            const isVisible = !hiddenSet.has(option.id);
            const filterCount = option.filterCount ?? 0;

            return (
              <button
                type="button"
                key={option.id}
                className="category-visibility-row"
                onClick={() => toggleOption(option.id)}
                aria-pressed={isVisible}
              >
                <span className="category-visibility-name">
                  {option.label}
                  {filterCount > 0 ? (
                    <span
                      className="category-filter-hint"
                      title={`Aktívny filter: ${filterCount}`}
                    >
                      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
                        <path
                          d="M4 5.5h16l-6.4 7.6v5.2l-3.2-1.8v-3.4L4 5.5z"
                          stroke="currentColor"
                          strokeWidth="1.8"
                          strokeLinecap="round"
                          strokeLinejoin="round"
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
      </div>
    );
  };

  return (
    <>
      <button
        type="button"
        className={[
          "header-icon-btn",
          "category-visibility-trigger",
          hiddenIds.length > 0 ? "is-active" : "",
          hasHiddenFilters ? "has-hidden-filters" : ""
        ]
          .filter(Boolean)
          .join(" ")}
        onClick={() => setIsOpen(true)}
        aria-label={label}
        title={label}
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
            aria-label={`Zobrazené sekcie – ${moduleTitle}`}
          >
            <header className="tag-filter-head">
              <h4>Zobrazené sekcie</h4>
              <button type="button" className="filter-close" onClick={() => setIsOpen(false)}>
                Zavrieť
              </button>
            </header>

            <p className="tag-filter-help">
              Vyklikaj, čo chceš mať pod hlavným grafom. Vypnutá sekcia sa iba skryje — jej
              štítky ostávajú v grafe aj v číslach a jej filter platí ďalej. Sekcie s aktívnym
              filtrom sú označené lievikom.
            </p>

            {allOptions.length === 0 ? (
              <p className="tag-sub">Tento prehľad zatiaľ žiadne sekcie na skrytie nemá.</p>
            ) : (
              <div className="category-visibility-scroll">
                {renderOptions(categoryOptions, "Kategórie štítkov")}
                {renderOptions(sectionOptions, "Ostatné sekcie")}
              </div>
            )}

            <footer className="tag-filter-actions">
              <button
                type="button"
                className="secondary-button"
                onClick={() => onHiddenIdsChange([])}
                disabled={hiddenIds.length === 0}
              >
                Zobraziť všetky
              </button>
              <button type="button" className="sync-button" onClick={() => setIsOpen(false)}>
                Hotovo ({visibleCount} z {allOptions.length})
              </button>
            </footer>
          </div>
        </SheetOverlay>
      ) : null}
    </>
  );
}
