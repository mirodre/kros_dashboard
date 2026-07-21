"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { DashboardShell } from "@/components/dashboard-shell";
import { ExpensesDashboard } from "@/components/expenses-dashboard";
import { CategorizedTagsDashboard } from "@/components/categorized-tags-dashboard";
import { ExpenseVendorsSection } from "@/components/expense-vendors-section";
import { RecentExpensesSection } from "@/components/recent-expenses-section";
import { CompaniesDashboard } from "@/components/companies-dashboard";
import type { Granularity } from "@/lib/mock-data";
import type { KrosConnection, NormalizedExpense } from "@/lib/kros-types";
import { readConnections } from "@/lib/kros-storage";
import { useTagCategoryIndex } from "@/lib/use-tag-categories";
import {
  documentMatchesTagFilters,
  isTagAllowedByFilters,
  migrateFlatFiltersToCategories,
  parseStoredTagFilters,
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
  normalizeExpenses
} from "@/lib/expenses-live";
import { getDateRange } from "@/lib/dashboard-live";
import { getMockExpenses } from "@/lib/expenses-mock-data";
import {
  expenseCompanyMetaKey,
  expenseMonthMetaKey,
  getCachedExpenses,
  readExpenseSyncMeta,
  upsertCachedExpenses,
  writeExpenseSyncMeta
} from "@/lib/expense-cache";

const TAG_FILTER_STORAGE_KEY = "kros_dashboard_expenses_selected_tags";
const COMPANY_FILTER_STORAGE_KEY = "kros_dashboard_selected_companies";
const LAST_SYNC_STORAGE_KEY = "kros_dashboard_last_sync_at";

type LiveDataRange = "ytd" | "history";

