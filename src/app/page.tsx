"use client";

import { startTransition, useEffect, useMemo, useRef, useState } from "react";
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
  getTagsBreakdown,
  type Granularity
} from "@/lib/mock-data";
import {
  computeCompanyBreakdown,
  computeComparableYtdTotals,
  computeKpis,
  computeRevenueSeries,
  computeTagBreakdown,
  getFilteredRecentInvoices,
  normalizeInvoices
} from "@/lib/dashboard-live";
import { getBucketPeriodWindow, getDateRange } from "@/lib/period-buckets";
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
import type { KrosConnection, NormalizedInvoice } from "@/lib/kros-types";
import {
  getCachedInvoices,
  monthKeyFromDate,
  readSyncMeta,
  syncCompanyMetaKey,
  syncMonthMetaKey,
  upsertCachedInvoices,
  writeSyncMeta
} from "@/lib/invoice-cache";
import { formatMonthKeyLabel, useSyncProgress, type SyncStep } from "@/lib/use-sync-progress";

const LAST_SYNC_STORAGE_KEY = "kros_dashboard_last_sync_at";

type LiveDataRange = "ytd" | "history";

type MonthSyncRange = { monthKey: string; from: string; to: string };

/**
 * Jeden krok sťahovania — buď chýbajúci mesiac firmy, alebo faktúry zmenené od
 * posledného syncu. Plán krokov zostavíme pred prvým fetchom, aby progress bar
 * poznal celok a nemusel len nekonečne točiť.
 */
type InvoiceSyncStep =
  | { kind: "month"; connection: KrosConnection; monthRange: MonthSyncRange }
  | { kind: "changes"; connection: KrosConnection; lastModifiedTimestamp: string };

/** Od koľkých krokov je sťahovanie „na dlho“ a patrí naň celá obrazovka. */
const IMMERSIVE_STEP_THRESHOLD = 3;

/** Krok sťahovania tak, ako ho vidí používateľ na obrazovke sťahovania. */
function toSyncStep(step: InvoiceSyncStep): SyncStep {
  if (step.kind === "month") {
    return {
      key: `${step.connection.companyId}:${step.monthRange.monthKey}`,
      group: step.connection.companyName,
      label: formatMonthKeyLabel(step.monthRange.monthKey)
    };
  }

  return {
    key: `${step.connection.companyId}:changes`,
    group: step.connection.companyName,
    label: "zmenené faktúry"
  };
}

function getLiveDataRange(granularity: Granularity): LiveDataRange {
  return granularity === "year" ? "history" : "ytd";
}

function startOfDayIso(date: Date) {
  const value = new Date(date);
  value.setHours(0, 0, 0, 0);
  return value.toISOString();
}

function endOfDayIso(date: Date) {
  const value = new Date(date);
  value.setHours(23, 59, 59, 999);
  return value.toISOString();
}

function buildMonthSyncRanges(fetchFrom: string, fetchTo: string) {
  const start = new Date(fetchFrom);
  const end = new Date(fetchTo);
  const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
  const ranges: MonthSyncRange[] = [];

  while (cursor <= end) {
    const monthStart = new Date(cursor);
    const monthEnd = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
    const from = monthStart < start ? start : monthStart;
    const to = monthEnd > end ? end : monthEnd;

    ranges.push({
      monthKey: monthKeyFromDate(cursor),
      from: startOfDayIso(from),
      to: endOfDayIso(to)
    });

    cursor.setMonth(cursor.getMonth() + 1);
  }

  return ranges;
}

function getMaxLastModified(invoices: NormalizedInvoice[], fallback?: string) {
  return invoices.reduce<string | undefined>((max, invoice) => {
    if (!invoice.lastModifiedTimestamp) return max;
    if (!max) return invoice.lastModifiedTimestamp;
    return new Date(invoice.lastModifiedTimestamp).getTime() > new Date(max).getTime()
      ? invoice.lastModifiedTimestamp
      : max;
  }, fallback);
}

