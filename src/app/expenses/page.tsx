"use client";

import { useEffect, useMemo, useState } from "react";
import { DashboardShell } from "@/components/dashboard-shell";
import { ModuleSkeleton } from "@/components/module-skeleton";
import type { VisibilityOption } from "@/components/category-visibility-button";
import { DemoDataBanner } from "@/components/demo-data-banner";
import { FilterMismatchNotice } from "@/components/filter-mismatch-notice";
import { ExpensesDashboard } from "@/components/expenses-dashboard";
import { CategorizedTagsDashboard } from "@/components/categorized-tags-dashboard";
import { ExpenseVendorsSection } from "@/components/expense-vendors-section";
import { RecentExpensesSection } from "@/components/recent-expenses-section";
import { CompaniesDashboard } from "@/components/companies-dashboard";
import type { AggregatedBreakdownPoint, NormalizedExpense } from "@/lib/kros-types";
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
  tagFilterKey,
  type TagCategoryFilters,
  type TagCategoryIndex
} from "@/lib/tag-categories";
import {
  computeComparableExpenseYtdTotals,
  computeExpenseCompanyBreakdown,
  computeExpenseDueWatchlist,
  computeExpenseKpis,
  computeExpenseSeries,
  computeExpenseTagBreakdown,
  computeExpenseTagStructure,
  computeExpenseVendorBreakdown,
  getFilteredRecentExpenses,
  scopeExpenseAmountsToTagFilters,
  withNormalizedTagShares
} from "@/lib/expenses-live";
import {
  focusOutsideDonut,
  focusedTagNames,
  reconcileFocusedTags,
  type FocusedTag
} from "@/lib/tag-focus";
import { getBucketPeriodWindow } from "@/lib/period-buckets";
import { getMockExpenses } from "@/lib/expenses-mock-data";
import { expenseEngine } from "@/lib/sync/expense-engine";
import { useSyncOrchestrator } from "@/lib/sync/use-sync-orchestrator";

/**
 * Engine array musí byť modulová konštanta, nie literál v tele komponentu —
 * inak sa efekt v orchestrátore spustí pri každom rendere odznova.
 */
const EXPENSE_ENGINES = [expenseEngine];

/**
 * Doklady zúžené filtrom štítkov a focusom (rozkliknutými štítkami) — doklad musí niesť
 * všetky focusnuté štítky. Sumy sa potom zúžia na tie riadky rozúčtovania, ktoré prejdú
 * filtrom aj focusom — z dokladu rozúčtovaného na viac štítkov sa tak všade (graf, KPI,
 * dodávatelia aj zoznamy dokladov) počíta len časť patriaca výberu.
 */
function scopeExpensesToTags(
  expenses: NormalizedExpense[],
  filters: TagCategoryFilters,
  focusedTags: string[],
  tagCategoryIndex: TagCategoryIndex
) {
  const matching = expenses.filter((expense) =>
    documentMatchesTagFilters(expense.tags, filters, focusedTags, tagCategoryIndex)
  );
  return scopeExpenseAmountsToTagFilters(matching, filters, focusedTags, tagCategoryIndex);
}

/**
 * Id pevných sekcií pre prepínač zobrazenia. Prefix `section:` ich odlišuje od kategórií
 * štítkov, ktoré v tom istom zozname vystupujú pod svojím názvom.
 */
const EXPENSE_SECTIONS = {
  vendors: "section:vendors",
  recentExpenses: "section:recentExpenses",
  companies: "section:companies"
} as const;

