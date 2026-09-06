"use client";

import { useEffect, useMemo, useState } from "react";
import { DashboardShell } from "@/components/dashboard-shell";
import { ModuleSkeleton } from "@/components/module-skeleton";
import { DemoDataBanner } from "@/components/demo-data-banner";
import { FilterMismatchNotice } from "@/components/filter-mismatch-notice";
import { ProfitDashboard } from "@/components/profit-dashboard";
import { HomeAccountsCard } from "@/components/home-accounts-card";
import { HomeDueCard } from "@/components/home-due-card";
import type { VisibilityOption } from "@/components/category-visibility-button";
import { computeDuePositions, computeProfitKpis, computeProfitSeries } from "@/lib/home-live";
import { computeCashflowOverviewFromLiveData } from "@/lib/cashflow-live";
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
    data: { invoices, expenses, accounts: cashflowAccounts, transactions },
    isSyncing,
    hasResolvedFirstData,
    refresh
  } = useSyncOrchestrator(HOME_ENGINES, {
    connections,
    syncConnections,
    granularity,
    enabled: hasLoadedPersistedFilters
  });

  // Id-čka len ZVOLENÝCH firiem, nie všetkých synchronizovaných — pozri komentár pri
  // rovnomennom parametri v `computeCashflowOverviewFromLiveData`: keby sem šli všetky
  // firmy, rozkliknutý filter by účty vôbec nezúžil.
  const selectedCompanyIds = useMemo(() => {
    if (selectedCompanies.length === 0) return [];
    const selected = new Set(selectedCompanies);
    return connections
      .filter((connection) => selected.has(connection.companyName))
      .map((connection) => connection.companyId);
  }, [selectedCompanies, connections]);

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

  // Neuhradené doklady k dnešku. Zámerne BEZ `periodWindow` — dlžoba nezaniká tým,
  // že vznikla vlani, a zúžiť ju na jeden stĺpec grafu by dalo číslo, ktoré nikoho
  // nezaujíma.
  const duePositions = useMemo(
    () =>
      computeDuePositions({
        invoices: scopedInvoices,
        expenses: scopedExpenses,
        selectedTags: [],
        selectedCompanies
      }),
    [scopedInvoices, scopedExpenses, selectedCompanies]
  );

  // Účty sú stav k dnešku, nie tok za obdobie: granularita sem ide len preto, že ju
  // prehľad Financií vyžaduje na svoje vlastné série, ktoré Domov nepoužíva. Focus
  // stĺpca sa sem zámerne neposiela — karta ho ignoruje, nie sledovanie s omeškaním.
  const accounts = useMemo(
    () =>
      computeCashflowOverviewFromLiveData({
        accounts: cashflowAccounts,
        transactions,
        granularity,
        selectedCompanies,
        selectedCompanyIds
      }).accountBreakdown,
    [cashflowAccounts, transactions, granularity, selectedCompanies, selectedCompanyIds]
  );

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
          {hiddenSections.includes(HOME_SECTIONS.receivables) ? null : (
            <HomeDueCard positions={duePositions} isPeriodFocused={Boolean(focusedPeriod)} />
          )}
          {hiddenSections.includes(HOME_SECTIONS.accounts) ? null : (
            <HomeAccountsCard accounts={accounts} isPeriodFocused={Boolean(focusedPeriod)} />
          )}
        </>
      )}
    </DashboardShell>
  );
}
