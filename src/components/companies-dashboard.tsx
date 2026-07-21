"use client";

import type { CompanyPoint } from "@/lib/mock-data";
import { usePersistedCollapsed } from "@/lib/use-persisted-collapsed";
import { FilterableBreakdownSection } from "./filterable-breakdown-section";

type Props = {
  companies: CompanyPoint[];
  selectedCompanies: string[];
  availableCompanyNames?: string[];
  focusedCompany: string | null;
  onSelectionChange: (companies: string[]) => void;
  onFocusedCompanyChange: (company: string | null) => void;
  isLoading?: boolean;
  title?: string;
  invertDeltaColor?: boolean;
  collapsedStorageKey?: string;
};

export function CompaniesDashboard({
  companies,
  selectedCompanies,
  availableCompanyNames,
  focusedCompany,
  onSelectionChange,
  onFocusedCompanyChange,
  isLoading = false,
  title = "Tržby podľa firiem",
  invertDeltaColor = false,
  collapsedStorageKey = "kros_dashboard_collapsed_companies"
}: Props) {
  const [collapsed, setCollapsed] = usePersistedCollapsed(collapsedStorageKey);

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
      focusedItem={focusedCompany}
      onSelectionChange={onSelectionChange}
      onFocusedItemChange={onFocusedCompanyChange}
      isLoading={isLoading}
      invertDeltaColor={invertDeltaColor}
      collapsible
      collapsed={collapsed}
      onCollapsedChange={setCollapsed}
    />
  );
}
