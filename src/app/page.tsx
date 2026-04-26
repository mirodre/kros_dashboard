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

const TAG_FILTER_STORAGE_KEY = "kros_dashboard_selected_tags";
const COMPANY_FILTER_STORAGE_KEY = "kros_dashboard_selected_companies";
const LAST_SYNC_STORAGE_KEY = "kros_dashboard_last_sync_at";

type LiveInvoicesCacheEntry = {
  invoices: NormalizedInvoice[];
  syncedAt: string;
};

type LiveDataRange = "ytd" | "history";

declare global {
  var __krosDashboardCompanyInvoicesCache: Map<string, LiveInvoicesCacheEntry> | undefined;
  var __krosDashboardGranularity: Granularity | undefined;
}

const companyInvoicesCache =
  globalThis.__krosDashboardCompanyInvoicesCache ?? new Map<string, LiveInvoicesCacheEntry>();

globalThis.__krosDashboardCompanyInvoicesCache = companyInvoicesCache;

function getCompanyCacheKey(connection: KrosConnection, range: LiveDataRange) {
  return `${range}:${connection.companyId}:${connection.connectedAt}`;
}

function getLiveDataRange(granularity: Granularity): LiveDataRange {
  return granularity === "year" ? "history" : "ytd";
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
    const cachedEntries = syncConnections
      .map((connection) => {
        const rangeEntry = companyInvoicesCache.get(getCompanyCacheKey(connection, liveDataRange));
        const historyEntry =
          liveDataRange === "ytd"
            ? companyInvoicesCache.get(getCompanyCacheKey(connection, "history"))
            : undefined;
        return rangeEntry ?? historyEntry;
      });
    const missingConnections = isManualRefresh
      ? syncConnections
      : syncConnections.filter((_, index) => !cachedEntries[index]);
    const cachedInvoices = cachedEntries.flatMap((entry) => entry?.invoices ?? []);
    const latestCachedSync = cachedEntries
      .map((entry) => entry?.syncedAt)
      .filter((value): value is string => Boolean(value))
      .sort()
      .at(-1);

    if (missingConnections.length === 0 && !isManualRefresh) {
      setLiveInvoices(cachedInvoices);
      if (latestCachedSync) {
        setLastSyncedAt(latestCachedSync);
        localStorage.setItem(LAST_SYNC_STORAGE_KEY, latestCachedSync);
      }
      setIsLoadingLiveData(false);
      setLiveError(null);
      return;
    }

    const loadInvoices = async () => {
      setIsLoadingLiveData(true);
      setLiveError(null);

      try {
        const response = await fetch("/api/kros/invoices", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            companies: missingConnections,
            issueDateFrom: fetchRange.fetchFrom,
            issueDateTo: fetchRange.fetchTo
          }),
          signal: abortController.signal
        });

        const payload = await response.json();
        if (!response.ok) {
          throw new Error(
            payload?.details ? `${payload?.error ?? "Nepodarilo sa načítať faktúry."} ${payload.details}` : payload?.error ?? "Nepodarilo sa načítať faktúry."
          );
        }

        const normalizedInvoices = normalizeInvoices(Array.isArray(payload?.data) ? payload.data : []);
        const syncedAt = new Date().toISOString();
        for (const connection of missingConnections) {
          const companyInvoices = normalizedInvoices.filter(
            (invoice) => invoice.companyName === connection.companyName
          );
          companyInvoicesCache.set(getCompanyCacheKey(connection, liveDataRange), {
            invoices: companyInvoices,
            syncedAt
          });
        }

        const nextInvoices = syncConnections.flatMap((connection) => {
          const rangeEntry = companyInvoicesCache.get(getCompanyCacheKey(connection, liveDataRange));
          const historyEntry =
            liveDataRange === "ytd"
              ? companyInvoicesCache.get(getCompanyCacheKey(connection, "history"))
              : undefined;
          return (rangeEntry ?? historyEntry)?.invoices ?? [];
        });

        setLiveInvoices(nextInvoices);
        setLastSyncedAt(syncedAt);
        localStorage.setItem(LAST_SYNC_STORAGE_KEY, syncedAt);
        if (Array.isArray(payload?.errors) && payload.errors.length > 0) {
          setLiveError(
            `Niektoré firmy sa nepodarilo načítať (${payload.errors.length}). Zobrazujú sa dostupné dáta.`
          );
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
