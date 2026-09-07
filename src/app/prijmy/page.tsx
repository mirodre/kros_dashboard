"use client";

import { useEffect, useMemo, useState } from "react";
import { DashboardShell } from "@/components/dashboard-shell";
import { ModuleSkeleton } from "@/components/module-skeleton";
import type { VisibilityOption } from "@/components/category-visibility-button";
import { DemoDataBanner } from "@/components/demo-data-banner";
import { FilterMismatchNotice } from "@/components/filter-mismatch-notice";
import { RevenueDashboard } from "@/components/revenue-dashboard";
import { CategorizedTagsDashboard } from "@/components/categorized-tags-dashboard";
import { RecentInvoicesSection } from "@/components/recent-invoices-section";
import { CompaniesDashboard } from "@/components/companies-dashboard";
import {
  getCompaniesBreakdown,
  getMockRecentInvoices,
  getRevenueChartPointsByTags,
  getTagsBreakdown
} from "@/lib/mock-data";
import {
  computeCompanyBreakdown,
  computeComparableYtdTotals,
  computeKpis,
  computeRevenueSeries,
  computeTagBreakdown,
  getFilteredRecentInvoices
} from "@/lib/dashboard-live";
import { getBucketPeriodWindow } from "@/lib/period-buckets";
import { useKrosConnections } from "@/lib/use-kros-connections";
import { useTagCategoryIndex } from "@/lib/use-tag-categories";
import { applyCompanyFilter } from "@/lib/preferences/company-filter";
import { usePreference } from "@/lib/use-preference";
import {
  categoryForTag,
  documentMatchesTagFilters,
  hasRealCategories,
  isTagAllowedByFilters,
  migrateFlatFiltersToCategories,
  sortTagCategories,
  type TagCategoryFilters
} from "@/lib/tag-categories";
import { invoiceEngine } from "@/lib/sync/invoice-engine";
import { useSyncOrchestrator } from "@/lib/sync/use-sync-orchestrator";

/**
 * Id pevných sekcií pre prepínač zobrazenia. Prefix `section:` ich odlišuje od kategórií
 * štítkov, ktoré v tom istom zozname vystupujú pod svojím názvom.
 */
const REVENUE_SECTIONS = {
  recentInvoices: "section:recentInvoices",
  companies: "section:companies"
} as const;

/**
 * Engine array musí byť modulová konštanta, nie literál v tele komponentu —
 * inak sa efekt v orchestrátore spustí pri každom rendere odznova.
 */
const REVENUE_ENGINES = [invoiceEngine];