export default function ExpensesPage() {
  // Nastavenia sú v spoločnom store (server + `localStorage` ako cache), nie v stave stránky.
  const [granularity, setGranularity] = usePreference("ui.granularity");
  const [categoryFilters, setCategoryFilters] = usePreference("expenses.tagFilters");
  // Focus drží viac štítkov naraz — dáta sa zúžia na doklady, ktoré nesú všetky. Ku každému
  // štítku si pamätá aj sekciu, v ktorej klik vznikol: tá sa vlastným focusom nezužuje.
  const [focusedTags, setFocusedTags] = useState<FocusedTag[]>([]);
  const [selectedCompanies, setSelectedCompanies] = usePreference("expenses.companies");
  const [hiddenSections, setHiddenSections] = usePreference("ui.expensesHiddenSections");
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

  // Prvý render beží ešte pred pripojením k store-u, takže sa sťahovanie odkladá o tik —
  // inak by prvý fetch šiel s prázdnym filtrom a hneď za ním druhý so skutočným.
  useEffect(() => {
    setHasLoadedPersistedFilters(true);
  }, []);

  const {
    data: { expenses: liveExpenses },
    isSyncing: isLoadingLiveData,
    hasResolvedFirstData,
    refresh
  } = useSyncOrchestrator(EXPENSE_ENGINES, {
    connections,
    syncConnections,
    granularity,
    enabled: hasLoadedPersistedFilters
  });

  const handleRefresh = () => {
    setTagRefreshNonce((value) => value + 1);
    refresh();
  };

  const hasLiveMode = connections.length > 0;
  // Prechod na modul má ukázať loader, nie demo čísla, ktoré o chvíľu prepíšu tie skutočné.
  const isPreparingModule = isLoadingConnections || !hasResolvedFirstData;
  const tagCategoryIndex = useTagCategoryIndex(connections, tagRefreshNonce);
  const mockExpenses = useMemo(() => (hasLiveMode ? [] : getMockExpenses()), [hasLiveMode]);
  const expenses = hasLiveMode ? liveExpenses : mockExpenses;
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

  useEffect(() => {
    const migrated = migrateFlatFiltersToCategories(categoryFilters, tagCategoryIndex);
    // `migrateFlatFiltersToCategories` vracia pôvodný objekt, keď nie je čo prerobiť —
    // bez tejto podmienky by zápis spustil efekt dokola.
    if (migrated !== categoryFilters) setCategoryFilters(migrated);
  }, [tagCategoryIndex, categoryFilters, setCategoryFilters]);

  const availableTagSet = useMemo(
    () => new Set(expenses.flatMap((expense) => expense.tags)),
    [expenses]
  );

  const sanitizedCategoryFilters = useMemo(() => {
    const next: TagCategoryFilters = {};
    for (const [category, tags] of Object.entries(categoryFilters)) {
      const kept = tags.filter((tag) => availableTagSet.has(tag));
      if (kept.length > 0) next[category] = kept;
    }
    return next;
  }, [categoryFilters, availableTagSet]);

  const effectiveFocus = useMemo(
    () => focusedTags.filter((focused) => availableTagSet.has(focused.tag)),
    [focusedTags, availableTagSet]
  );
  // Grafy, KPI, dodávatelia aj doklady sa zužujú celým focusom…
  const effectiveFocusedTags = useMemo(() => focusedTagNames(effectiveFocus), [effectiveFocus]);
  // …donut ale len tým, čo v ňom nevzniklo — vlastným klikom sa nezužuje.
  const donutFocusedTags = useMemo(() => focusOutsideDonut(effectiveFocus), [effectiveFocus]);

  // Zoznamy štítkov ostávajú na Filtri štítkov — bez zužovania súm, aby sa v sekcii
  // dalo preklikať na iný štítok s rovnakými číslami ako pred kliknutím.
  const filterScopedExpenses = useMemo(
    () => expenses.filter((expense) => documentMatchesTagFilters(expense.tags, sanitizedCategoryFilters)),
    [expenses, sanitizedCategoryFilters]
  );

  // Graf, KPI, donut, dodávatelia aj doklady idú z dokladov zúžených filtrom a focusom.
  const tagScopedExpenses = useMemo(
    () => scopeExpensesToTags(expenses, sanitizedCategoryFilters, effectiveFocusedTags, tagCategoryIndex),
    [expenses, sanitizedCategoryFilters, effectiveFocusedTags, tagCategoryIndex]
  );

  const points = useMemo(
    () =>
      computeExpenseSeries({
        expenses: tagScopedExpenses,
        granularity,
        selectedTags: [],
        selectedCompanies: effectiveCompanies
      }),
    [tagScopedExpenses, granularity, effectiveCompanies]
  );

  const ytdTotals = useMemo(
    () =>
      computeComparableExpenseYtdTotals({
        expenses: tagScopedExpenses,
        selectedTags: [],
        selectedCompanies: effectiveCompanies
      }),
    [tagScopedExpenses, effectiveCompanies]
  );

  const dueWatchlist = useMemo(
    () => computeExpenseDueWatchlist(tagScopedExpenses, [], effectiveCompanies),
    [tagScopedExpenses, effectiveCompanies]
  );

  const kpis = useMemo(
    () => computeExpenseKpis(points, ytdTotals, dueWatchlist, focusedPeriod),
    [points, ytdTotals, dueWatchlist, focusedPeriod]
  );

  // Donut je sekcia filtra ako každá iná: focus z ostatných sekcií mu zúži čísla, vlastný
  // klik nie — inak by po kliknutí ostal jediný výsek a nedalo by sa preklikať inam.
  // Výseky preto neodpadávajú, focusnuté sa v grafe len zvýraznia.
  const tagStructure = useMemo(() => {
    const scopedExpenses =
      donutFocusedTags.length === 0
        ? filterScopedExpenses
        : scopeExpensesToTags(
            expenses,
            sanitizedCategoryFilters,
            donutFocusedTags,
            tagCategoryIndex
          );
    const slices = computeExpenseTagStructure(
      scopedExpenses,
      [],
      effectiveCompanies,
      periodWindow ?? undefined
    ).filter((slice) => isTagAllowedByFilters(slice.name, sanitizedCategoryFilters, tagCategoryIndex));
    return withNormalizedTagShares(slices);
  }, [
    expenses,
    filterScopedExpenses,
    donutFocusedTags,
    sanitizedCategoryFilters,
    effectiveCompanies,
    tagCategoryIndex,
    periodWindow
  ]);

  const availableTagsData = useMemo(
    () => computeExpenseTagBreakdown(expenses, effectiveCompanies),
    [expenses, effectiveCompanies]
  );

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
      filterCount: sanitizedCategoryFilters[category]?.length ?? 0
    }));
  }, [availableTagsData, tagCategoryIndex, sanitizedCategoryFilters]);

  const sectionOptions = useMemo<VisibilityOption[]>(
    () => [
      { id: EXPENSE_SECTIONS.vendors, label: "Top dodávatelia" },
      { id: EXPENSE_SECTIONS.recentExpenses, label: "Posledné výdavky" },
      {
        id: EXPENSE_SECTIONS.companies,
        label: "Výdavky podľa firiem",
        filterCount: selectedCompanies.length
      }
    ],
    [selectedCompanies]
  );

  const isSectionHidden = (id: string) => hiddenSections.includes(id);

  const tagsData = useMemo(() => {
    const filterPoints = computeExpenseTagBreakdown(
      filterScopedExpenses,
      effectiveCompanies,
      periodWindow ?? undefined
    ).filter((point) => isTagAllowedByFilters(point.name, sanitizedCategoryFilters, tagCategoryIndex));
    if (effectiveFocusedTags.length === 0) {
      return filterPoints;
    }

    // V kategórii, z ktorej štítok focusnutý je, sa jej vlastný focus nepočíta — inak by
    // v sekcii ostal jediný riadok a nedalo by sa preklikať na iný štítok. Focus z ostatných
    // kategórií platí aj tu, takže sumy sedia s prienikom zvolených štítkov.
    const breakdownByCategory = new Map<string, Map<string, AggregatedBreakdownPoint>>();
    const breakdownFor = (category: string) => {
      const cached = breakdownByCategory.get(category);
      if (cached) return cached;

      const focusOutsideCategory = effectiveFocusedTags.filter(
        (tag) => tagFilterKey(tagCategoryIndex, tag) !== category
      );
      const scopedExpenses =
        focusOutsideCategory.length === 0
          ? filterScopedExpenses
          : scopeExpensesToTags(
              expenses,
              sanitizedCategoryFilters,
              focusOutsideCategory,
              tagCategoryIndex
            );
      const points = computeExpenseTagBreakdown(
        scopedExpenses,
        effectiveCompanies,
        periodWindow ?? undefined
      );
      const byName = new Map(points.map((point) => [point.name, point]));
      breakdownByCategory.set(category, byName);
      return byName;
    };

    return filterPoints
      .flatMap((point) => {
        const scoped = breakdownFor(tagFilterKey(tagCategoryIndex, point.name)).get(point.name);
        return scoped ? [scoped] : [];
      })
      .sort((a, b) => b.amount - a.amount);
  }, [
    expenses,
    filterScopedExpenses,
    effectiveCompanies,
    sanitizedCategoryFilters,
    tagCategoryIndex,
    effectiveFocusedTags,
    periodWindow
  ]);

  const vendors = useMemo(
    () =>
      computeExpenseVendorBreakdown(
        tagScopedExpenses,
        [],
        effectiveCompanies,
        undefined,
        periodWindow ?? undefined
      ),
    [tagScopedExpenses, effectiveCompanies, periodWindow]
  );

  const companiesData = useMemo(
    // Zoznam firiem sa nezužuje focusom — rovnako ako štítky v kategórii.
    () =>
      computeExpenseCompanyBreakdown(
        tagScopedExpenses,
        [],
        selectedCompanies,
        periodWindow ?? undefined
      ),
    [tagScopedExpenses, selectedCompanies, periodWindow]
  );

  const recentExpenses = useMemo(
    () =>
      getFilteredRecentExpenses(tagScopedExpenses, {
        granularity,
        selectedTags: [],
        selectedCompanies: effectiveCompanies,
        limit: 10,
        period: periodWindow ?? undefined
      }),
    [tagScopedExpenses, granularity, effectiveCompanies, periodWindow]
  );

  const handleCategoryFiltersChange = (next: TagCategoryFilters) => {
    setCategoryFilters(next);
    // Focus je drill-down vo filtri — štítok, ktorý filter už nepustí, z focusu vypadne.
    setFocusedTags((previous) =>
      previous.filter((focused) => isTagAllowedByFilters(focused.tag, next, tagCategoryIndex))
    );
  };

  // Odkiaľ klik prišiel, rozhoduje, ktorá sekcia sa ním NEZUŽUJE — preto dva handlery.
  const handleDonutFocusChange = (nextTags: string[]) =>
    setFocusedTags((previous) => reconcileFocusedTags(previous, nextTags, true));

  const handleSectionFocusChange = (nextTags: string[]) =>
    setFocusedTags((previous) => reconcileFocusedTags(previous, nextTags, false));

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
      title="Výdavky"
      isSyncing={isLoadingLiveData}
      syncNote="Doklady ťaháme po mesiacoch a ku každému aj rozúčtovanie na štítky, preto prvé načítanie trvá dlhšie. Ostanú uložené v zariadení — pri ďalšom otvorení sa dosynchronizujú len zmeny."
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
      {isPreparingModule ? <ModuleSkeleton label="Načítavam výdavky…" /> : null}
      {isPreparingModule ? null : (
        <>
      {!hasLiveMode && !isLoadingConnections ? <DemoDataBanner /> : null}
      {companyFilter.noneAvailable ? <FilterMismatchNotice onShowAll={() => setSelectedCompanies([])} /> : null}
      <ExpensesDashboard
        granularity={granularity}
        kpis={kpis}
        points={points}
        expenses={tagScopedExpenses}
        tagStructure={tagStructure}
        tagCategoryIndex={tagCategoryIndex}
        dueWatchlist={dueWatchlist}
        selectedTags={[]}
        selectedCompanies={effectiveCompanies}
        activeTagLabels={effectiveFocusedTags}
        activeCompanyLabel={focusedCompany ?? undefined}
        onClearCompanyFilter={() => setFocusedCompany(null)}
        onFocusTagsChange={handleDonutFocusChange}
        focusedPeriod={focusedPeriod}
        onFocusedPeriodChange={setFocusedPeriod}
        isMockData={!hasLiveMode}
      />
      <CategorizedTagsDashboard
        tags={tagsData}
        availableTags={availableTagsData}
        categoryIndex={tagCategoryIndex}
        baseTitle="Výdavky podľa štítkov"
        ariaLabelPrefix="Filtrovať výdavky podľa štítku"
        categoryFilters={sanitizedCategoryFilters}
        focusedTags={effectiveFocusedTags}
        hiddenCategories={hiddenSections}
        onCategoryFiltersChange={handleCategoryFiltersChange}
        onFocusedTagsChange={handleSectionFocusChange}
        invertDeltaColor
      />
      {isSectionHidden(EXPENSE_SECTIONS.vendors) ? null : <ExpenseVendorsSection vendors={vendors} />}
      {isSectionHidden(EXPENSE_SECTIONS.recentExpenses) ? null : (
        <RecentExpensesSection expenses={recentExpenses} />
      )}
      {isSectionHidden(EXPENSE_SECTIONS.companies) ? null : (
      <CompaniesDashboard
        title="Výdavky podľa firiem"
        companies={companiesData}
        selectedCompanies={selectedCompanies}
        availableCompanyNames={
          connections.length > 0 ? connections.map((connection) => connection.companyName) : undefined
        }
        invertDeltaColor
        collapsedKey="ui.collapsed.expensesCompanies"
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
