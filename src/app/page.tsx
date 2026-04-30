"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { DashboardShell } from "@/components/dashboard-shell";
import { RevenueDashboard } from "@/components/revenue-dashboard";
import { TagsDashboard } from "@/components/tags-dashboard";
import { CompaniesDashboard } from "@/components/companies-dashboard";
import {
  getCompaniesBreakdown,
  getRevenueChartPointsByTags,
  getTagsBreakdown,
  type Granularity
} from "@/lib/mock-data";
import {
  computeCompanyBreakdown,
  computeComparableYtdTotals,
  getDateRange,
  computeKpis,
  computeRevenueSeries,
  computeTagBreakdown,
  normalizeInvoices
} from "@/lib/dashboard-live";
import {
  readConnections,
} from "@/lib/kros-storage";
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

const TAG_FILTER_STORAGE_KEY = "kros_dashboard_selected_tags";
const COMPANY_FILTER_STORAGE_KEY = "kros_dashboard_selected_companies";
const LAST_SYNC_STORAGE_KEY = "kros_dashboard_last_sync_at";

type LiveDataRange = "ytd" | "history";

declare global {
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

function getMaxLastModified(invoices: NormalizedInvoice[], fallback?: string) {
  return invoices.reduce<string | undefined>((max, invoice) => {
    if (!invoice.lastModifiedTimestamp) return max;
    if (!max) return invoice.lastModifiedTimestamp;
    return new Date(invoice.lastModifiedTimestamp).getTime() > new Date(max).getTime()
      ? invoice.lastModifiedTimestamp
      : max;
  }, fallback);
}

function withOverlap(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  date.setMinutes(date.getMinutes() - 5);
  return date.toISOString();
}

export default function HomePage() {
  const [granularity, setGranularity] = useState<Granularity>(
    globalThis.__krosDashboardGranularity ?? "month"
  );
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [focusedTag, setFocusedTag] = useState<string | null>(null);
  const [selectedCompanies, setSelectedCompanies] = useState<string[]>([]);
  const [focusedCompany, setFocusedCompany] = useState<string | null>(null);
  const [connections, setConnections] = useState<KrosConnection[]>([]);
  const [liveInvoices, setLiveInvoices] = useState<NormalizedInvoice[]>([]);
  const [isLoadingLiveData, setIsLoadingLiveData] = useState(false);
  const [liveError, setLiveError] = useState<string | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [hasLoadedPersistedFilters, setHasLoadedPersistedFilters] = useState(false);
  const handledRefreshNonceRef = useRef(0);

  const effectiveTags = useMemo(
    () => (focusedTag ? [focusedTag] : selectedTags),
    [focusedTag, selectedTags]
  );
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
    const storedConnections = readConnections();
    setConnections(storedConnections);
    setLastSyncedAt(localStorage.getItem(LAST_SYNC_STORAGE_KEY));
  }, []);

  useEffect(() => {
    try {
      const rawTags = localStorage.getItem(TAG_FILTER_STORAGE_KEY);
      const rawCompanies = localStorage.getItem(COMPANY_FILTER_STORAGE_KEY);

      if (rawTags) {
        const parsedTags = JSON.parse(rawTags) as string[];
        if (Array.isArray(parsedTags)) {
          setSelectedTags(parsedTags);
        }
      }

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
    localStorage.setItem(TAG_FILTER_STORAGE_KEY, JSON.stringify(selectedTags));
  }, [hasLoadedPersistedFilters, selectedTags]);

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
      setLiveInvoices([]);
      return;
    }

    if (syncConnections.length === 0) {
      setLiveInvoices([]);
      setIsLoadingLiveData(false);
      return;
    }

    const abortController = new AbortController();
    const liveDataRange = getLiveDataRange(granularity);
    const fetchRange = getDateRange(liveDataRange === "history" ? "year" : "month");
    const isManualRefresh = refreshNonce !== handledRefreshNonceRef.current;
    const syncCompanyIds = syncConnections.map((connection) => connection.companyId);

    const loadInvoices = async () => {
      const cachedInvoices = await getCachedInvoices(syncCompanyIds);
      if (!abortController.signal.aborted) {
        setLiveInvoices(cachedInvoices);
      }

      setLiveError(null);

      try {
        const monthRanges = buildMonthSyncRanges(fetchRange.fetchFrom, fetchRange.fetchTo);
        let didFetch = false;

        for (const connection of syncConnections) {
          const missingMonthRanges = [];
          for (const monthRange of monthRanges) {
            const monthMeta = await readSyncMeta(
              syncMonthMetaKey(connection.companyId, liveDataRange, monthRange.monthKey)
            );
            if (!monthMeta?.completedAt) {
              missingMonthRanges.push(monthRange);
            }
          }

          if (missingMonthRanges.length > 0) {
            setIsLoadingLiveData(true);
            for (const monthRange of missingMonthRanges) {
              if (abortController.signal.aborted) return;

              const response = await fetch("/api/kros/invoices", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  companies: [connection],
                  issueDateFrom: monthRange.from,
                  issueDateTo: monthRange.to
                }),
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

              const normalizedInvoices = normalizeInvoices(Array.isArray(payload?.data) ? payload.data : []);
              const companyInvoices = normalizedInvoices.filter(
                (invoice) => invoice.companyId === connection.companyId || invoice.companyName === connection.companyName
              );
              const completedAt = new Date().toISOString();
              await upsertCachedInvoices(connection.companyId, companyInvoices);
              await writeSyncMeta({
                key: syncMonthMetaKey(connection.companyId, liveDataRange, monthRange.monthKey),
                companyId: connection.companyId,
                range: liveDataRange,
                monthKey: monthRange.monthKey,
                completedAt
              });

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
              const nextCachedInvoices = await getCachedInvoices(syncCompanyIds);
              if (!abortController.signal.aborted) {
                setLiveInvoices(nextCachedInvoices);
              }
            }

            continue;
          }

          if (isManualRefresh) {
            const companyMetaKey = syncCompanyMetaKey(connection.companyId, liveDataRange);
            const companyMeta = await readSyncMeta(companyMetaKey);
            if (!companyMeta?.lastModifiedTimestamp) continue;

            setIsLoadingLiveData(true);
            const response = await fetch("/api/kros/invoices", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                companies: [connection],
                lastModifiedTimestampFrom: withOverlap(companyMeta.lastModifiedTimestamp)
              }),
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

            const normalizedInvoices = normalizeInvoices(Array.isArray(payload?.data) ? payload.data : []);
            const companyInvoices = normalizedInvoices.filter(
              (invoice) => invoice.companyId === connection.companyId || invoice.companyName === connection.companyName
            );
            const syncedAt = new Date().toISOString();
            await upsertCachedInvoices(connection.companyId, companyInvoices);
            await writeSyncMeta({
              key: companyMetaKey,
              companyId: connection.companyId,
              range: liveDataRange,
              completedAt: syncedAt,
              lastModifiedTimestamp: getMaxLastModified(companyInvoices, companyMeta.lastModifiedTimestamp)
            });
            didFetch = true;
            const nextCachedInvoices = await getCachedInvoices(syncCompanyIds);
            if (!abortController.signal.aborted) {
              setLiveInvoices(nextCachedInvoices);
            }
          }
        }

        if (didFetch) {
          const syncedAt = new Date().toISOString();
          setLastSyncedAt(syncedAt);
          localStorage.setItem(LAST_SYNC_STORAGE_KEY, syncedAt);
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

    loadInvoices();

    return () => abortController.abort();
  }, [connections, syncConnections, granularity, refreshNonce, hasLoadedPersistedFilters]);

  const hasLiveMode = connections.length > 0;
  const revenueData = useMemo(() => {
    if (hasLiveMode) {
      return computeRevenueSeries({
        invoices: liveInvoices,
        granularity,
        selectedTags: effectiveTags,
        selectedCompanies: effectiveCompanies
      });
    }
    return getRevenueChartPointsByTags(granularity, effectiveTags, effectiveCompanies);
  }, [hasLiveMode, liveInvoices, granularity, effectiveTags, effectiveCompanies]);

  const ytdTotals = useMemo(() => {
    if (!hasLiveMode) return undefined;
    return computeComparableYtdTotals({
      invoices: liveInvoices,
      selectedTags: effectiveTags,
      selectedCompanies: effectiveCompanies
    });
  }, [hasLiveMode, liveInvoices, effectiveTags, effectiveCompanies]);

  const kpis = useMemo(() => computeKpis(revenueData, ytdTotals), [revenueData, ytdTotals]);

  const tagsData = useMemo(() => {
    if (hasLiveMode) return computeTagBreakdown(liveInvoices, effectiveCompanies);
    return getTagsBreakdown(granularity);
  }, [hasLiveMode, liveInvoices, effectiveCompanies, granularity]);

  const companiesData = useMemo(() => {
    if (hasLiveMode) return computeCompanyBreakdown(liveInvoices, effectiveTags);
    return getCompaniesBreakdown(granularity);
  }, [hasLiveMode, liveInvoices, effectiveTags, granularity]);

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
      lastSyncedAt={lastSyncedAt}
      isSyncing={isLoadingLiveData}
      onRefresh={connections.length > 0 ? () => setRefreshNonce((value) => value + 1) : undefined}
    >
      <RevenueDashboard
        granularity={granularity}
        onGranularityChange={setGranularity}
        kpis={kpis}
        points={revenueData}
        onClearTagFilter={() => setFocusedTag(null)}
        activeTagLabel={focusedTag ?? undefined}
        onClearCompanyFilter={() => setFocusedCompany(null)}
        activeCompanyLabel={focusedCompany ?? undefined}
        isLoading={isLoadingLiveData}
      />
      <TagsDashboard
        tags={tagsData}
        selectedTags={selectedTags}
        focusedTag={focusedTag}
        onSelectionChange={(tags) =>
          updateSelectionWithFocusedGuard(tags, focusedTag, setSelectedTags, setFocusedTag)
        }
        onFocusedTagChange={setFocusedTag}
        isLoading={isLoadingLiveData}
      />
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
        isLoading={isLoadingLiveData}
      />
    </DashboardShell>
  );
}
