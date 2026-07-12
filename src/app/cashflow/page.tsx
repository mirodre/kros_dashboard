"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CashflowDashboard } from "@/components/cashflow-dashboard";
import { CompaniesDashboard } from "@/components/companies-dashboard";
import { DashboardShell } from "@/components/dashboard-shell";
import { CASHFLOW_MOCK_COMPANIES, getCashflowOverview } from "@/lib/cashflow-mock-data";
import {
  computeCashflowOverviewFromLiveData,
  normalizePaymentAccounts,
  normalizePaymentTransactions
} from "@/lib/cashflow-live";
import { CASHFLOW_LIVE_CACHE_KEY } from "@/lib/cashflow-live-cache";
import { readConnections } from "@/lib/kros-storage";
import type {
  KrosConnection,
  NormalizedPaymentAccount,
  NormalizedPaymentTransaction
} from "@/lib/kros-types";
import type { Granularity } from "@/lib/mock-data";

const COMPANY_FILTER_STORAGE_KEY = "kros_dashboard_selected_companies";

type CashflowLiveCachePayload = {
  companyIds: number[];
  accounts: NormalizedPaymentAccount[];
  transactions: NormalizedPaymentTransaction[];
  /** Max `lastModifiedTimestamp` per firma – rovnaká logika ako sync meta v module Biznis. */
  lastModifiedByCompanyId?: Record<string, string>;
  savedAt: string;
};

declare global {
  var __krosDashboardGranularity: Granularity | undefined;
  var __krosCashflowLiveCache: CashflowLiveCachePayload | undefined;
}