function withLastModifiedOverlap(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  date.setMinutes(date.getMinutes() - 5);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const hours = String(date.getUTCHours()).padStart(2, "0");
  const minutes = String(date.getUTCMinutes()).padStart(2, "0");
  const seconds = String(date.getUTCSeconds()).padStart(2, "0");
  const milliseconds = date.getUTCMilliseconds();
  const fraction =
    milliseconds > 0 ? `.${String(milliseconds).padStart(3, "0").replace(/0+$/, "")}` : "";
  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}${fraction}`;
}

/**
 * Id pevných sekcií pre prepínač zobrazenia. Prefix `section:` ich odlišuje od kategórií
 * štítkov, ktoré v tom istom zozname vystupujú pod svojím názvom.
 */
const REVENUE_SECTIONS = {
  recentInvoices: "section:recentInvoices",
  companies: "section:companies"
} as const;

export default function HomePage() {
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
  const [liveInvoices, setLiveInvoices] = useState<NormalizedInvoice[]>([]);
  const [isLoadingLiveData, setIsLoadingLiveData] = useState(false);
  const [, setLiveError] = useState<string | null>(null);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [hasLoadedPersistedFilters, setHasLoadedPersistedFilters] = useState(false);
  // Kým nevieme, či ide o live alebo demo režim (a kým z cache neprídu prvé faktúry),
  // nekreslíme čísla — inak na obrazovke blikne demo suma a hneď ju prepíše skutočná.
  const [hasResolvedFirstData, setHasResolvedFirstData] = useState(false);
  const handledRefreshNonceRef = useRef(0);
  const { beginSync, startStep, completeStep, endSync } = useSyncProgress();

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

  // Prvý render beží ešte pred pripojením k store-u (server snapshot = defaulty), takže sa
  // sťahovanie odkladá o jeden tik. Bez toho by prvý fetch šiel s prázdnym filtrom a hneď
  // za ním druhý so skutočným.
  useEffect(() => {
    setHasLoadedPersistedFilters(true);
  }, []);

  useEffect(() => {
    if (!hasLoadedPersistedFilters) return;

    if (connections.length === 0) {
      setLiveInvoices([]);
      setHasResolvedFirstData(true);
      endSync();
      return;
    }

    if (syncConnections.length === 0) {
      setLiveInvoices([]);
      setIsLoadingLiveData(false);
      setHasResolvedFirstData(true);
      endSync();
      return;
    }

    const abortController = new AbortController();
    const liveDataRange = getLiveDataRange(granularity);
    const fetchRange = getDateRange(liveDataRange === "history" ? "year" : "month");
    const isManualRefresh = refreshNonce !== handledRefreshNonceRef.current;
    const syncCompanyIds = syncConnections.map((connection) => connection.companyId);

    const fetchInvoices = async (body: {
      companyIds: number[];
      deliveryDateFrom?: string;
      deliveryDateTo?: string;
      lastModifiedTimestamp?: string;
    }) => {
      const response = await fetch("/api/kros/invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: abortController.signal
      });

      const payload = await response.json();
      if (!response.ok) {
        throw new Error(
          payload?.details
            ? `${payload?.error ?? "Nepodarilo sa načítať faktúry."} ${payload.details}`
            : payload?.error ?? "Nepodarilo sa načítať faktúry."
        );
      }
      if (Array.isArray(payload?.errors) && payload.errors.length > 0) {
        throw new Error(payload.errors[0]?.message ?? "Niektoré firmy sa nepodarilo načítať.");
      }
      return Array.isArray(payload?.data) ? (payload.data as unknown[]) : [];
    };

    const loadInvoices = async () => {
      const cachedInvoices = await getCachedInvoices(syncCompanyIds);
      if (!abortController.signal.aborted) {
        // Prepočet dashboardu z faktúr je drahý. Ako transition ho React vie
        // prerušiť, keď medzitým klikneš v menu — appka tak ostáva ovládateľná.
        startTransition(() => setLiveInvoices(cachedInvoices));
        setHasResolvedFirstData(true);
      }

      setLiveError(null);

      try {
        const monthRanges = buildMonthSyncRanges(fetchRange.fetchFrom, fetchRange.fetchTo);
        let didFetch = false;
        let didClearSyncLogs = false;
        const clearSyncLogsOnce = async () => {
          if (didClearSyncLogs) return;
          didClearSyncLogs = true;
          await fetch("/api/kros/logs", { method: "DELETE" });
        };

        // Najprv plán: čo všetko treba stiahnuť. Počet krokov je podklad pre
        // progress bar, preto ho zisťujeme ešte pred prvým fetchom.
        const steps: InvoiceSyncStep[] = [];
        for (const connection of syncConnections) {
          const missingMonthRanges: MonthSyncRange[] = [];
          for (const monthRange of monthRanges) {
            const monthMeta = await readSyncMeta(
              syncMonthMetaKey(connection.companyId, liveDataRange, monthRange.monthKey)
            );
            if (!monthMeta?.completedAt) {
              missingMonthRanges.push(monthRange);
            }
          }

          if (missingMonthRanges.length > 0) {
            for (const monthRange of missingMonthRanges) {
              steps.push({ kind: "month", connection, monthRange });
            }
            continue;
          }

          if (!isManualRefresh) continue;

          const companyMeta = await readSyncMeta(
            syncCompanyMetaKey(connection.companyId, liveDataRange)
          );
          if (!companyMeta?.lastModifiedTimestamp) continue;
          steps.push({
            kind: "changes",
            connection,
            lastModifiedTimestamp: companyMeta.lastModifiedTimestamp
          });
        }

        if (abortController.signal.aborted) return;
        // Bez dát na obrazovke (alebo pri práci na dlho) sťahujeme naplno,
        // krátke dosynchronizovanie nad existujúcimi dátami stačí v hlavičke.
        beginSync(
          steps.map(toSyncStep),
          cachedInvoices.length === 0 || steps.length >= IMMERSIVE_STEP_THRESHOLD
        );
        if (steps.length > 0) {
          setIsLoadingLiveData(true);
        }

        for (const [index, step] of steps.entries()) {
          if (abortController.signal.aborted) return;

          const { connection } = step;
          startStep(index);

          await clearSyncLogsOnce();
          const rawInvoices = await fetchInvoices(
            step.kind === "month"
              ? {
                  companyIds: [connection.companyId],
                  deliveryDateFrom: step.monthRange.from,
                  deliveryDateTo: step.monthRange.to
                }
              : {
                  companyIds: [connection.companyId],
                  lastModifiedTimestamp: withLastModifiedOverlap(step.lastModifiedTimestamp)
                }
          );

          const normalizedInvoices = normalizeInvoices(rawInvoices);
          const companyInvoices = normalizedInvoices.filter(
            (invoice) =>
              invoice.companyId === connection.companyId || invoice.companyName === connection.companyName
          );
          const completedAt = new Date().toISOString();
          await upsertCachedInvoices(connection.companyId, companyInvoices);

          if (step.kind === "month") {
            await writeSyncMeta({
              key: syncMonthMetaKey(connection.companyId, liveDataRange, step.monthRange.monthKey),
              companyId: connection.companyId,
              range: liveDataRange,
              monthKey: step.monthRange.monthKey,
              completedAt
            });
          }

          const companyMetaKey = syncCompanyMetaKey(connection.companyId, liveDataRange);
          const previousCompanyMeta = await readSyncMeta(companyMetaKey);
          await writeSyncMeta({
            key: companyMetaKey,
            companyId: connection.companyId,
            range: liveDataRange,
            completedAt,
            lastModifiedTimestamp: getMaxLastModified(
              companyInvoices,
              previousCompanyMeta?.lastModifiedTimestamp
            )
          });

          didFetch = true;
          completeStep();
          const nextCachedInvoices = await getCachedInvoices(syncCompanyIds);
          if (!abortController.signal.aborted) {
            startTransition(() => setLiveInvoices(nextCachedInvoices));
          }
        }

        if (didFetch) {
          localStorage.setItem(LAST_SYNC_STORAGE_KEY, new Date().toISOString());
        }
      } catch (error) {
        if (!abortController.signal.aborted) {
          setLiveError(error instanceof Error ? error.message : "Načítanie live dát zlyhalo.");
        }
      } finally {
        if (!abortController.signal.aborted) {
          handledRefreshNonceRef.current = refreshNonce;
          setIsLoadingLiveData(false);
          endSync();
        }
      }
    };

    loadInvoices();

    return () => abortController.abort();
  }, [
    connections,
    syncConnections,
    granularity,
    refreshNonce,
    hasLoadedPersistedFilters,
    beginSync,
    startStep,
    completeStep,
    endSync
  ]);

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
  const tagCategoryIndex = useTagCategoryIndex(connections, refreshNonce);

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
      onRefresh={connections.length > 0 ? () => setRefreshNonce((value) => value + 1) : undefined}
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
