"use client";

import { useEffect, useMemo, useState } from "react";
import { CashflowDashboard } from "@/components/cashflow-dashboard";
import { CompaniesDashboard } from "@/components/companies-dashboard";
import { DashboardShell } from "@/components/dashboard-shell";
import { ModuleSkeleton } from "@/components/module-skeleton";
import type { VisibilityOption } from "@/components/category-visibility-button";
import { DemoDataBanner } from "@/components/demo-data-banner";
import { FilterMismatchNotice } from "@/components/filter-mismatch-notice";
import { CASHFLOW_MOCK_COMPANIES, getCashflowOverview } from "@/lib/cashflow-mock-data";
import { computeCashflowOverviewFromLiveData } from "@/lib/cashflow-live";
import { useKrosConnections } from "@/lib/use-kros-connections";
import { usePreference } from "@/lib/use-preference";
import { applyCompanyFilter } from "@/lib/preferences/company-filter";
import { cashflowEngine } from "@/lib/sync/cashflow-engine";
import { useSyncOrchestrator } from "@/lib/sync/use-sync-orchestrator";

/**
 * Engine array musí byť modulová konštanta, nie literál v tele komponentu —
 * inak sa efekt v orchestrátore spustí pri každom rendere odznova.
 */
const CASHFLOW_ENGINES = [cashflowEngine];

/** Id pevných sekcií pre prepínač zobrazenia — prefix `section:` ako v ostatných moduloch. */
const CASHFLOW_SECTIONS = {
  companies: "section:companies"
} as const;

