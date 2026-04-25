"use client";

import { useEffect, useMemo, useState } from "react";
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

declare global {
  var __krosDashboardLiveInvoicesCache: Map<string, LiveInvoicesCacheEntry> | undefined;
  var __krosDashboardGranularity: Granularity | undefined;
}

const liveInvoicesCache =
  globalThis.__krosDashboardLiveInvoicesCache ?? new Map<string, LiveInvoicesCacheEntry>();

globalThis.__krosDashboardLiveInvoicesCache = liveInvoicesCache;

function getLiveInvoicesCacheKey(connections: KrosConnection[], granularity: Granularity) {
  const connectionKey = connections
    .map((connection) => `${connection.companyId}:${connection.connectedAt}`)
    .sort()
    .join("|");

  return `${granularity}:${connectionKey}`;
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

  const effectiveTags = useMemo(
    () => (focusedTag ? [focusedTag] : selectedTags),
    [focusedTag, selectedTags]
  );
  const effectiveCompanies = useMemo(
    () => (focusedCompany ? [focusedCompany] : selectedCompanies),
    [focusedCompany, selectedCompanies]
  );

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
    if (connections.length === 0) {
      setLiveInvoices([]);
      return;
    }

    const abortController = new AbortController();
    const range = getDateRange(granularity);
    const cacheKey = getLiveInvoicesCacheKey(connections, granularity);
    const cachedEntry = liveInvoicesCache.get(cacheKey);
    const isManualRefresh = refreshNonce > 0;

    if (cachedEntry && !isManualRefresh) {
      setLiveInvoices(cachedEntry.invoices);
      setLastSyncedAt(cachedEntry.syncedAt);
      setIsLoadingLiveData(false);
      setLiveError(null);
      localStorage.setItem(LAST_SYNC_STORAGE_KEY, cachedEntry.syncedAt);
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
            companies: connections,
            issueDateFrom: range.fetchFrom,
            issueDateTo: range.fetchTo
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
        setLiveInvoices(normalizedInvoices);
        const syncedAt = new Date().toISOString();
        setLastSyncedAt(syncedAt);
        localStorage.setItem(LAST_SYNC_STORAGE_KEY, syncedAt);
        liveInvoicesCache.set(cacheKey, {
          invoices: normalizedInvoices,
          syncedAt
        });
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
          setIsLoadingLiveData(false);
        }
      }
    };

    loadInvoices();

    return () => abortController.abort();
  }, [connections, granularity, refreshNonce]);

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