declare global {
  // eslint-disable-next-line no-var -- globalThis typing requires `var`
  var __krosDashboardGranularity: Granularity | undefined;
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
  const ranges: { monthKey: string; from: string; to: string }[] = [];

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
  const [granularity, setGranularity] = useState<Granularity>(
    globalThis.__krosDashboardGranularity ?? "month"
  );
  const [categoryFilters, setCategoryFilters] = useState<TagCategoryFilters>({});
  const [focusedTag, setFocusedTag] = useState<string | null>(null);
  const [selectedCompanies, setSelectedCompanies] = useState<string[]>([]);
  const [focusedCompany, setFocusedCompany] = useState<string | null>(null);
  const [connections, setConnections] = useState<KrosConnection[]>([]);
  const [liveExpenses, setLiveExpenses] = useState<NormalizedExpense[]>([]);
  const [isLoadingLiveData, setIsLoadingLiveData] = useState(false);
  const [, setLiveError] = useState<string | null>(null);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [hasLoadedPersistedFilters, setHasLoadedPersistedFilters] = useState(false);
  const handledRefreshNonceRef = useRef(0);

  const effectiveCompanies = useMemo(
    () => (focusedCompany ? [focusedCompany] : selectedCompanies),
    [focusedCompany, selectedCompanies]
  );
  const syncConnections = useMemo(() => {
    if (selectedCompanies.length === 0) return connections;

    const selectedCompanySet = new Set(selectedCompanies);
    return connections.filter((connection) => selectedCompanySet.has(connection.companyName));
  }, [connections, selectedCompanies]);

  useEffect(() => {
    setConnections(readConnections());
  }, []);

  useEffect(() => {
    try {
      const rawTags = localStorage.getItem(TAG_FILTER_STORAGE_KEY);
      const rawCompanies = localStorage.getItem(COMPANY_FILTER_STORAGE_KEY);

      setCategoryFilters(parseStoredTagFilters(rawTags));

      if (rawCompanies) {
        const parsedCompanies = JSON.parse(rawCompanies) as string[];
        if (Array.isArray(parsedCompanies)) {
          setSelectedCompanies(parsedCompanies);
        }
      }
    } catch {
      // Ignore invalid persisted filter payload.
    } finally {
      setHasLoadedPersistedFilters(true);
    }
  }, []);

  useEffect(() => {
    if (!hasLoadedPersistedFilters) return;
    localStorage.setItem(TAG_FILTER_STORAGE_KEY, JSON.stringify(categoryFilters));
  }, [hasLoadedPersistedFilters, categoryFilters]);

  useEffect(() => {
    if (!hasLoadedPersistedFilters) return;
    localStorage.setItem(COMPANY_FILTER_STORAGE_KEY, JSON.stringify(selectedCompanies));
  }, [hasLoadedPersistedFilters, selectedCompanies]);

  useEffect(() => {
    globalThis.__krosDashboardGranularity = granularity;
  }, [granularity]);

  useEffect(() => {
    if (!hasLoadedPersistedFilters) return;

    if (connections.length === 0) {
      setLiveExpenses([]);
      return;
    }

    if (syncConnections.length === 0) {
      setLiveExpenses([]);
      setIsLoadingLiveData(false);
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
      companies: KrosConnection[];
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

      const payload = await response.json();
      if (!response.ok) {
        throw new Error(
          payload?.details
            ? `${payload?.error ?? "Nepodarilo sa načítať výdavky."} ${payload.details}`
            : payload?.error ?? "Nepodarilo sa načítať výdavky."
        );
      }
      if (Array.isArray(payload?.errors) && payload.errors.length > 0) {
        throw new Error(payload.errors[0]?.message ?? "Niektoré firmy sa nepodarilo načítať.");
      }
      return Array.isArray(payload?.data) ? (payload.data as unknown[]) : [];
    };

    const loadExpenses = async () => {
      const cachedExpenses = await getCachedExpenses(syncCompanyIds);
      if (!abortController.signal.aborted) {
        setLiveExpenses(cachedExpenses);
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

        for (const connection of syncConnections) {
          const missingMonthRanges = [];
          for (const monthRange of monthRanges) {
            const monthMeta = await readExpenseSyncMeta(
              expenseMonthMetaKey(connection.companyId, liveDataRange, monthRange.monthKey)
            );
            if (!monthMeta?.completedAt) {
              missingMonthRanges.push(monthRange);
            }
          }

          if (missingMonthRanges.length > 0) {
            setIsLoadingLiveData(true);
            for (const monthRange of missingMonthRanges) {
              if (abortController.signal.aborted) return;

              await clearSyncLogsOnce();
              const rawExpenses = await fetchExpenses({
                companies: [connection],
                deliveryDateFrom: monthRange.from,
                deliveryDateTo: monthRange.to
              });

              const normalizedExpenses = normalizeExpenses(rawExpenses);
              const companyExpenses = normalizedExpenses.filter(
                (expense) =>
                  expense.companyId === connection.companyId || expense.companyName === connection.companyName
              );
              const completedAt = new Date().toISOString();
              await upsertCachedExpenses(connection.companyId, companyExpenses);
              await writeExpenseSyncMeta({
                key: expenseMonthMetaKey(connection.companyId, liveDataRange, monthRange.monthKey),
                companyId: connection.companyId,
                range: liveDataRange,
                monthKey: monthRange.monthKey,
                completedAt
              });

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
              const nextCachedExpenses = await getCachedExpenses(syncCompanyIds);
              if (!abortController.signal.aborted) {
                setLiveExpenses(nextCachedExpenses);
              }
            }

            continue;
          }

          if (isManualRefresh) {
            const companyMetaKey = expenseCompanyMetaKey(connection.companyId, liveDataRange);
            const companyMeta = await readExpenseSyncMeta(companyMetaKey);
            if (!companyMeta?.lastModifiedTimestamp) continue;

            setIsLoadingLiveData(true);
            await clearSyncLogsOnce();
            const rawExpenses = await fetchExpenses({
              companies: [connection],
              lastModifiedTimestamp: withLastModifiedOverlap(companyMeta.lastModifiedTimestamp)
            });

            const normalizedExpenses = normalizeExpenses(rawExpenses);
            const companyExpenses = normalizedExpenses.filter(
              (expense) =>
                expense.companyId === connection.companyId || expense.companyName === connection.companyName
            );
            const syncedAt = new Date().toISOString();
            await upsertCachedExpenses(connection.companyId, companyExpenses);
            await writeExpenseSyncMeta({
              key: companyMetaKey,
              companyId: connection.companyId,
              range: liveDataRange,
              completedAt: syncedAt,
              lastModifiedTimestamp: getMaxLastModified(companyExpenses, companyMeta.lastModifiedTimestamp)
            });
            didFetch = true;
            const nextCachedExpenses = await getCachedExpenses(syncCompanyIds);
            if (!abortController.signal.aborted) {
              setLiveExpenses(nextCachedExpenses);
            }
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
        }
      }
    };

    loadExpenses();

    return () => abortController.abort();
  }, [connections, syncConnections, granularity, refreshNonce, hasLoadedPersistedFilters]);

  const hasLiveMode = connections.length > 0;
  const tagCategoryIndex = useTagCategoryIndex(connections, refreshNonce);
  const mockExpenses = useMemo(() => (hasLiveMode ? [] : getMockExpenses()), [hasLiveMode]);
  const expenses = hasLiveMode ? liveExpenses : mockExpenses;

  useEffect(() => {
    setCategoryFilters((prev) => migrateFlatFiltersToCategories(prev, tagCategoryIndex));
  }, [tagCategoryIndex]);

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

  const tagScopedExpenses = useMemo(
    () =>
      expenses.filter((expense) =>
        documentMatchesTagFilters(expense.tags, sanitizedCategoryFilters, effectiveFocusedTag)
      ),
    [expenses, sanitizedCategoryFilters, effectiveFocusedTag]
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
    () => computeExpenseKpis(points, ytdTotals, dueWatchlist),
    [points, ytdTotals, dueWatchlist]
  );

  // Donut filtrujeme výberom z Filtra štítkov, ale nie focusnutým štítkom —
  // klik na výsek má slice len zvýrazniť, nie zredukovať donut na jediný výsek.
  const tagStructure = useMemo(() => {
    const scopedForStructure = expenses.filter((expense) =>
      documentMatchesTagFilters(expense.tags, sanitizedCategoryFilters, null)
    );
    const slices = computeExpenseTagStructure(scopedForStructure, [], effectiveCompanies).filter(
      (slice) => isTagAllowedByFilters(slice.name, sanitizedCategoryFilters, tagCategoryIndex)
    );
    const total = slices.reduce((sum, slice) => sum + Math.max(slice.amount, 0), 0);
    return slices.map((slice) => ({
      ...slice,
      share: total === 0 ? 0 : Math.max(slice.amount, 0) / total
    }));
  }, [expenses, sanitizedCategoryFilters, effectiveCompanies, tagCategoryIndex]);

  const availableTagsData = useMemo(
    () => computeExpenseTagBreakdown(expenses, effectiveCompanies),
    [expenses, effectiveCompanies]
  );

  const tagsData = useMemo(
    () =>
      computeExpenseTagBreakdown(tagScopedExpenses, effectiveCompanies).filter((point) =>
        isTagAllowedByFilters(point.name, sanitizedCategoryFilters, tagCategoryIndex)
      ),
    [tagScopedExpenses, effectiveCompanies, sanitizedCategoryFilters, tagCategoryIndex]
  );

  const vendors = useMemo(
    () => computeExpenseVendorBreakdown(tagScopedExpenses, [], effectiveCompanies),
    [tagScopedExpenses, effectiveCompanies]
  );

  const companiesData = useMemo(
    () => computeExpenseCompanyBreakdown(tagScopedExpenses, [], effectiveCompanies),
    [tagScopedExpenses, effectiveCompanies]
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
      onRefresh={connections.length > 0 ? () => setRefreshNonce((value) => value + 1) : undefined}
    >
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
        isLoading={isLoadingLiveData}
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
        isLoading={isLoadingLiveData}
        invertDeltaColor
      />
      <ExpenseVendorsSection vendors={vendors} isLoading={isLoadingLiveData} />
      <RecentExpensesSection expenses={recentExpenses} isLoading={isLoadingLiveData} />
      <CompaniesDashboard
        title="Výdavky podľa firiem"
        companies={companiesData}
        selectedCompanies={selectedCompanies}
        availableCompanyNames={
          connections.length > 0 ? connections.map((connection) => connection.companyName) : undefined
        }
        invertDeltaColor
        collapsedStorageKey="kros_dashboard_expenses_collapsed_companies"
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
        isLoading={isLoadingLiveData}
      />
    </DashboardShell>
  );
}
