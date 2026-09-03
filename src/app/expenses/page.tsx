"use client";

import { startTransition, useEffect, useMemo, useRef, useState } from "react";
import { DashboardShell } from "@/components/dashboard-shell";
import { DemoDataBanner } from "@/components/demo-data-banner";
import { FilterMismatchNotice } from "@/components/filter-mismatch-notice";
import { ExpensesDashboard } from "@/components/expenses-dashboard";
import { CategorizedTagsDashboard } from "@/components/categorized-tags-dashboard";
import { ExpenseVendorsSection } from "@/components/expense-vendors-section";
import { RecentExpensesSection } from "@/components/recent-expenses-section";
import { CompaniesDashboard } from "@/components/companies-dashboard";
import type { Granularity } from "@/lib/mock-data";
import type { KrosConnection, NormalizedExpense } from "@/lib/kros-types";
import { useKrosConnections } from "@/lib/use-kros-connections";
import { useTagCategoryIndex } from "@/lib/use-tag-categories";
import { applyCompanyFilter } from "@/lib/preferences/company-filter";
import { usePreference } from "@/lib/use-preference";
import {
  allSelectedTags,
  categoryForTag,
  documentMatchesTagFilters,
  isTagAllowedByFilters,
  migrateFlatFiltersToCategories,
  type TagCategoryFilters
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
  normalizeExpenses,
  scopeExpenseAmountsToTags
} from "@/lib/expenses-live";
import { getDateRange } from "@/lib/dashboard-live";
import { getMockExpenses } from "@/lib/expenses-mock-data";
import { formatMonthKeyLabel, useSyncProgress, type SyncStep } from "@/lib/use-sync-progress";
import { readNdjsonStream } from "@/lib/ndjson-stream";
import {
  expenseCompanyMetaKey,
  expenseMonthMetaKey,
  getCachedExpenses,
  readExpenseSyncMeta,
  upsertCachedExpenses,
  writeExpenseSyncMeta
} from "@/lib/expense-cache";

const LAST_SYNC_STORAGE_KEY = "kros_dashboard_last_sync_at";

type LiveDataRange = "ytd" | "history";

type MonthSyncRange = { monthKey: string; from: string; to: string };

/**
 * Jeden krok sťahovania — buď chýbajúci mesiac firmy, alebo doklady zmenené od
 * posledného syncu. Plán krokov zostavíme pred prvým fetchom, aby progress bar
 * poznal celok a nemusel len nekonečne točiť.
 */
type ExpenseSyncStep =
  | { kind: "month"; connection: KrosConnection; monthRange: MonthSyncRange }
  | { kind: "changes"; connection: KrosConnection; lastModifiedTimestamp: string };

/** Od koľkých krokov je sťahovanie „na dlho“ a patrí naň celá obrazovka. */
const IMMERSIVE_STEP_THRESHOLD = 3;

/** Krok sťahovania tak, ako ho vidí používateľ na obrazovke sťahovania. */
function toSyncStep(step: ExpenseSyncStep): SyncStep {
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
    label: "zmenené doklady"
  };
}

/** Riadky priebehu z `/api/kros/expenses` (NDJSON stream). */
type ExpenseStreamEvent =
  | { type: "progress"; phase: "list"; loaded?: number }
  | { type: "progress"; phase: "details"; done?: number; total?: number }
  | ExpenseResultEvent;

type ExpenseResultEvent = { type: "result"; data?: unknown[]; errors?: { message?: string }[] };

// Stránkovanie hlavičiek je proti doťahovaniu rozúčtovania krátke, ale nie
// zanedbateľné — kus baru mu preto necháme.
const LIST_PHASE_SHARE = 0.12;

