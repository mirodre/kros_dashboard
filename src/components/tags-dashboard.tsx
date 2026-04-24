"use client";

import type { TagPoint } from "@/lib/mock-data";
import { FilterableBreakdownSection } from "./filterable-breakdown-section";

type Props = {
  tags: TagPoint[];
  selectedTags: string[];
  focusedTag: string | null;
  onSelectionChange: (tags: string[]) => void;
  onFocusedTagChange: (tag: string | null) => void;
  isLoading?: boolean;
};

export function TagsDashboard({
  tags,
  selectedTags,
  focusedTag,
  onSelectionChange,
  onFocusedTagChange,
  isLoading = false
}: Props) {
  return (
    <FilterableBreakdownSection
      title="Výkon podľa tagov"
      filterLabel="Filter tagov"
      dialogTitle="Filter tagov"
      dialogHelp="Vyber tagy, ktoré chceš vidieť. Ak nevyberieš nič, zobrazia sa všetky."
      ariaLabelPrefix="Filtrovať dashboard podľa tagu"
      items={tags}
      selectedItems={selectedTags}
      focusedItem={focusedTag}
      onSelectionChange={onSelectionChange}
      onFocusedItemChange={onFocusedTagChange}
      isLoading={isLoading}
    />
  );
}