export default function CashflowPage() {
  // Granularitu Financie len čítajú (vlastný prepínač nemajú), ale je to to isté osobné
  // nastavenie ako na ostatných prehľadoch — teraz už prežije aj reload.
  const [granularity] = usePreference("ui.granularity");
  const [selectedCompanies, setSelectedCompanies] = usePreference("cashflow.companies");
  const [hiddenSections, setHiddenSections] = usePreference("ui.cashflowHiddenSections");
  const [focusedCompany, setFocusedCompany] = useState<string | null>(null);
  // Prepojenia sú firemné a žijú na serveri.
  const { connections, isLoading: isLoadingConnections } = useKrosConnections();
  const [hasLoadedPersistedFilters, setHasLoadedPersistedFilters] = useState(false);

  const preferredCompanyNames = useMemo(
    () =>
      connections.length
        ? connections.map((connection) => connection.companyName)
        : CASHFLOW_MOCK_COMPANIES,
    [connections]
  );

  const preferredCompanySet = useMemo(() => new Set(preferredCompanyNames), [preferredCompanyNames]);

  const normalizedSelectedCompanies = useMemo(
    () => selectedCompanies.filter((companyName) => preferredCompanySet.has(companyName)),
    [selectedCompanies, preferredCompanySet]
  );

  const effectiveCompanies = useMemo(() => {
    if (focusedCompany && preferredCompanySet.has(focusedCompany)) return [focusedCompany];
    return normalizedSelectedCompanies;
  }, [focusedCompany, normalizedSelectedCompanies, preferredCompanySet]);

  /**
   * Id-čka len ZVOLENÝCH firiem, nie všetkého, čo sa stiahlo.
   *
   * `selectedCompanyIds` je záložné párovanie k výberu podľa mena — keď sa firma v KROSe
   * premenuje, výber podľa mena by ju nenašiel. Kým sme tam posielali všetky
   * synchronizované firmy, tá podmienka prepustila každý účet a rozkliknutá firma prehľad
   * nezúžila: filter fungoval len preto, že sám zúžil zoznam sťahovaných firiem.
   */
  const selectedCompanyIds = useMemo(() => {
    if (effectiveCompanies.length === 0) return [];
    const selected = new Set(effectiveCompanies);
    return connections
      .filter((connection) => selected.has(connection.companyName))
      .map((connection) => connection.companyId);
  }, [effectiveCompanies, connections]);

  // Prázdny výber = všetky prepojené firmy; inak prienik. Neprázdny výber bez prieniku
  // nesťahuje nič a povie to hláškou — nespadne späť na sťahovanie všetkých firiem.
  const companyFilter = useMemo(
    () => applyCompanyFilter(connections, selectedCompanies, (connection) => connection.companyName),
    [connections, selectedCompanies]
  );
  const syncConnections = companyFilter.companies;

  // Prvý render beží ešte pred pripojením k store-u, takže sa sťahovanie odkladá o tik.
  useEffect(() => {
    setHasLoadedPersistedFilters(true);
  }, []);

  const {
    data: { accounts: liveAccounts, transactions: liveTransactions },
    isSyncing: isLoadingLiveData,
    hasResolvedFirstData,
    error: liveError,
    refresh
  } = useSyncOrchestrator(CASHFLOW_ENGINES, {
    connections,
    syncConnections,
    granularity,
    enabled: hasLoadedPersistedFilters
  });

  const hasLiveData = liveAccounts.length > 0 || liveTransactions.length > 0;
  const liveOverview = useMemo(
    () =>
      hasLiveData
        ? computeCashflowOverviewFromLiveData({
            accounts: liveAccounts,
            transactions: liveTransactions,
            granularity,
            selectedCompanies: effectiveCompanies,
            selectedCompanyIds
          })
        : null,
    [hasLiveData, liveAccounts, liveTransactions, granularity, effectiveCompanies, selectedCompanyIds]
  );

  const mockOverview = useMemo(
    () => getCashflowOverview(granularity, effectiveCompanies),
    [granularity, effectiveCompanies]
  );
  const overview = liveOverview ?? mockOverview;

  const availableCompanyNames = connections.length
    ? connections.map((connection) => connection.companyName)
    : overview.availableCompanyNames;

  const filteredCompanies = useMemo(() => {
    if (availableCompanyNames.length === 0) return overview.companyBreakdown;
    const availableSet = new Set(availableCompanyNames);
    return overview.companyBreakdown.filter((company) => availableSet.has(company.name));
  }, [availableCompanyNames, overview.companyBreakdown]);

  const updateSelectionWithFocusedGuard = (nextSelection: string[]) => {
    setSelectedCompanies(nextSelection);
    if (focusedCompany && !nextSelection.includes(focusedCompany)) {
      setFocusedCompany(null);
    }
  };

  const shouldShowMockData = connections.length === 0 || (!!liveError && !hasLiveData);
  // Prechod na modul má ukázať loader, nie demo čísla, ktoré o chvíľu prepíšu tie skutočné.
  const isPreparingModule = isLoadingConnections || !hasResolvedFirstData;

  const sectionOptions = useMemo<VisibilityOption[]>(
    () => [
      {
        id: CASHFLOW_SECTIONS.companies,
        label: "Financie podľa firiem",
        filterCount: selectedCompanies.length
      }
    ],
    [selectedCompanies]
  );

  const isSectionHidden = (id: string) => hiddenSections.includes(id);

  return (
    <DashboardShell
      title="Financie"
      isSyncing={isLoadingLiveData}
      syncNote="Pohyby na účtoch ťaháme pre každú firmu naraz, preto prvé načítanie trvá dlhšie. Ostanú uložené v zariadení — pri ďalšom otvorení sa dosynchronizujú len zmeny."
      onRefresh={connections.length > 0 ? refresh : undefined}
      categoryVisibility={{
        categoryOptions: [],
        sectionOptions,
        hiddenIds: hiddenSections,
        onHiddenIdsChange: setHiddenSections
      }}
    >
      {isPreparingModule ? <ModuleSkeleton label="Načítavam financie…" /> : null}
      {isPreparingModule ? null : (
        <>
      {shouldShowMockData && !isLoadingConnections ? <DemoDataBanner /> : null}
      {companyFilter.noneAvailable ? <FilterMismatchNotice onShowAll={() => setSelectedCompanies([])} /> : null}
      <CashflowDashboard
        kpis={overview.kpis}
        points={overview.points}
        accountPointsById={overview.accountPointsById}
        accounts={overview.accountBreakdown}
        recentTransactions={overview.recentTransactions}
        unsettledTransactions={overview.unsettledTransactions}
        isMockData={shouldShowMockData}
        activeCompanyLabel={focusedCompany ?? undefined}
        onClearCompanyFilter={() => setFocusedCompany(null)}
        onResetCompanyFilter={() => {
          setSelectedCompanies([]);
          setFocusedCompany(null);
        }}
      />
      {isSectionHidden(CASHFLOW_SECTIONS.companies) ? null : (
      <CompaniesDashboard
        title="Financie podľa firiem"
        companies={filteredCompanies}
        selectedCompanies={selectedCompanies}
        availableCompanyNames={availableCompanyNames}
        focusedCompany={focusedCompany}
        onSelectionChange={updateSelectionWithFocusedGuard}
        onFocusedCompanyChange={setFocusedCompany}
      />
      )}
        </>
      )}
    </DashboardShell>
  );
}