/** Podiel hotového v rámci jedného kroku + jeho popis pre progress bar. */
function readStepProgress(event: ExpenseStreamEvent) {
  if (event.type !== "progress") return null;

  if (event.phase === "list") {
    const loaded = event.loaded ?? 0;
    return { fraction: LIST_PHASE_SHARE / 2, detail: `hľadám doklady (${loaded})` };
  }

  const total = event.total ?? 0;
  const done = event.done ?? 0;
  if (total === 0) return { fraction: 1, detail: "žiadne doklady" };
  return {
    fraction: LIST_PHASE_SHARE + (1 - LIST_PHASE_SHARE) * (done / total),
    detail: `doklady ${done}/${total}`
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

function monthKeyFromDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
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

function getMaxLastModified(expenses: NormalizedExpense[], fallback?: string) {
  return expenses.reduce<string | undefined>((max, expense) => {
    if (!expense.lastModifiedTimestamp) return max;
    if (!max) return expense.lastModifiedTimestamp;
    return new Date(expense.lastModifiedTimestamp).getTime() > new Date(max).getTime()
      ? expense.lastModifiedTimestamp
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

export default function ExpensesPage() {
  // Nastavenia sú v spoločnom store (server + `localStorage` ako cache), nie v stave stránky.
  const [granularity, setGranularity] = usePreference("ui.granularity");
  const [categoryFilters, setCategoryFilters] = usePreference("expenses.tagFilters");
  const [focusedTag, setFocusedTag] = useState<string | null>(null);
  const [selectedCompanies, setSelectedCompanies] = usePreference("expenses.companies");
  const [focusedCompany, setFocusedCompany] = useState<string | null>(null);
  // Prepojenia sú firemné a žijú na serveri — na novom zariadení už netreba nič preklikávať.
  const { connections, isLoading: isLoadingConnections } = useKrosConnections();
  const [liveExpenses, setLiveExpenses] = useState<NormalizedExpense[]>([]);
  const [isLoadingLiveData, setIsLoadingLiveData] = useState(false);
  const [, setLiveError] = useState<string | null>(null);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [hasLoadedPersistedFilters, setHasLoadedPersistedFilters] = useState(false);
  const handledRefreshNonceRef = useRef(0);
  const {
    beginSync,
    startStep,
    advanceStep,
    completeStep,
    endSync
  } = useSyncProgress();

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

  useEffect(() => {
    if (!hasLoadedPersistedFilters) return;

    if (connections.length === 0) {
      setLiveExpenses([]);
      endSync();
      return;
    }

    if (syncConnections.length === 0) {
      setLiveExpenses([]);
      setIsLoadingLiveData(false);
      endSync();
      return;
    }

    const abortController = new AbortController();
    // Same flow as Biznis: hydrate from the persistent IndexedDB cache first; months
    // without a completed sync get a full fetch, a manual refresh pulls only expenses
    // changed since the stored per-company LastModifiedTimestamp.
    const liveDataRange = getLiveDataRange(granularity);
    const fetchRange = getDateRange(liveDataRange === "history" ? "year" : "month");
    const isManualRefresh = refreshNonce !== handledRefreshNonceRef.current;
    const syncCompanyIds = syncConnections.map((connection) => connection.companyId);

    const fetchExpenses = async (body: {
      companyIds: number[];
      deliveryDateFrom?: string;
      deliveryDateTo?: string;
      lastModifiedTimestamp?: string;
    }) => {
      const response = await fetch("/api/kros/expenses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: abortController.signal
      });

      if (!response.ok || !response.body) {
        const payload = await response.json().catch(() => null);
        throw new Error(
          payload?.details
            ? `${payload?.error ?? "Nepodarilo sa načítať výdavky."} ${payload.details}`
            : payload?.error ?? "Nepodarilo sa načítať výdavky."
        );
      }

      // Dáta prídu posledným riadkom streamu, dovtedy chodí priebeh sťahovania.
      const collected: { result: ExpenseResultEvent | null } = { result: null };
      await readNdjsonStream(response.body, (raw) => {
        const event = raw as ExpenseStreamEvent;
        if (event?.type === "result") {
          collected.result = event;
          return;
        }

        const stepProgress = readStepProgress(event);
        if (stepProgress) {
          advanceStep(stepProgress.fraction, stepProgress.detail);
        }
      });

      const payload = collected.result;
      if (!payload) {
        throw new Error("Nepodarilo sa načítať výdavky — sťahovanie sa nedokončilo.");
      }
      if (Array.isArray(payload.errors) && payload.errors.length > 0) {
        throw new Error(payload.errors[0]?.message ?? "Niektoré firmy sa nepodarilo načítať.");
      }
      return Array.isArray(payload.data) ? payload.data : [];
    };

    const loadExpenses = async () => {
      const cachedExpenses = await getCachedExpenses(syncCompanyIds);
      if (!abortController.signal.aborted) {
        // Prepočet dashboardu z dokladov je drahý. Ako transition ho React vie
        // prerušiť, keď medzitým klikneš v menu — appka tak ostáva ovládateľná.
        startTransition(() => setLiveExpenses(cachedExpenses));
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
        const steps: ExpenseSyncStep[] = [];
        for (const connection of syncConnections) {
          const missingMonthRanges: MonthSyncRange[] = [];
          for (const monthRange of monthRanges) {
            const monthMeta = await readExpenseSyncMeta(
              expenseMonthMetaKey(connection.companyId, liveDataRange, monthRange.monthKey)
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

          const companyMeta = await readExpenseSyncMeta(
            expenseCompanyMetaKey(connection.companyId, liveDataRange)
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
          cachedExpenses.length === 0 || steps.length >= IMMERSIVE_STEP_THRESHOLD
        );
        if (steps.length > 0) {
          setIsLoadingLiveData(true);
        }

        for (const [index, step] of steps.entries()) {
          if (abortController.signal.aborted) return;

          const { connection } = step;
          startStep(index);

          await clearSyncLogsOnce();
          const rawExpenses = await fetchExpenses(
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

          const normalizedExpenses = normalizeExpenses(rawExpenses);
          const companyExpenses = normalizedExpenses.filter(
            (expense) =>
              expense.companyId === connection.companyId || expense.companyName === connection.companyName
          );
          const completedAt = new Date().toISOString();
          await upsertCachedExpenses(connection.companyId, companyExpenses);

          if (step.kind === "month") {
            await writeExpenseSyncMeta({
              key: expenseMonthMetaKey(connection.companyId, liveDataRange, step.monthRange.monthKey),
              companyId: connection.companyId,
              range: liveDataRange,
              monthKey: step.monthRange.monthKey,
              completedAt
            });
          }

          const companyMetaKey = expenseCompanyMetaKey(connection.companyId, liveDataRange);
          const previousCompanyMeta = await readExpenseSyncMeta(companyMetaKey);
          await writeExpenseSyncMeta({
            key: companyMetaKey,
            companyId: connection.companyId,
            range: liveDataRange,
            completedAt,
            lastModifiedTimestamp: getMaxLastModified(
              companyExpenses,
              previousCompanyMeta?.lastModifiedTimestamp
            )
          });

          didFetch = true;
          completeStep();
          const nextCachedExpenses = await getCachedExpenses(syncCompanyIds);
          if (!abortController.signal.aborted) {
            startTransition(() => setLiveExpenses(nextCachedExpenses));
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

    loadExpenses();

    return () => abortController.abort();
  }, [
    connections,
    syncConnections,
    granularity,
    refreshNonce,
    hasLoadedPersistedFilters,
    beginSync,
    startStep,
    advanceStep,
    completeStep,
    endSync
  ]);

  const hasLiveMode = connections.length > 0;
  const tagCategoryIndex = useTagCategoryIndex(connections, refreshNonce);
  const mockExpenses = useMemo(() => (hasLiveMode ? [] : getMockExpenses()), [hasLiveMode]);
  const expenses = hasLiveMode ? liveExpenses : mockExpenses;

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

  const effectiveFocusedTag =
    focusedTag && availableTagSet.has(focusedTag) ? focusedTag : null;

  const filterScopedExpenses = useMemo(
    () =>
      expenses.filter((expense) =>
        documentMatchesTagFilters(expense.tags, sanitizedCategoryFilters, null)
      ),
    [expenses, sanitizedCategoryFilters]
  );

  // Fokus štítku prispôsobí graf/KPI/doklady, ale zoznamy kategórií ostávajú podľa Filtra štítkov.
  // Pri aktívnych štítkoch sa sumy zúžia na ich rozúčtovanie — na doklade rozúčtovanom
  // na viac štítkov sa počíta len časť patriaca zvoleným štítkom.
  const tagScopedExpenses = useMemo(() => {
    const activeTags = [
      ...allSelectedTags(sanitizedCategoryFilters),
      ...(effectiveFocusedTag ? [effectiveFocusedTag] : [])
    ];
    const matching = expenses.filter((expense) =>
      documentMatchesTagFilters(expense.tags, sanitizedCategoryFilters, effectiveFocusedTag)
    );
    return scopeExpenseAmountsToTags(matching, activeTags);
  }, [expenses, sanitizedCategoryFilters, effectiveFocusedTag]);

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
    () => computeExpenseKpis(points, ytdTotals, dueWatchlist),
    [points, ytdTotals, dueWatchlist]
  );

  // Donut filtrujeme výberom z Filtra štítkov, ale nie focusnutým štítkom —
  // klik na výsek má slice len zvýrazniť, nie zredukovať donut na jediný výsek.
  const tagStructure = useMemo(() => {
    const slices = computeExpenseTagStructure(filterScopedExpenses, [], effectiveCompanies).filter(
      (slice) => isTagAllowedByFilters(slice.name, sanitizedCategoryFilters, tagCategoryIndex)
    );
    const total = slices.reduce((sum, slice) => sum + Math.max(slice.amount, 0), 0);
    return slices.map((slice) => ({
      ...slice,
      share: total === 0 ? 0 : Math.max(slice.amount, 0) / total
    }));
  }, [filterScopedExpenses, sanitizedCategoryFilters, effectiveCompanies, tagCategoryIndex]);

  const availableTagsData = useMemo(
    () => computeExpenseTagBreakdown(expenses, effectiveCompanies),
    [expenses, effectiveCompanies]
  );

  const tagsData = useMemo(() => {
    const filterPoints = computeExpenseTagBreakdown(filterScopedExpenses, effectiveCompanies).filter(
      (point) => isTagAllowedByFilters(point.name, sanitizedCategoryFilters, tagCategoryIndex)
    );
    if (!effectiveFocusedTag) {
      return filterPoints;
    }

    // V kategórii focusnutého štítku ostávajú sumy podľa Filtra štítkov;
    // ostatné kategórie sa prepočítajú podľa focusnutého štítku.
    const focusedCategory = categoryForTag(tagCategoryIndex, effectiveFocusedTag);
    const focusByName = new Map(
      computeExpenseTagBreakdown(tagScopedExpenses, effectiveCompanies).map((point) => [
        point.name,
        point
      ])
    );
    return filterPoints
      .flatMap((point) => {
        const category = categoryForTag(tagCategoryIndex, point.name);
        if (category === focusedCategory) return [point];
        const focusedPoint = focusByName.get(point.name);
        return focusedPoint ? [focusedPoint] : [];
      })
      .sort((a, b) => b.amount - a.amount);
  }, [
    filterScopedExpenses,
    tagScopedExpenses,
    effectiveCompanies,
    sanitizedCategoryFilters,
    tagCategoryIndex,
    effectiveFocusedTag
  ]);

  const vendors = useMemo(
    () => computeExpenseVendorBreakdown(tagScopedExpenses, [], effectiveCompanies),
    [tagScopedExpenses, effectiveCompanies]
  );

  const companiesData = useMemo(
    // Zoznam firiem sa nezužuje focusom — rovnako ako štítky v kategórii.
    () => computeExpenseCompanyBreakdown(tagScopedExpenses, [], selectedCompanies),
    [tagScopedExpenses, selectedCompanies]
  );

  const recentExpenses = useMemo(
    () =>
      getFilteredRecentExpenses(tagScopedExpenses, {
        granularity,
        selectedTags: [],
        selectedCompanies: effectiveCompanies,
        limit: 10
      }),
    [tagScopedExpenses, granularity, effectiveCompanies]
  );

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
      title="Výdavky"
      isSyncing={isLoadingLiveData}
      syncNote="Doklady ťaháme po mesiacoch a ku každému aj rozúčtovanie na štítky, preto prvé načítanie trvá dlhšie. Ostanú uložené v zariadení — pri ďalšom otvorení sa dosynchronizujú len zmeny."
      onRefresh={connections.length > 0 ? () => setRefreshNonce((value) => value + 1) : undefined}
    >
      {!hasLiveMode && !isLoadingConnections ? <DemoDataBanner /> : null}
      {companyFilter.noneAvailable ? <FilterMismatchNotice onShowAll={() => setSelectedCompanies([])} /> : null}
      <ExpensesDashboard
        granularity={granularity}
        onGranularityChange={setGranularity}
        kpis={kpis}
        points={points}
        expenses={tagScopedExpenses}
        tagStructure={tagStructure}
        dueWatchlist={dueWatchlist}
        selectedTags={[]}
        selectedCompanies={effectiveCompanies}
        activeTagLabel={effectiveFocusedTag ?? undefined}
        activeCompanyLabel={focusedCompany ?? undefined}
        onClearTagFilter={() => setFocusedTag(null)}
        onClearCompanyFilter={() => setFocusedCompany(null)}
        onFocusTag={setFocusedTag}
        isMockData={!hasLiveMode}
      />
      <CategorizedTagsDashboard
        tags={tagsData}
        availableTags={availableTagsData}
        categoryIndex={tagCategoryIndex}
        baseTitle="Výdavky podľa štítkov"
        ariaLabelPrefix="Filtrovať výdavky podľa štítku"
        categoryFilters={sanitizedCategoryFilters}
        focusedTag={effectiveFocusedTag}
        onCategoryFiltersChange={handleCategoryFiltersChange}
        onFocusedTagChange={setFocusedTag}
        invertDeltaColor
      />
      <ExpenseVendorsSection vendors={vendors} />
      <RecentExpensesSection expenses={recentExpenses} />
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
    </DashboardShell>
  );
}
