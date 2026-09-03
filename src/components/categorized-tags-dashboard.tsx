"use client";

import { useMemo } from "react";
import type { AggregatedBreakdownPoint } from "@/lib/kros-types";
import {
  categoryForTag,
  FLAT_TAG_FILTER_KEY,
  groupTagPointsByCategory,
  hasRealCategories,
  setCategoryTagFilter,
  type TagCategoryFilters,
  type TagCategoryIndex
} from "@/lib/tag-categories";
import { usePreference } from "@/lib/use-preference";
import { FilterableBreakdownSection } from "./filterable-breakdown-section";

type Props = {
  /** Body na zobrazenie (už prepočítané podľa aktívneho filtra). */
  tags: AggregatedBreakdownPoint[];
  /** Všetky štítky pre dialóg filtra (aj odfiltrované), aby ich bolo možné znova zapnúť. */
  availableTags?: AggregatedBreakdownPoint[];
  categoryIndex: TagCategoryIndex;
  categoryFilters: TagCategoryFilters;
  /** Focusnuté štítky naprieč kategóriami v poradí klikov. */
  focusedTags: string[];
  onCategoryFiltersChange: (filters: TagCategoryFilters) => void;
  onFocusedTagsChange: (tags: string[]) => void;
  baseTitle?: string;
  ariaLabelPrefix?: string;
  invertDeltaColor?: boolean;
};

export function CategorizedTagsDashboard({
  tags,
  availableTags,
  categoryIndex,
  categoryFilters = {},
  focusedTags,
  onCategoryFiltersChange,
  onFocusedTagsChange,
  baseTitle = "Tržby podľa štítkov",
  ariaLabelPrefix = "Filtrovať prehľad podľa štítku",
  invertDeltaColor = false
}: Props) {
  const filters = categoryFilters ?? {};
  const dialogSource = availableTags ?? tags;
  // Zbalenie kategórií je osobné nastavenie a Tržby aj Výdavky ho zdieľajú — rovnako ako
  // pred presunom na server, kde obe stránky písali do toho istého kľúča.
  const [collapsedCategories, setCollapsedCategories] = usePreference("ui.collapsed.tagCategories");

  const collapsedSet = useMemo(() => new Set(collapsedCategories), [collapsedCategories]);

  const setCategoryCollapsed = (category: string, collapsed: boolean) => {
    const has = collapsedCategories.includes(category);
    if (collapsed && !has) setCollapsedCategories([...collapsedCategories, category]);
    if (!collapsed && has) setCollapsedCategories(collapsedCategories.filter((name) => name !== category));
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
        focusedItems={focusedTags}
        onSelectionChange={(next) =>
          onCategoryFiltersChange(setCategoryTagFilter({}, FLAT_TAG_FILTER_KEY, next))
        }
        onFocusedItemsChange={onFocusedTagsChange}
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
        // Sekcia vidí len focus svojej kategórie; pri zmene ho vrátime k focusu
        // ostatných kategórií, aby klik v jednej sekcii nezrušil focus v inej.
        const isInCategory = (tag: string) =>
          categoryForTag(categoryIndex, tag) === availableGroup.category;
        const focusedForCategory = focusedTags.filter(isInCategory);

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
            focusedItems={focusedForCategory}
            onSelectionChange={(next) =>
              onCategoryFiltersChange(
                setCategoryTagFilter(filters, availableGroup.category, next)
              )
            }
            onFocusedItemsChange={(next) =>
              onFocusedTagsChange([...focusedTags.filter((tag) => !isInCategory(tag)), ...next])
            }
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
