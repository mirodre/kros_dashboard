"use client";

import { useState } from "react";
import type { Granularity } from "@/lib/mock-data";
import { GranularityToggle } from "./granularity-toggle";
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
  /**
   * Obdobie grafu. Je tu, a nie nad grafom, aby hlavička modulu ostala čistá — týždeň /
   * mesiac / rok človek prepína zriedka, na prvý pohľad ho tam mať netreba.
   */
  granularity?: Granularity;
  onGranularityChange?: (value: Granularity) => void;
  /**
   * V akom poradí ísť skupinami. Nie kozmetika: prepínač musí čítať zhora dole tak, ako
   * sekcie ležia na obrazovke, inak človek hľadá zaškrtávadlo na opačnom konci zoznamu,
   * než kde vidí panel. Domov má štítky až za pevnými sekciami, ostatné moduly naopak —
   * default preto sedí väčšine a Domov si žiada `"sections-first"`.
   */
  groupOrder?: "categories-first" | "sections-first";
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
  granularity,
  onGranularityChange,
  groupOrder = "categories-first",
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
    ? "Zobrazenie — skrytá sekcia má aktívny filter"
    : "Zobrazenie";

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
                      {/* Ten istý lievik ako `FilterIconButton` — lucide/funnel.
                          Keď sa mení jeden, musí sa aj druhý. */}
                      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
                        <path
                          d="M10 20a1 1 0 0 0 .553.895l2 1A1 1 0 0 0 14 21v-7a2 2 0 0 1 .517-1.341L21.74 4.67A1 1 0 0 0 21 3H3a1 1 0 0 0-.742 1.67l7.225 7.989A2 2 0 0 1 10 14z"
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
        {/* lucide/sliders-horizontal */}
        <svg className="header-action-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M10 5H3" />
          <path d="M12 19H3" />
          <path d="M14 3v4" />
          <path d="M16 17v4" />
          <path d="M21 12h-9" />
          <path d="M21 19h-5" />
          <path d="M21 5h-7" />
          <path d="M8 10v4" />
          <path d="M8 12H3" />
        </svg>
      </button>

      {isOpen ? (
        <SheetOverlay onClose={() => setIsOpen(false)}>
          <div
            className="tag-filter-sheet"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label={`Zobrazenie – ${moduleTitle}`}
          >
            <header className="tag-filter-head">
              <h4>Zobrazenie</h4>
              <button type="button" className="filter-close" onClick={() => setIsOpen(false)}>
                Zavrieť
              </button>
            </header>

            <div className="category-visibility-scroll">
              {granularity && onGranularityChange ? (
                <div className="category-visibility-group">
                  <p className="category-visibility-group-label">Obdobie</p>
                  <GranularityToggle value={granularity} onChange={onGranularityChange} />
                </div>
              ) : null}
              {allOptions.length === 0 ? (
                <p className="tag-sub">Tento prehľad zatiaľ žiadne sekcie na skrytie nemá.</p>
              ) : (
                <>
                  {groupOrder === "sections-first" ? (
                    <>
                      {renderOptions(sectionOptions, "Ostatné sekcie")}
                      {renderOptions(categoryOptions, "Kategórie štítkov")}
                    </>
                  ) : (
                    <>
                      {renderOptions(categoryOptions, "Kategórie štítkov")}
                      {renderOptions(sectionOptions, "Ostatné sekcie")}
                    </>
                  )}
                </>
              )}
            </div>

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
