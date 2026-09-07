"use client";

import { useEffect, useMemo, useState } from "react";
import { DashboardShell } from "@/components/dashboard-shell";
import { ModuleSkeleton } from "@/components/module-skeleton";
import { DemoDataBanner } from "@/components/demo-data-banner";
import { FilterMismatchNotice } from "@/components/filter-mismatch-notice";
import { ProfitDashboard } from "@/components/profit-dashboard";
import { HomeAccountsCard } from "@/components/home-accounts-card";
import { HomeDueCard } from "@/components/home-due-card";
import { HomeVatCard } from "@/components/home-vat-card";
import type { VisibilityOption } from "@/components/category-visibility-button";
import { CategorizedTagsDashboard } from "@/components/categorized-tags-dashboard";
import { CompaniesDashboard } from "@/components/companies-dashboard";
import {
  computeDuePositions,
  computeProfitCompanyBreakdown,
  computeProfitKpis,
  computeProfitSeries,
  computeProfitTagBreakdown,
  computeVatEstimate
} from "@/lib/home-live";
import { scopeExpenseAmountsToTagFilters } from "@/lib/expenses-live";
import { computeCashflowOverviewFromLiveData } from "@/lib/cashflow-live";
import { formatCurrency } from "@/lib/format";
import { getBucketPeriodWindow } from "@/lib/period-buckets";
import { useKrosConnections } from "@/lib/use-kros-connections";
import { useTagCategoryIndex } from "@/lib/use-tag-categories";
import { usePreference } from "@/lib/use-preference";
import { applyCompanyFilter } from "@/lib/preferences/company-filter";
import {
  categoryForTag,
  documentMatchesTagFilters,
  hasRealCategories,
  isTagAllowedByFilters,
  sortTagCategories,
  type TagCategoryFilters
} from "@/lib/tag-categories";
import { useSyncOrchestrator } from "@/lib/sync/use-sync-orchestrator";
import { invoiceEngine } from "@/lib/sync/invoice-engine";
import { expenseEngine } from "@/lib/sync/expense-engine";
import { cashflowEngine } from "@/lib/sync/cashflow-engine";
import { getHomeMockData } from "@/lib/home-mock-data";

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
const HOME_SECTIONS = {
  accounts: "section:accounts",
  receivables: "section:receivables",
  vat: "section:vat",
  companies: "section:companies"
} as const;

