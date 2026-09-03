"use client";

import type { CompanyPoint } from "@/lib/mock-data";
import { usePersistedCollapsed, type CollapsedPreferenceKey } from "@/lib/use-persisted-collapsed";
import { FilterableBreakdownSection } from "./filterable-breakdown-section";

type Props = {
  companies: CompanyPoint[];
  selectedCompanies: string[];
  availableCompanyNames?: string[];
  focusedCompany: string | null;
  onSelectionChange: (companies: string[]) => void;
  onFocusedCompanyChange: (company: string | null) => void;
  title?: string;
  invertDeltaColor?: boolean;
  collapsedKey?: CollapsedPreferenceKey;
};

export function CompaniesDashboard({
  companies,
  selectedCompanies,
  availableCompanyNames,
  focusedCompany,
  onSelectionChange,
  onFocusedCompanyChange,
  title = "Tržby podľa firiem",
  invertDeltaColor = false,
  collapsedKey = "ui.collapsed.companies"
}: Props) {
  const [collapsed, setCollapsed] = usePersistedCollapsed(collapsedKey);

  return (
    <FilterableBreakdownSection
      title={title}
      filterLabel="Filter firiem"
      dialogTitle="Filter firiem"
      dialogHelp="Vyber firmy, ktoré chceš vidieť. Ak nevyberieš nič, zobrazia sa všetky."
      ariaLabelPrefix="Filtrovať prehľad podľa firmy"
      items={companies}
      selectedItems={selectedCompanies}
      availableItemNames={availableCompanyNames}
      focusedItems={focusedCompany ? [focusedCompany] : []}
      onSelectionChange={onSelectionChange}
      // Firmy ostávajú na jednom fokuse — z viacnásobného výberu berieme posledný klik.
      onFocusedItemsChange={(items) => onFocusedCompanyChange(items[items.length - 1] ?? null)}
      invertDeltaColor={invertDeltaColor}
      collapsible
      collapsed={collapsed}
      onCollapsedChange={setCollapsed}
    />
  );
}
