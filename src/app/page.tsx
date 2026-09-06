"use client";

import { useEffect, useMemo, useState } from "react";
import { DashboardShell } from "@/components/dashboard-shell";
import { ModuleSkeleton } from "@/components/module-skeleton";
import { DemoDataBanner } from "@/components/demo-data-banner";
import { FilterMismatchNotice } from "@/components/filter-mismatch-notice";
import { ProfitDashboard } from "@/components/profit-dashboard";
import type { VisibilityOption } from "@/components/category-visibility-button";
import { computeProfitKpis, computeProfitSeries } from "@/lib/home-live";
import { getBucketPeriodWindow } from "@/lib/period-buckets";
import { useKrosConnections } from "@/lib/use-kros-connections";
import { usePreference } from "@/lib/use-preference";
import { applyCompanyFilter } from "@/lib/preferences/company-filter";
import { documentMatchesTagFilters } from "@/lib/tag-categories";
import { useSyncOrchestrator } from "@/lib/sync/use-sync-orchestrator";
import { invoiceEngine } from "@/lib/sync/invoice-engine";
import { expenseEngine } from "@/lib/sync/expense-engine";
import { cashflowEngine } from "@/lib/sync/cashflow-engine";

/**
 * Domov ťahá VŠETKY tri domény. Nie je to sťahovanie navyše: enginy sú tie isté,
 * aké používajú moduly, a `syncMeta` v IndexedDB je jediný zdroj pravdy o tom, čo
 * je hotové — čo dotiahne Domov, to už modul nesťahuje, a naopak.
 *
 * Pole je modulová konštanta, nie literál v tele komponentu: inak by sa efekt
 * orchestrátora spustil pri každom rendere odznova.
 */
const HOME_ENGINES = [invoiceEngine, expenseEngine, cashflowEngine];

/** Id pevných sekcií pre prepínač zobrazenia — prefix `section:` ako v ostatných moduloch. */
export const HOME_SECTIONS = {
  accounts: "section:accounts",
  receivables: "section:receivables",
  vat: "section:vat",
  companies: "section:companies"
} as const;

export default function HomePage() {
  const [granularity, setGranularity] = usePreference("ui.granularity");
  const [categoryFilters] = usePreference("home.tagFilters");
  const [selectedCompanies, setSelectedCompanies] = usePreference("home.companies");
  const [hiddenSections, setHiddenSections] = usePreference("ui.homeHiddenSections");
  const [focusedPeriod, setFocusedPeriod] = useState<string | null>(null);
  const [hasLoadedPersistedFilters, setHasLoadedPersistedFilters] = useState(false);
  const { connections, isLoading: isLoadingConnections } = useKrosConnections();

  useEffect(() => {
    setHasLoadedPersistedFilters(true);
  }, []);

  const companyFilter = useMemo(
    () => applyCompanyFilter(connections, selectedCompanies, (connection) => connection.companyName),
    [connections, selectedCompanies]
  );
  const syncConnections = companyFilter.companies;

  const {
    data: { invoices, expenses },
    isSyncing,
    hasResolvedFirstData,
    refresh
  } = useSyncOrchestrator(HOME_ENGINES, {
    connections,
    syncConnections,
    granularity,
    enabled: hasLoadedPersistedFilters
  });

  const scopedInvoices = useMemo(
    () => invoices.filter((invoice) => documentMatchesTagFilters(invoice.tags, categoryFilters)),
    [invoices, categoryFilters]
  );
  const scopedExpenses = useMemo(
    () => expenses.filter((expense) => documentMatchesTagFilters(expense.tags, categoryFilters)),
    [expenses, categoryFilters]
  );

  const points = useMemo(
    () =>
      computeProfitSeries({
        invoices: scopedInvoices,
        expenses: scopedExpenses,
        granularity,
        selectedTags: [],
        selectedCompanies
      }),
    [scopedInvoices, scopedExpenses, granularity, selectedCompanies]
  );

  const kpis = useMemo(() => computeProfitKpis(points, focusedPeriod), [points, focusedPeriod]);

  // Sekcie pod grafom sa počítajú v okne focusnutého stĺpca. Po prepnutí obdobia
  // (mesiace → týždne) focusnutý stĺpec zanikne — filter, ktorý sa nemá čoho držať,
  // patrí zahodiť, nie ho ticho nechať visieť.
  const periodWindow = useMemo(
    () => (focusedPeriod ? getBucketPeriodWindow(granularity, focusedPeriod) : null),
    [focusedPeriod, granularity]
  );
  useEffect(() => {
    if (focusedPeriod && !periodWindow) setFocusedPeriod(null);
  }, [focusedPeriod, periodWindow]);

  const sectionOptions = useMemo<VisibilityOption[]>(
    () => [
      { id: HOME_SECTIONS.receivables, label: "Pohľadávky a záväzky" },
      { id: HOME_SECTIONS.accounts, label: "Peniaze na účtoch" },
      { id: HOME_SECTIONS.vat, label: "Predpokladaný odhad DPH" },
      { id: HOME_SECTIONS.companies, label: "Zisk podľa firiem", filterCount: selectedCompanies.length }
    ],
    [selectedCompanies]
  );

  const hasLiveMode = connections.length > 0;
  const isPreparingModule = isLoadingConnections || !hasResolvedFirstData;

  return (
    <DashboardShell
      title="Domov"
      isSyncing={isSyncing}
      syncNote="Domov skladá čísla zo všetkých modulov, preto prvé načítanie trvá najdlhšie. Ostanú uložené v zariadení a moduly ich už nesťahujú znova."
      onRefresh={hasLiveMode ? refresh : undefined}
      categoryVisibility={{
        categoryOptions: [],
        sectionOptions,
        hiddenIds: hiddenSections,
        onHiddenIdsChange: setHiddenSections,
        granularity,
        onGranularityChange: setGranularity
      }}
    >
      {isPreparingModule ? <ModuleSkeleton label="Skladám prehľad…" /> : null}
      {isPreparingModule ? null : (
        <>
          {!hasLiveMode ? <DemoDataBanner /> : null}
          {companyFilter.noneAvailable ? (
            <FilterMismatchNotice onShowAll={() => setSelectedCompanies([])} />
          ) : null}
          <ProfitDashboard
            kpis={kpis}
            points={points}
            focusedPeriod={hasLiveMode ? focusedPeriod : null}
            onFocusedPeriodChange={hasLiveMode ? setFocusedPeriod : undefined}
          />
        </>
      )}
    </DashboardShell>
  );
}