function getMaxLastModified(transactions: NormalizedPaymentTransaction[], fallback?: string) {
  return transactions.reduce<string | undefined>((max, transaction) => {
    if (!transaction.lastModifiedTimestamp) return max;
    if (!max) return transaction.lastModifiedTimestamp;
    return new Date(transaction.lastModifiedTimestamp).getTime() > new Date(max).getTime()
      ? transaction.lastModifiedTimestamp
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

function transactionMergeKey(transaction: NormalizedPaymentTransaction) {
  return `${transaction.companyId ?? transaction.companyName}:${transaction.id}`;
}

export default function CashflowPage() {
  const [granularity, setGranularity] = useState<Granularity>(
    globalThis.__krosDashboardGranularity ?? "month"
  );
  const [selectedCompanies, setSelectedCompanies] = useState<string[]>([]);
  const [focusedCompany, setFocusedCompany] = useState<string | null>(null);
  const [connections, setConnections] = useState<KrosConnection[]>([]);
  const [hasLoadedPersistedFilters, setHasLoadedPersistedFilters] = useState(false);
  const [liveAccounts, setLiveAccounts] = useState<NormalizedPaymentAccount[]>([]);
  const [liveTransactions, setLiveTransactions] = useState<NormalizedPaymentTransaction[]>([]);
  const [liveError, setLiveError] = useState<string | null>(null);
  const [isLoadingLiveData, setIsLoadingLiveData] = useState(false);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [hasHydratedLiveCache, setHasHydratedLiveCache] = useState(false);
  const lastLiveScopeKeyRef = useRef("");
  const handledRefreshNonceRef = useRef(0);
  const lastModifiedByCompanyRef = useRef<Record<string, string>>({});

  const preferredCompanyNames = useMemo(
    () =>
      connections.length
        ? connections.map((connection) => connection.companyName)
        : CASHFLOW_MOCK_COMPANIES,
    [connections]
  );

  const preferredCompanySet = useMemo(() => new Set(preferredCompanyNames), [preferredCompanyNames]);

  const normalizedSelectedCompanies = useMemo(
    () => selectedCompanies.filter((companyName) => preferredCompanySet.has(companyName)),
    [selectedCompanies, preferredCompanySet]
  );

  const effectiveCompanies = useMemo(() => {
    if (focusedCompany && preferredCompanySet.has(focusedCompany)) return [focusedCompany];
    return normalizedSelectedCompanies;
  }, [focusedCompany, normalizedSelectedCompanies, preferredCompanySet]);

  /**
   * Same idea as Biznis: empty selection = all connected companies; otherwise only selected names.
   * If the user has a non-empty persisted selection but no name matches current connections, sync nothing
   * (do not fall back to loading every firm).
   */
  const syncConnections = useMemo(() => {
    if (selectedCompanies.length === 0) return connections;
    if (normalizedSelectedCompanies.length === 0) return [];
    const selectedSet = new Set(normalizedSelectedCompanies);
    return connections.filter((connection) => selectedSet.has(connection.companyName));
  }, [connections, selectedCompanies, normalizedSelectedCompanies]);

  useEffect(() => {
    setConnections(readConnections());
  }, []);

  useEffect(() => {
    try {
      const rawCompanies = localStorage.getItem(COMPANY_FILTER_STORAGE_KEY);
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
    localStorage.setItem(COMPANY_FILTER_STORAGE_KEY, JSON.stringify(selectedCompanies));
  }, [hasLoadedPersistedFilters, selectedCompanies]);

  useEffect(() => {
    globalThis.__krosDashboardGranularity = granularity;
  }, [granularity]);

  useEffect(() => {
    if (!hasLoadedPersistedFilters) return;
    if (connections.length === 0) {
      setHasHydratedLiveCache(true);
      return;
    }

    const scopeIds = syncConnections.map((connection) => connection.companyId).sort((a, b) => a - b);
    const scopeKey = scopeIds.join("|");
    try {
      const memoryCache = globalThis.__krosCashflowLiveCache;
      if (memoryCache) {
        const cachedIds = Array.isArray(memoryCache.companyIds)
          ? memoryCache.companyIds.slice().sort((a, b) => a - b)
          : [];
        const hasSameScope =
          cachedIds.length === scopeIds.length &&
          cachedIds.every((id, index) => id === scopeIds[index]);
        if (
          hasSameScope &&
          Array.isArray(memoryCache.accounts) &&
          Array.isArray(memoryCache.transactions)
        ) {
          setLiveAccounts(memoryCache.accounts);
          setLiveTransactions(memoryCache.transactions);
          setLiveError(null);
          lastLiveScopeKeyRef.current = scopeKey;
          lastModifiedByCompanyRef.current = memoryCache.lastModifiedByCompanyId ?? {};
          setHasHydratedLiveCache(true);
          return;
        }
      }

      const rawCache = sessionStorage.getItem(CASHFLOW_LIVE_CACHE_KEY);
      if (!rawCache) {
        setHasHydratedLiveCache(true);
        return;
      }

      const parsed = JSON.parse(rawCache) as CashflowLiveCachePayload;
      const cachedIds = Array.isArray(parsed?.companyIds)
        ? parsed.companyIds.slice().sort((a, b) => a - b)
        : [];
      const hasSameScope =
        cachedIds.length === scopeIds.length &&
        cachedIds.every((id, index) => id === scopeIds[index]);
      if (!hasSameScope) {
        setHasHydratedLiveCache(true);
        return;
      }

      if (Array.isArray(parsed?.accounts) && Array.isArray(parsed?.transactions)) {
        setLiveAccounts(parsed.accounts);
        setLiveTransactions(parsed.transactions);
        setLiveError(null);
        globalThis.__krosCashflowLiveCache = parsed;
        lastLiveScopeKeyRef.current = scopeKey;
        lastModifiedByCompanyRef.current = parsed.lastModifiedByCompanyId ?? {};
      }
    } catch {
      // Ignore invalid cache payload.
    } finally {
      setHasHydratedLiveCache(true);
    }
  }, [connections, hasLoadedPersistedFilters, syncConnections]);

  useEffect(() => {
    if (!hasHydratedLiveCache) return;
    if (connections.length === 0) {
      setLiveAccounts([]);
      setLiveTransactions([]);
      setLiveError(null);
      lastLiveScopeKeyRef.current = "";
      lastModifiedByCompanyRef.current = {};
      return;
    }

    if (syncConnections.length === 0) {
      setLiveAccounts([]);
      setLiveTransactions([]);
      setLiveError(null);
      lastLiveScopeKeyRef.current = "";
      lastModifiedByCompanyRef.current = {};
      setIsLoadingLiveData(false);
      return;
    }

    const scopeKey = syncConnections.map((c) => c.companyId).sort((a, b) => a - b).join("|");
    // Keep dashboard loaded between menu switches and re-fetch only on manual pull-to-refresh,
    // or when the set of firms to sync (company filter) changes.
    const isManualRefresh = refreshNonce !== handledRefreshNonceRef.current;
    const hasCachedLiveData = liveAccounts.length > 0 || liveTransactions.length > 0;
    if (!isManualRefresh && hasCachedLiveData && lastLiveScopeKeyRef.current === scopeKey) {
      return;
    }

    // Same as Biznis: a manual refresh over an already synced scope only pulls payments
    // changed since the stored per-company LastModifiedTimestamp and merges them into cache.
    const isIncrementalRefresh =
      isManualRefresh && hasCachedLiveData && lastLiveScopeKeyRef.current === scopeKey;

    const companyScope = syncConnections;

    const abortController = new AbortController();
    setIsLoadingLiveData(true);
    setLiveError(null);

    const fetchPayments = async (body: {
      companies: KrosConnection[];
      lastModifiedTimestamp?: string;
    }) => {
      const response = await fetch("/api/kros/payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: abortController.signal
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error("Nepodarilo sa načítať payments dáta.");
      }
      if (Array.isArray(payload?.errors) && payload.errors.length > 0) {
        throw new Error(payload.errors[0]?.message ?? "Niektoré firmy sa nepodarilo načítať.");
      }
      return Array.isArray(payload?.data) ? (payload.data as unknown[]) : [];
    };

    const loadLivePayments = async () => {
      try {
        const accountsResponse = await fetch("/api/kros/payments/accounts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ companies: companyScope }),
          signal: abortController.signal
        });
        const accountsPayload = await accountsResponse.json();
        if (!accountsResponse.ok) {
          throw new Error("Nepodarilo sa načítať payments dáta.");
        }

        const normalizedAccounts = normalizePaymentAccounts(
          Array.isArray(accountsPayload?.data) ? accountsPayload.data : []
        );
        const accountById = new Map(normalizedAccounts.map((account) => [account.id, account]));

        const nextLastModified: Record<string, string> = {};
        let normalizedTransactions: NormalizedPaymentTransaction[];

        if (isIncrementalRefresh) {
          const merged = new Map(
            liveTransactions.map((transaction) => [transactionMergeKey(transaction), transaction])
          );

          for (const connection of companyScope) {
            if (abortController.signal.aborted) return;

            const previousLastModified =
              lastModifiedByCompanyRef.current[String(connection.companyId)];
            const rawPayments = await fetchPayments({
              companies: [connection],
              ...(previousLastModified
                ? { lastModifiedTimestamp: withLastModifiedOverlap(previousLastModified) }
                : {})
            });
            const incoming = normalizePaymentTransactions(rawPayments, accountById).filter(
              (transaction) =>
                transaction.companyId === connection.companyId ||
                transaction.companyName === connection.companyName
            );
            for (const transaction of incoming) {
              merged.set(transactionMergeKey(transaction), transaction);
            }

            const maxLastModified = getMaxLastModified(incoming, previousLastModified);
            if (maxLastModified) {
              nextLastModified[String(connection.companyId)] = maxLastModified;
            }
          }

          normalizedTransactions = Array.from(merged.values());
        } else {
          const rawPayments = await fetchPayments({ companies: companyScope });
          normalizedTransactions = normalizePaymentTransactions(rawPayments, accountById);

          for (const connection of companyScope) {
            const companyTransactions = normalizedTransactions.filter(
              (transaction) =>
                transaction.companyId === connection.companyId ||
                transaction.companyName === connection.companyName
            );
            const maxLastModified = getMaxLastModified(companyTransactions);
            if (maxLastModified) {
              nextLastModified[String(connection.companyId)] = maxLastModified;
            }
          }
        }

        if (!abortController.signal.aborted) {
          setLiveAccounts(normalizedAccounts);
          setLiveTransactions(normalizedTransactions);
          setLiveError(null);
          lastLiveScopeKeyRef.current = scopeKey;
          lastModifiedByCompanyRef.current = nextLastModified;
          try {
            const payload: CashflowLiveCachePayload = {
              companyIds: companyScope.map((connection) => connection.companyId),
              accounts: normalizedAccounts,
              transactions: normalizedTransactions,
              lastModifiedByCompanyId: nextLastModified,
              savedAt: new Date().toISOString()
            };
            globalThis.__krosCashflowLiveCache = payload;
            sessionStorage.setItem(CASHFLOW_LIVE_CACHE_KEY, JSON.stringify(payload));
          } catch {
            // Ignore cache write failures.
          }
        }
      } catch (error) {
        if (!abortController.signal.aborted) {
          setLiveError(error instanceof Error ? error.message : "Nepodarilo sa načítať payments dáta.");
          if (!isIncrementalRefresh) {
            setLiveAccounts([]);
            setLiveTransactions([]);
            lastLiveScopeKeyRef.current = "";
            lastModifiedByCompanyRef.current = {};
          }
        }
      } finally {
        if (!abortController.signal.aborted) {
          handledRefreshNonceRef.current = refreshNonce;
          setIsLoadingLiveData(false);
        }
      }
    };

    loadLivePayments();
    return () => {
      abortController.abort();
    };
  }, [
    connections,
    syncConnections,
    liveAccounts.length,
    liveTransactions,
    refreshNonce,
    hasHydratedLiveCache
  ]);

  const hasLiveData = liveAccounts.length > 0 || liveTransactions.length > 0;
  const liveOverview = useMemo(
    () =>
      hasLiveData
        ? computeCashflowOverviewFromLiveData({
            accounts: liveAccounts,
            transactions: liveTransactions,
            granularity,
            selectedCompanies: effectiveCompanies,
            allowedCompanyIds: syncConnections.map((connection) => connection.companyId)
          })
        : null,
    [hasLiveData, liveAccounts, liveTransactions, granularity, effectiveCompanies, syncConnections]
  );

  const mockOverview = useMemo(
    () => getCashflowOverview(granularity, effectiveCompanies),
    [granularity, effectiveCompanies]
  );
  const overview = liveOverview ?? mockOverview;

  const availableCompanyNames = connections.length
    ? connections.map((connection) => connection.companyName)
    : overview.availableCompanyNames;

  const filteredCompanies = useMemo(() => {
    if (availableCompanyNames.length === 0) return overview.companyBreakdown;
    const availableSet = new Set(availableCompanyNames);
    return overview.companyBreakdown.filter((company) => availableSet.has(company.name));
  }, [availableCompanyNames, overview.companyBreakdown]);

  const updateSelectionWithFocusedGuard = (nextSelection: string[]) => {
    setSelectedCompanies(nextSelection);
    if (focusedCompany && !nextSelection.includes(focusedCompany)) {
      setFocusedCompany(null);
    }
  };

  const shouldShowMockData = connections.length === 0 || (!!liveError && !hasLiveData);

  return (
    <DashboardShell
      title="Peňažný prehľad"
      isSyncing={isLoadingLiveData}
      onRefresh={connections.length > 0 ? () => setRefreshNonce((value) => value + 1) : undefined}
    >
      <CashflowDashboard
        kpis={overview.kpis}
        points={overview.points}
        accountPointsById={overview.accountPointsById}
        accounts={overview.accountBreakdown}
        recentTransactions={overview.recentTransactions}
        unsettledTransactions={overview.unsettledTransactions}
        isMockData={shouldShowMockData}
        isLoading={isLoadingLiveData}
        activeCompanyLabel={focusedCompany ?? undefined}
        onClearCompanyFilter={() => setFocusedCompany(null)}
        onResetCompanyFilter={() => {
          setSelectedCompanies([]);
          setFocusedCompany(null);
        }}
      />
      <CompaniesDashboard
        title="Peniaze podľa firiem"
        companies={filteredCompanies}
        selectedCompanies={selectedCompanies}
        availableCompanyNames={availableCompanyNames}
        focusedCompany={focusedCompany}
        onSelectionChange={updateSelectionWithFocusedGuard}
        onFocusedCompanyChange={setFocusedCompany}
      />
    </DashboardShell>
  );
}