export default function HomePage() {
  const [granularity, setGranularity] = usePreference("ui.granularity");
  const [categoryFilters, setCategoryFilters] = usePreference("home.tagFilters");
  const [selectedCompanies, setSelectedCompanies] = usePreference("home.companies");
  const [hiddenSections, setHiddenSections] = usePreference("ui.homeHiddenSections");
  const [focusedPeriod, setFocusedPeriod] = useState<string | null>(null);
  const [focusedTag, setFocusedTag] = useState<string | null>(null);
  const [focusedCompany, setFocusedCompany] = useState<string | null>(null);
  const [hasLoadedPersistedFilters, setHasLoadedPersistedFilters] = useState(false);
  const [tagRefreshNonce, setTagRefreshNonce] = useState(0);
  const { connections, isLoading: isLoadingConnections } = useKrosConnections();
  const tagCategoryIndex = useTagCategoryIndex(connections, tagRefreshNonce);

  useEffect(() => {
    setHasLoadedPersistedFilters(true);
  }, []);

  const companyFilter = useMemo(
    () => applyCompanyFilter(connections, selectedCompanies, (connection) => connection.companyName),
    [connections, selectedCompanies]
  );
  const syncConnections = companyFilter.companies;

  const {
    data: {
      invoices: liveInvoices,
      expenses: liveExpenses,
      accounts: liveAccounts,
      transactions: liveTransactions
    },
    isSyncing,
    hasResolvedFirstData,
    refresh
  } = useSyncOrchestrator(HOME_ENGINES, {
    connections,
    syncConnections,
    granularity,
    enabled: hasLoadedPersistedFilters
  });

  const hasLiveMode = connections.length > 0;
  // Bez prepojenia ide demo tými istými funkciami ako živé dáta — nie vlastnou
  // vetvou výpočtov, ktorá by sa časom rozišla s tou skutočnou.
  const demoData = useMemo(() => (hasLiveMode ? null : getHomeMockData()), [hasLiveMode]);
  const invoices = demoData?.invoices ?? liveInvoices;
  const expenses = demoData?.expenses ?? liveExpenses;
  const cashflowAccounts = demoData?.accounts ?? liveAccounts;
  const transactions = demoData?.transactions ?? liveTransactions;

  const handleRefresh = () => {
    setTagRefreshNonce((value) => value + 1);
    refresh();
  };

  // Rozklik firmy zúži graf a KPI, ale nie zoznam firiem — rovnako ako v moduloch.
  const effectiveCompanies = useMemo(
    () => (focusedCompany ? [focusedCompany] : selectedCompanies),
    [focusedCompany, selectedCompanies]
  );

  // Id-čka len EFEKTÍVNE zvolených firiem (po focuse), nie všetkých synchronizovaných —
  // pozri komentár pri rovnomennom parametri v `computeCashflowOverviewFromLiveData`: keby
  // sem šli mená aj id-čka z rôznych množín, rozkliknutá firma by účty cez id nezúžila.
  const selectedCompanyIds = useMemo(() => {
    if (effectiveCompanies.length === 0) return [];
    const selected = new Set(effectiveCompanies);
    return connections
      .filter((connection) => selected.has(connection.companyName))
      .map((connection) => connection.companyId);
  }, [effectiveCompanies, connections]);

  // Štyri rozsahy dokladov, každý na iný účel:
  // 1) `invoices`/`expenses` (zo synchronizácie) — úplne neodfiltrované, použité nižšie pre
  //    `availableTagPoints`/`categoryOptions` a pre DPH, kde filter štítkov neplatí.
  // 2) `filterScopedInvoices`/`filterScopedExpenses` — len podľa Filtra štítkov, BEZ focusu.
  //    Vstup pre kategóriu focusnutého štítku v zozname nižšie: tá sa focusom nesmie zúžiť.
  // 3) `tagScopedInvoices`/`tagScopedExpenses` — Filter štítkov AJ focus, CELÉ sumy dokladov
  //    (bez rozúčtovania). Toto je rozsah pre pohľadávky a záväzky: dodávateľovi dlžíš celú
  //    faktúru bez ohľadu na to, ako si si ju interne rozúčtoval na štítky.
  // 4) `flowScopedExpenses` — to isté doklady ako v (3), ale sumy zúžené na rozúčtovanie
  //    patriace vybraným štítkom (`scopeExpenseAmountsToTagFilters`), presne ako v module
  //    Výdavky. Toto je rozsah pre TOK — graf zisku, KPI a zisk podľa firiem. Bez neho by
  //    faktúra rozúčtovaná na dva štítky prispela grafu CELOU sumou, kým „Zisk podľa štítkov"
  //    pod ním len jej alikvotnou časťou — obe sekcie by o tom istom eure klamali inak.
  const filterScopedInvoices = useMemo(
    () => invoices.filter((invoice) => documentMatchesTagFilters(invoice.tags, categoryFilters)),
    [invoices, categoryFilters]
  );
  const filterScopedExpenses = useMemo(
    () => expenses.filter((expense) => documentMatchesTagFilters(expense.tags, categoryFilters)),
    [expenses, categoryFilters]
  );
  const tagScopedInvoices = useMemo(
    () =>
      invoices.filter((invoice) =>
        documentMatchesTagFilters(invoice.tags, categoryFilters, focusedTag ? [focusedTag] : [])
      ),
    [invoices, categoryFilters, focusedTag]
  );
  const tagScopedExpenses = useMemo(
    () =>
      expenses.filter((expense) =>
        documentMatchesTagFilters(expense.tags, categoryFilters, focusedTag ? [focusedTag] : [])
      ),
    [expenses, categoryFilters, focusedTag]
  );
  const flowScopedExpenses = useMemo(
    () =>
      scopeExpenseAmountsToTagFilters(tagScopedExpenses, categoryFilters, focusedTag ? [focusedTag] : []),
    [tagScopedExpenses, categoryFilters, focusedTag]
  );

  const points = useMemo(
    () =>
      computeProfitSeries({
        invoices: tagScopedInvoices,
        expenses: flowScopedExpenses,
        granularity,
        selectedTags: [],
        selectedCompanies: effectiveCompanies
      }),
    [tagScopedInvoices, flowScopedExpenses, granularity, effectiveCompanies]
  );

  const kpis = useMemo(() => computeProfitKpis(points, focusedPeriod), [points, focusedPeriod]);

  // Neuhradené doklady k dnešku. Zámerne BEZ `periodWindow` — dlžoba nezaniká tým,
  // že vznikla vlani, a zúžiť ju na jeden stĺpec grafu by dalo číslo, ktoré nikoho
  // nezaujíma. Zámerne aj BEZ rozúčtovania (`tagScopedExpenses`, nie `flowScopedExpenses`) —
  // dodávateľovi dlžíš celú faktúru bez ohľadu na to, ako si si ju interne rozúčtoval.
  const duePositions = useMemo(
    () =>
      computeDuePositions({
        invoices: tagScopedInvoices,
        expenses: tagScopedExpenses,
        selectedTags: [],
        selectedCompanies: effectiveCompanies
      }),
    [tagScopedInvoices, tagScopedExpenses, effectiveCompanies]
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

  // Rozpis zisku podľa Filtra štítkov (bez focusu) — vstup pre kategóriu focusnutého
  // štítku, ktorá sa focusom nesmie zúžiť.
  const filterTagPoints = useMemo(
    () =>
      computeProfitTagBreakdown({
        invoices: filterScopedInvoices,
        expenses: filterScopedExpenses,
        selectedCompanies: effectiveCompanies,
        period: periodWindow ?? undefined
      }),
    [filterScopedInvoices, filterScopedExpenses, effectiveCompanies, periodWindow]
  );

  // Rozpis zisku zúžený aj o focusnutý štítok — vstup pre OSTATNÉ kategórie zoznamu.
  const focusTagPoints = useMemo(
    () =>
      computeProfitTagBreakdown({
        invoices: tagScopedInvoices,
        expenses: tagScopedExpenses,
        selectedCompanies: effectiveCompanies,
        period: periodWindow ?? undefined
      }),
    [tagScopedInvoices, tagScopedExpenses, effectiveCompanies, periodWindow]
  );

  /**
   * Zoznam pre kartu „Zisk podľa štítkov": v kategórii focusnutého štítku ostávajú sumy
   * podľa Filtra štítkov (bez zúženia focusom), ostatné kategórie sa prepočítajú podľa
   * focusnutého štítku — rovnaký princíp ako `tagsData` v Príjmoch/Výdavkoch, len namiesto
   * jednej sumy nesie riadok príjem aj výdavok (`ProfitBreakdownPoint`), preto sa spája
   * priamo tu a nie cez `computeProfitTagBreakdown`.
   */
  const tagPoints = useMemo(() => {
    const allowedFilter = filterTagPoints.filter((point) =>
      isTagAllowedByFilters(point.name, categoryFilters, tagCategoryIndex)
    );
    if (!focusedTag) {
      return [...allowedFilter].sort((a, b) => b.profit - a.profit);
    }

    const focusedCategory = categoryForTag(tagCategoryIndex, focusedTag);
    const focusByName = new Map(focusTagPoints.map((point) => [point.name, point]));
    const merged = allowedFilter.flatMap((point) => {
      const category = categoryForTag(tagCategoryIndex, point.name);
      if (category === focusedCategory) return [point];
      const focusedPoint = focusByName.get(point.name);
      return focusedPoint ? [focusedPoint] : [];
    });
    return merged.sort((a, b) => b.profit - a.profit);
  }, [filterTagPoints, focusTagPoints, categoryFilters, tagCategoryIndex, focusedTag]);

  const companyPoints = useMemo(
    () =>
      computeProfitCompanyBreakdown({
        invoices: tagScopedInvoices,
        expenses: flowScopedExpenses,
        selectedTags: [],
        selectedCompanies,
        period: periodWindow ?? undefined
      }),
    [tagScopedInvoices, flowScopedExpenses, selectedCompanies, periodWindow]
  );

  /** Zisk štítku ako bod rozpisu — `CategorizedTagsDashboard` číta `amount`. */
  const tagBreakdownPoints = useMemo(
    () =>
      tagPoints.map((point) => ({
        name: point.name,
        amount: point.profit,
        previousAmount: point.previousProfit
      })),
    [tagPoints]
  );

  // Neodfiltrovaný rozpis (bez `categoryFilters` aj bez focusu) pre dialóg filtra a pre
  // `categoryOptions` — rovnako ako `availableTagsData` v Príjmoch/Výdavkoch: kategória či
  // štítok, ktorý filter práve vyprázdnil, tu musí zostať vidieť, inak by sa nedali vrátiť.
  const availableTagPoints = useMemo(
    () =>
      computeProfitTagBreakdown({
        invoices,
        expenses,
        selectedCompanies: effectiveCompanies
      }),
    [invoices, expenses, effectiveCompanies]
  );

  const availableTagBreakdownPoints = useMemo(
    () =>
      availableTagPoints.map((point) => ({
        name: point.name,
        amount: point.profit,
        previousAmount: point.previousProfit
      })),
    [availableTagPoints]
  );

  /** Zložky zisku podľa štítku — pre doplnkový riadok pod sumou. */
  const tagPartsByName = useMemo(
    () => new Map(tagPoints.map((point) => [point.name, point])),
    [tagPoints]
  );

  // Kalendárne mesiace vždy — bez ohľadu na prepínač obdobia. DPH sa podáva po
  // mesiacoch a po týždňoch alebo rokoch je to číslo nezmysel. Zámerne `invoices`
  // a `expenses`, nie `tagScopedInvoices`/`tagScopedExpenses` — filter štítkov sa na DPH
  // neaplikuje, daň sa priraďuje dokladu ako celku. Firmu naopak rozklikom zúžiť ísť má —
  // `effectiveCompanies`, nie `selectedCompanies` — rovnako ako pohľadávky/záväzky a účty
  // pod tým istým rozkliknutím: tri karty rovnakého druhu musia mať rovnaké správanie.
  const vatEstimate = useMemo(
    () =>
      computeVatEstimate({
        invoices,
        expenses,
        selectedCompanies: effectiveCompanies
      }),
    [invoices, expenses, effectiveCompanies]
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
        selectedCompanies: effectiveCompanies,
        selectedCompanyIds
      }).accountBreakdown,
    [cashflowAccounts, transactions, granularity, effectiveCompanies, selectedCompanyIds]
  );

  const handleCategoryFiltersChange = (next: TagCategoryFilters) => {
    setCategoryFilters(next);
    // Rozkliknutý štítok, ktorý filter práve vylúčil, by ostal visieť na odznaku
    // a zužoval čísla, hoci ho v zozname už nevidno.
    if (focusedTag && !isTagAllowedByFilters(focusedTag, next, tagCategoryIndex)) {
      setFocusedTag(null);
    }
  };

  // Zoznam pre prepínač v hlavičke: kategórie zo VŠETKÝCH štítkov, nie z tých po filtri —
  // inak by vypnutá kategória z prepínača zmizla a nedalo by sa ju vrátiť.
  const categoryOptions = useMemo<VisibilityOption[]>(() => {
    if (!hasRealCategories(tagCategoryIndex)) return [];
    const categories = new Set(
      availableTagPoints.map((point) => categoryForTag(tagCategoryIndex, point.name))
    );
    return sortTagCategories(Array.from(categories)).map((category) => ({
      id: category,
      label: category,
      filterCount: categoryFilters[category]?.length ?? 0
    }));
  }, [availableTagPoints, tagCategoryIndex, categoryFilters]);

  const sectionOptions = useMemo<VisibilityOption[]>(
    () => [
      { id: HOME_SECTIONS.receivables, label: "Pohľadávky a záväzky" },
      { id: HOME_SECTIONS.accounts, label: "Peniaze na účtoch" },
      { id: HOME_SECTIONS.vat, label: "Predpokladaný odhad DPH" },
      { id: HOME_SECTIONS.companies, label: "Zisk podľa firiem", filterCount: selectedCompanies.length }
    ],
    [selectedCompanies]
  );

  const isPreparingModule = isLoadingConnections || !hasResolvedFirstData;

  return (
    <DashboardShell
      title="Domov"
      isSyncing={isSyncing}
      syncNote="Domov skladá čísla zo všetkých modulov, preto prvé načítanie trvá najdlhšie. Ostanú uložené v zariadení a moduly ich už nesťahujú znova."
      onRefresh={hasLiveMode ? handleRefresh : undefined}
      categoryVisibility={{
        categoryOptions,
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
          {/*
            Na rozdiel od ostatných modulov demo Domova nesie doklady, nie hotové
            súčty — klik do grafu má teda z čoho prepočítať aj v demo režime, preto
            tu (na rozdiel od `hasLiveMode` gate v Príjmoch/Výdavkoch) focus nie je
            viazaný na `hasLiveMode`.
          */}
          <ProfitDashboard
            kpis={kpis}
            points={points}
            focusedPeriod={focusedPeriod}
            onFocusedPeriodChange={setFocusedPeriod}
          />
          {hiddenSections.includes(HOME_SECTIONS.receivables) ? null : (
            <HomeDueCard positions={duePositions} isPeriodFocused={Boolean(focusedPeriod)} />
          )}
          {hiddenSections.includes(HOME_SECTIONS.accounts) ? null : (
            <HomeAccountsCard accounts={accounts} isPeriodFocused={Boolean(focusedPeriod)} />
          )}
          {hiddenSections.includes(HOME_SECTIONS.vat) ? null : (
            <HomeVatCard estimate={vatEstimate} isPeriodFocused={Boolean(focusedPeriod)} />
          )}
          <CategorizedTagsDashboard
            baseTitle="Zisk podľa štítkov"
            ariaLabelPrefix="Filtrovať prehľad podľa štítku"
            tags={tagBreakdownPoints}
            availableTags={availableTagBreakdownPoints}
            categoryIndex={tagCategoryIndex}
            categoryFilters={categoryFilters}
            hiddenCategories={hiddenSections}
            focusedTags={focusedTag ? [focusedTag] : []}
            onCategoryFiltersChange={handleCategoryFiltersChange}
            // Zisk ostáva na jednom rozkliknutom štítku — z klikov berieme posledný.
            onFocusedTagsChange={(tags) => setFocusedTag(tags[tags.length - 1] ?? null)}
            renderMeta={(item) => {
              const parts = tagPartsByName.get(item.name);
              if (!parts) return null;
              return `${formatCurrency(parts.income)} − ${formatCurrency(parts.expense)}`;
            }}
          />
          {/*
            Príjmová a výdavková strana priraďujú štítky rôzne: faktúra s viacerými
            štítkami sa započíta celá do každého z nich, výdavok sa rozdelí podľa
            rozúčtovania. Súčet riadkov preto nedá celkový zisk. Vetu, ktorá to
            hovorila pod zoznamom, si používateľ vyžiadal zmazať — nepresnosť tým
            nezmizla, len sa už nepomenúva na obrazovke.
          */}

          {hiddenSections.includes(HOME_SECTIONS.companies) ? null : (
            <CompaniesDashboard
              title="Zisk podľa firiem"
              companies={companyPoints.map((point) => ({
                name: point.name,
                amount: point.profit,
                previousAmount: point.previousProfit
              }))}
              selectedCompanies={selectedCompanies}
              availableCompanyNames={connections.map((connection) => connection.companyName)}
              focusedCompany={focusedCompany}
              onSelectionChange={(companies) => {
                setSelectedCompanies(companies);
                if (focusedCompany && !companies.includes(focusedCompany)) setFocusedCompany(null);
              }}
              onFocusedCompanyChange={setFocusedCompany}
              collapsedKey="ui.collapsed.homeCompanies"
            />
          )}
        </>
      )}
    </DashboardShell>
  );
}
