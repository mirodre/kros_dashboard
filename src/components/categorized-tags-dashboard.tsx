"use client";

import { useEffect, useMemo, useState } from "react";
import type { AggregatedBreakdownPoint } from "@/lib/kros-types";
import {
  FLAT_TAG_FILTER_KEY,
  groupTagPointsByCategory,
  hasRealCategories,
  setCategoryTagFilter,
  type TagCategoryFilters,
  type TagCategoryIndex
} from "@/lib/tag-categories";
import { FilterableBreakdownSection } from "./filterable-breakdown-section";

const COLLAPSED_CATEGORIES_STORAGE_KEY = "kros_dashboard_collapsed_tag_categories";

type Props = {
  /** Body na zobrazenie (už prepočítané podľa aktívneho filtra). */
  tags: AggregatedBreakdownPoint[];
  /** Všetky štítky pre dialóg filtra (aj odfiltrované), aby ich bolo možné znova zapnúť. */
  availableTags?: AggregatedBreakdownPoint[];
  categoryIndex: TagCategoryIndex;
  categoryFilters: TagCategoryFilters;
  focusedTag: string | null;
  onCategoryFiltersChange: (filters: TagCategoryFilters) => void;
  onFocusedTagChange: (tag: string | null) => void;
  isLoading?: boolean;
  baseTitle?: string;
  ariaLabelPrefix?: string;
  invertDeltaColor?: boolean;
  /** Oddelený kľúč localStorage, ak majú Tržby/Výdavky vlastný stav zbalenia. */
  collapsedStorageKey?: string;
};

function readCollapsedCategories(storageKey: string): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((value): value is string => typeof value === "string");
  } catch {
    return [];
  }
}

export function CategorizedTagsDashboard({
  tags,
  availableTags,
  categoryIndex,
  categoryFilters = {},
  focusedTag,
  onCategoryFiltersChange,
  onFocusedTagChange,
  isLoading = false,
  baseTitle = "Tržby podľa štítkov",
  ariaLabelPrefix = "Filtrovať prehľad podľa štítku",
  invertDeltaColor = false,
  collapsedStorageKey = COLLAPSED_CATEGORIES_STORAGE_KEY
}: Props) {
  const filters = categoryFilters ?? {};
  const dialogSource = availableTags ?? tags;
  const [collapsedCategories, setCollapsedCategories] = useState<string[]>([]);
  const [hasLoadedCollapsed, setHasLoadedCollapsed] = useState(false);

  useEffect(() => {
    setCollapsedCategories(readCollapsedCategories(collapsedStorageKey));
    setHasLoadedCollapsed(true);
  }, [collapsedStorageKey]);

  useEffect(() => {
    if (!hasLoadedCollapsed) return;
    localStorage.setItem(collapsedStorageKey, JSON.stringify(collapsedCategories));
  }, [collapsedCategories, collapsedStorageKey, hasLoadedCollapsed]);

  const collapsedSet = useMemo(() => new Set(collapsedCategories), [collapsedCategories]);

  const setCategoryCollapsed = (category: string, collapsed: boolean) => {
    setCollapsedCategories((prev) => {
      const has = prev.includes(category);
      if (collapsed && !has) return [...prev, category];
      if (!collapsed && has) return prev.filter((name) => name !== category);
      return prev;
    });
  };

  const groups = useMemo(
    () => groupTagPointsByCategory(tags, categoryIndex),
    [tags, categoryIndex]
  );
  const availableGroups = useMemo(
    () => groupTagPointsByCategory(dialogSource, categoryIndex),
    [dialogSource, categoryIndex]
  );
  const availableNamesByCategory = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const group of availableGroups) {
      map.set(
        group.category,
        group.points.map((point) => point.name)
      );
    }
    return map;
  }, [availableGroups]);

  const showCategories = hasRealCategories(categoryIndex) && availableGroups.length > 0;

  if (!showCategories) {
    const selectedFlat = filters[FLAT_TAG_FILTER_KEY] ?? [];
    return (
      <FilterableBreakdownSection
        title={baseTitle}
        filterLabel="Filter štítkov"
        dialogTitle="Filter štítkov"
        dialogHelp="Vyber štítky, ktoré chceš vidieť. Ak nevyberieš nič, zobrazia sa všetky."
        ariaLabelPrefix={ariaLabelPrefix}
        items={tags}
        availableItemNames={dialogSource.map((point) => point.name)}
        selectedItems={selectedFlat}
        focusedItem={focusedTag}
        onSelectionChange={(next) =>
          onCategoryFiltersChange(setCategoryTagFilter({}, FLAT_TAG_FILTER_KEY, next))
        }
        onFocusedItemChange={onFocusedTagChange}
        isLoading={isLoading}
        invertDeltaColor={invertDeltaColor}
      />
    );
  }

  // Sekcie berieme z availableGroups, aby kategória s aktívnym filtrom nezmizla,
  // keď sú všetky jej štítky dočasne mimo scoped breakdownu.
  return (
    <>
      {availableGroups.map((availableGroup) => {
        const displayGroup = groups.find((group) => group.category === availableGroup.category);
        const selectedForCategory = filters[availableGroup.category] ?? [];
        const focusedForCategory =
          focusedTag &&
          availableGroup.points.some((point) => point.name === focusedTag)
            ? focusedTag
            : null;

        return (
          <FilterableBreakdownSection
            key={availableGroup.category}
            title={availableGroup.category}
            filterLabel="Filter štítkov"
            dialogTitle={`Filter štítkov – ${availableGroup.category}`}
            dialogHelp="Vyber štítky z tejto kategórie, ktoré chceš vidieť. Ak nevyberieš nič, zobrazia sa všetky. Odfiltrované štítky sa nepremietnu do grafu ani ostatných sekcií."
            ariaLabelPrefix={ariaLabelPrefix}
            items={displayGroup?.points ?? []}
            availableItemNames={availableNamesByCategory.get(availableGroup.category) ?? []}
            selectedItems={selectedForCategory}
            focusedItem={focusedForCategory}
            onSelectionChange={(next) =>
              onCategoryFiltersChange(
                setCategoryTagFilter(filters, availableGroup.category, next)
              )
            }
            onFocusedItemChange={onFocusedTagChange}
            isLoading={isLoading}
            invertDeltaColor={invertDeltaColor}
            collapsible
            collapsed={collapsedSet.has(availableGroup.category)}
            onCollapsedChange={(collapsed) =>
              setCategoryCollapsed(availableGroup.category, collapsed)
            }
          />
        );
      })}
    </>
  );
}
