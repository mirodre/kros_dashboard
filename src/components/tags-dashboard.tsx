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
      title="Výkon podľa štítkov"
      filterLabel="Filter štítkov"
      dialogTitle="Filter štítkov"
      dialogHelp="Vyber štítky, ktoré chceš vidieť. Ak nevyberieš nič, zobrazia sa všetky."
      ariaLabelPrefix="Filtrovať prehľad podľa štítku"
      items={tags}
      selectedItems={selectedTags}
      focusedItem={focusedTag}
      onSelectionChange={onSelectionChange}
      onFocusedItemChange={onFocusedTagChange}
      isLoading={isLoading}
    />
  );
}