export default function PrijmyPage() {
  // Nastavenia žijú v spoločnom store (server + `localStorage` ako cache), nie v stave
  // stránky: to je celý zmysel tejto fázy — filtre nasledujú človeka na iné zariadenie.
  const [granularity, setGranularity] = usePreference("ui.granularity");
  const [categoryFilters, setCategoryFilters] = usePreference("revenue.tagFilters");
  const [focusedTag, setFocusedTag] = useState<string | null>(null);
  const [selectedCompanies, setSelectedCompanies] = usePreference("revenue.companies");
  const [hiddenSections, setHiddenSections] = usePreference("ui.revenueHiddenSections");
  const [focusedCompany, setFocusedCompany] = useState<string | null>(null);
  // Stĺpec grafu, na ktorý sa kliklo. Drill-down ako focus štítku či firmy, preto tiež
  // nie je uložený filter — po návrate do modulu má byť vidieť celý rok, nie jeden mesiac.
  const [focusedPeriod, setFocusedPeriod] = useState<string | null>(null);
  // Prepojenia sú firemné a žijú na serveri — na novom zariadení už netreba nič preklikávať.
  const { connections, isLoading: isLoadingConnections } = useKrosConnections();
  const [hasLoadedPersistedFilters, setHasLoadedPersistedFilters] = useState(false);
  const [tagRefreshNonce, setTagRefreshNonce] = useState(0);

  const effectiveCompanies = useMemo(
    () => (focusedCompany ? [focusedCompany] : selectedCompanies),
    [focusedCompany, selectedCompanies]
  );
  // Uložený filter sa aplikuje ako prienik s prepojenými firmami; `noneAvailable` znamená,
  // že sem filter z iného zariadenia nesedí — a to sa musí povedať, nie ukázať ako nulu.
  const companyFilter = useMemo(
    () => applyCompanyFilter(connections, selectedCompanies, (connection) => connection.companyName),
    [connections, selectedCompanies]
  );
  const syncConnections = companyFilter.companies;

  const {
    data: { invoices: liveInvoices },
    isSyncing: isLoadingLiveData,
    hasResolvedFirstData,
    refresh
  } = useSyncOrchestrator(REVENUE_ENGINES, {
    connections,
    syncConnections,
    granularity,
    enabled: hasLoadedPersistedFilters
  });

  const handleRefresh = () => {
    setTagRefreshNonce((value) => value + 1);
    refresh();
  };

  // Prvý render beží ešte pred pripojením k store-u (server snapshot = defaulty), takže sa
  // sťahovanie odkladá o jeden tik. Bez toho by prvý fetch šiel s prázdnym filtrom a hneď
  // za ním druhý so skutočným.
  useEffect(() => {
    setHasLoadedPersistedFilters(true);
  }, []);

  const hasLiveMode = connections.length > 0;
  // Sekcie pod grafom sa počítajú v okne focusnutého stĺpca: tento rok ten stĺpec, vlani
  // to isté obdobie. Bez focusu ostáva pôvodné okno „tento rok vs. vlani" (YTD).
  const periodWindow = useMemo(
    () => (focusedPeriod ? getBucketPeriodWindow(granularity, focusedPeriod) : null),
    [focusedPeriod, granularity]
  );

  // Po prepnutí obdobia (mesiace → týždne) focusnutý stĺpec zanikne — filter, ktorý sa
  // nemá čoho držať, patrí zahodiť, nie ho ticho nechať visieť na odznaku.
  useEffect(() => {
    if (focusedPeriod && !periodWindow) setFocusedPeriod(null);
  }, [focusedPeriod, periodWindow]);

  // Prechod na modul má ukázať loader, nie demo čísla, ktoré o chvíľu prepíšu tie skutočné.
  const isPreparingModule = isLoadingConnections || !hasResolvedFirstData;
  const tagCategoryIndex = useTagCategoryIndex(connections, tagRefreshNonce);

  useEffect(() => {
    const migrated = migrateFlatFiltersToCategories(categoryFilters, tagCategoryIndex);
    // Porovnanie referencie stačí: `migrateFlatFiltersToCategories` vracia pôvodný objekt,
    // keď nie je čo prerobiť. Bez tejto podmienky by zápis spustil efekt znova dokola.
    if (migrated !== categoryFilters) setCategoryFilters(migrated);
  }, [tagCategoryIndex, categoryFilters, setCategoryFilters]);

  const filterScopedInvoices = useMemo(
    () =>
      liveInvoices.filter((invoice) =>
        documentMatchesTagFilters(invoice.tags, categoryFilters)
      ),
    [liveInvoices, categoryFilters]
  );

  // Fokus štítku prispôsobí graf/KPI/doklady, ale zoznamy kategórií ostávajú podľa Filtra štítkov.
  const tagScopedInvoices = useMemo(
    () =>
      liveInvoices.filter((invoice) =>
        documentMatchesTagFilters(invoice.tags, categoryFilters, focusedTag ? [focusedTag] : [])
      ),
    [liveInvoices, categoryFilters, focusedTag]
  );

  const revenueData = useMemo(() => {
    if (hasLiveMode) {
      return computeRevenueSeries({
        invoices: tagScopedInvoices,
        granularity,
        selectedTags: [],
        selectedCompanies: effectiveCompanies
      });
    }
    return getRevenueChartPointsByTags(granularity, [], effectiveCompanies);
  }, [hasLiveMode, tagScopedInvoices, granularity, effectiveCompanies]);

  const ytdTotals = useMemo(() => {
    if (!hasLiveMode) return undefined;
    return computeComparableYtdTotals({
      invoices: tagScopedInvoices,
      selectedTags: [],
      selectedCompanies: effectiveCompanies
    });
  }, [hasLiveMode, tagScopedInvoices, effectiveCompanies]);

  const kpis = useMemo(
    () => computeKpis(revenueData, ytdTotals, hasLiveMode ? focusedPeriod : null),
    [revenueData, ytdTotals, hasLiveMode, focusedPeriod]
  );

  const availableTagsData = useMemo(() => {
    const points = hasLiveMode
      ? computeTagBreakdown(liveInvoices, effectiveCompanies)
      : getTagsBreakdown(granularity);
    return [...points].sort((a, b) => b.amount - a.amount);
  }, [hasLiveMode, liveInvoices, effectiveCompanies, granularity]);

  // Zoznam pre prepínač v hlavičke: kategórie zo VŠETKÝCH štítkov, nie z tých po filtri —
  // inak by vypnutá kategória z prepínača zmizla a nedalo by sa ju vrátiť. Skrytie
  // kategórie jej filter nezruší, takže prepínač zároveň ukazuje, kde filter visí.
  const categoryOptions = useMemo<VisibilityOption[]>(() => {
    if (!hasRealCategories(tagCategoryIndex)) return [];
    const categories = new Set(
      availableTagsData.map((point) => categoryForTag(tagCategoryIndex, point.name))
    );
    return sortTagCategories(Array.from(categories)).map((category) => ({
      id: category,
      label: category,
      filterCount: categoryFilters[category]?.length ?? 0
    }));
  }, [availableTagsData, tagCategoryIndex, categoryFilters]);

  const sectionOptions = useMemo<VisibilityOption[]>(
    () => [
      { id: REVENUE_SECTIONS.recentInvoices, label: "Posledné faktúry" },
      {
        id: REVENUE_SECTIONS.companies,
        label: "Tržby podľa firiem",
        filterCount: selectedCompanies.length
      }
    ],
    [selectedCompanies]
  );

  const isSectionHidden = (id: string) => hiddenSections.includes(id);

  const tagsData = useMemo(() => {
    const filterPoints = hasLiveMode
      ? computeTagBreakdown(filterScopedInvoices, effectiveCompanies, periodWindow ?? undefined)
      : getTagsBreakdown(granularity);
    const focusPoints = hasLiveMode
      ? computeTagBreakdown(tagScopedInvoices, effectiveCompanies, periodWindow ?? undefined)
      : filterPoints;

    const allowedFilter = filterPoints.filter((point) =>
      isTagAllowedByFilters(point.name, categoryFilters, tagCategoryIndex)
    );
    if (!focusedTag) {
      return [...allowedFilter].sort((a, b) => b.amount - a.amount);
    }

    // V kategórii focusnutého štítku ostávajú sumy podľa Filtra štítkov;
    // ostatné kategórie sa prepočítajú podľa focusnutého štítku.
    const focusedCategory = categoryForTag(tagCategoryIndex, focusedTag);
    const focusByName = new Map(focusPoints.map((point) => [point.name, point]));
    const merged = allowedFilter.flatMap((point) => {
      const category = categoryForTag(tagCategoryIndex, point.name);
      if (category === focusedCategory) return [point];
      const focusedPoint = focusByName.get(point.name);
      return focusedPoint ? [focusedPoint] : [];
    });
    return merged.sort((a, b) => b.amount - a.amount);
  }, [
    hasLiveMode,
    filterScopedInvoices,
    tagScopedInvoices,
    effectiveCompanies,
    granularity,
    categoryFilters,
    tagCategoryIndex,
    focusedTag,
    periodWindow
  ]);

  const companiesData = useMemo(() => {
    // Zoznam firiem sa nezužuje focusom — rovnako ako štítky v kategórii.
    // Focus ovplyvní graf/KPI cez effectiveCompanies.
    if (hasLiveMode) {
      return computeCompanyBreakdown(
        tagScopedInvoices,
        [],
        selectedCompanies,
        periodWindow ?? undefined
      );
    }
    const all = getCompaniesBreakdown(granularity);
    if (selectedCompanies.length === 0) return all;
    return all.filter((company) => selectedCompanies.includes(company.name));
  }, [hasLiveMode, tagScopedInvoices, selectedCompanies, granularity, periodWindow]);

  const recentInvoices = useMemo(() => {
    const source = hasLiveMode ? tagScopedInvoices : getMockRecentInvoices();
    return getFilteredRecentInvoices(source, {
      granularity,
      selectedTags: [],
      selectedCompanies: effectiveCompanies,
      limit: 10,
      period: periodWindow ?? undefined
    });
  }, [hasLiveMode, tagScopedInvoices, granularity, effectiveCompanies, periodWindow]);

  const handleCategoryFiltersChange = (next: TagCategoryFilters) => {
    setCategoryFilters(next);
    if (focusedTag && !isTagAllowedByFilters(focusedTag, next, tagCategoryIndex)) {
      setFocusedTag(null);
    }
  };

  const updateSelectionWithFocusedGuard = (
    nextSelection: string[],
    focusedValue: string | null,
    setSelection: (value: string[]) => void,
    setFocused: (value: string | null) => void
  ) => {
    setSelection(nextSelection);
    if (focusedValue && !nextSelection.includes(focusedValue)) {
      setFocused(null);
    }
  };

  return (
    <DashboardShell
      isSyncing={isLoadingLiveData}
      syncNote="Faktúry ťaháme po mesiacoch, preto prvé načítanie trvá dlhšie. Ostanú uložené v zariadení — pri ďalšom otvorení sa dosynchronizujú len zmeny."
      onRefresh={connections.length > 0 ? handleRefresh : undefined}
      categoryVisibility={{
        categoryOptions,
        sectionOptions,
        hiddenIds: hiddenSections,
        onHiddenIdsChange: setHiddenSections,
        granularity,
        onGranularityChange: setGranularity
      }}
    >
      {isPreparingModule ? <ModuleSkeleton label="Načítavam tržby…" /> : null}
      {isPreparingModule ? null : (
        <>
      {!hasLiveMode && !isLoadingConnections ? <DemoDataBanner /> : null}
      {companyFilter.noneAvailable ? <FilterMismatchNotice onShowAll={() => setSelectedCompanies([])} /> : null}
      <RevenueDashboard
        granularity={granularity}
        kpis={kpis}
        points={revenueData}
        invoices={tagScopedInvoices}
        selectedTags={[]}
        selectedCompanies={effectiveCompanies}
        onClearTagFilter={() => setFocusedTag(null)}
        activeTagLabel={focusedTag ?? undefined}
        onClearCompanyFilter={() => setFocusedCompany(null)}
        activeCompanyLabel={focusedCompany ?? undefined}
        // Demo breakdowny sú hotové súčty bez dokladov, filter obdobia by v nich nemal
        // čo prepočítať — v demo režime preto klik na stĺpec sekcie nezužuje.
        focusedPeriod={hasLiveMode ? focusedPeriod : null}
        onFocusedPeriodChange={hasLiveMode ? setFocusedPeriod : undefined}
      />
      <CategorizedTagsDashboard
        tags={tagsData}
        availableTags={availableTagsData}
        categoryIndex={tagCategoryIndex}
        categoryFilters={categoryFilters}
        hiddenCategories={hiddenSections}
        focusedTags={focusedTag ? [focusedTag] : []}
        onCategoryFiltersChange={handleCategoryFiltersChange}
        // Tržby ostávajú na jednom focusnutom štítku — z klikov berieme ten posledný.
        onFocusedTagsChange={(tags) => setFocusedTag(tags[tags.length - 1] ?? null)}
      />
      {isSectionHidden(REVENUE_SECTIONS.recentInvoices) ? null : (
        <RecentInvoicesSection invoices={recentInvoices} />
      )}
      {isSectionHidden(REVENUE_SECTIONS.companies) ? null : (
      <CompaniesDashboard
        companies={companiesData}
        selectedCompanies={selectedCompanies}
        availableCompanyNames={connections.map((connection) => connection.companyName)}
        focusedCompany={focusedCompany}
        onSelectionChange={(companies) =>
          updateSelectionWithFocusedGuard(
            companies,
            focusedCompany,
            setSelectedCompanies,
            setFocusedCompany
          )
        }
        onFocusedCompanyChange={setFocusedCompany}
      />
      )}
        </>
      )}
    </DashboardShell>
  );
}
