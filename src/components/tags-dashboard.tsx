"use client";

import type { TagPoint } from "@/lib/mock-data";
import { FilterableBreakdownSection } from "./filterable-breakdown-section";

type Props = {
  tags: TagPoint[];
  displayedTags: string[];
  filterTags: string[];
  focusedTag: string | null;
  onDisplayedTagsChange: (tags: string[]) => void;
  onFilterTagsChange: (tags: string[]) => void;
  onFocusedTagChange: (tag: string | null) => void;
  isLoading?: boolean;
};

export function TagsDashboard({
  tags,
  displayedTags,
  filterTags,
  focusedTag,
  onDisplayedTagsChange,
  onFilterTagsChange,
  onFocusedTagChange,
  isLoading = false
}: Props) {
  return (
    <FilterableBreakdownSection
      title="Tržby podľa štítkov"
      filterLabel="Zobraz štítky"
      primaryIcon="eye"
      dialogTitle="Zobraz štítky"
      dialogHelp="Vyber štítky, ktoré chceš vidieť v zozname. Ak nevyberieš nič, zobrazia sa všetky."
      ariaLabelPrefix="Filtrovať prehľad podľa štítku"
      items={tags}
      selectedItems={displayedTags}
      focusedItem={focusedTag}
      onSelectionChange={onDisplayedTagsChange}
      onFocusedItemChange={onFocusedTagChange}
      isLoading={isLoading}
      secondaryControl={{
        selectedItems: filterTags,
        onSelectionChange: onFilterTagsChange,
        icon: "filter",
        ariaLabel: "Filter štítkov",
        dialogTitle: "Filter štítkov",
        dialogHelp:
          "Vyber štítky, podľa ktorých sa odfiltrujú dáta v dashboarde. Ak nevyberieš nič, počítajú sa všetky."
      }}
    />
  );
}
