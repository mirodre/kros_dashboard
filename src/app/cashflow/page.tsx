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
import {
  cashflowCompanyMetaKey,
  getCachedPaymentAccounts,
  getCachedPaymentTransactions,
  readCashflowSyncMeta,
  replaceCachedPaymentAccounts,
  upsertCachedPaymentTransactions,
  writeCashflowSyncMeta
} from "@/lib/cashflow-cache";
import { readConnections } from "@/lib/kros-storage";
import type {
  KrosConnection,
  NormalizedPaymentAccount,
  NormalizedPaymentTransaction
} from "@/lib/kros-types";
import type { Granularity } from "@/lib/mock-data";

const COMPANY_FILTER_STORAGE_KEY = "kros_dashboard_cashflow_selected_companies";

declare global {
  // eslint-disable-next-line no-var -- globalThis typing requires `var`
  var __krosDashboardGranularity: Granularity | undefined;
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

export default function CashflowPage() {
  const [granularity] = useState<Granularity>(
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
  const handledRefreshNonceRef = useRef(0);

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
      setLiveAccounts([]);
      setLiveTransactions([]);
      setLiveError(null);
      return;
    }

    if (syncConnections.length === 0) {
      setLiveAccounts([]);
      setLiveTransactions([]);
      setLiveError(null);
      setIsLoadingLiveData(false);
      return;
    }

    const abortController = new AbortController();
    // Same flow as Biznis: hydrate from the persistent IndexedDB cache first; companies
    // without a completed sync get a full fetch, a manual refresh pulls only payments
    // changed since the stored per-company LastModifiedTimestamp.
    const isManualRefresh = refreshNonce !== handledRefreshNonceRef.current;
    const syncCompanyIds = syncConnections.map((connection) => connection.companyId);

    const fetchAccounts = async (companies: KrosConnection[]) => {
      const response = await fetch("/api/kros/payments/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companies }),
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

    const refreshFromCache = async () => {
      const [cachedAccounts, cachedTransactions] = await Promise.all([
        getCachedPaymentAccounts(syncCompanyIds),
        getCachedPaymentTransactions(syncCompanyIds)
      ]);
      if (!abortController.signal.aborted) {
        setLiveAccounts(cachedAccounts);
        setLiveTransactions(cachedTransactions);
      }
    };

    const loadCashflowData = async () => {
      await refreshFromCache();
      setLiveError(null);

      try {
        for (const connection of syncConnections) {
          if (abortController.signal.aborted) return;

          const metaKey = cashflowCompanyMetaKey(connection.companyId);
          const meta = await readCashflowSyncMeta(metaKey);
          const needsFullSync = !meta?.completedAt;
          if (!needsFullSync && !isManualRefresh) continue;

          setIsLoadingLiveData(true);

          // Account list and balances are small and change over time — always fetch in full.
          const rawAccounts = await fetchAccounts([connection]);
          const companyAccounts = normalizePaymentAccounts(rawAccounts).filter(
            (account) =>
              account.companyId === connection.companyId ||
              account.companyName === connection.companyName
          );
          await replaceCachedPaymentAccounts(connection.companyId, companyAccounts);

          const accountById = new Map(companyAccounts.map((account) => [account.id, account]));
          const previousLastModified = meta?.lastModifiedTimestamp;
          const rawPayments = await fetchPayments({
            companies: [connection],
            ...(!needsFullSync && previousLastModified
              ? { lastModifiedTimestamp: withLastModifiedOverlap(previousLastModified) }
              : {})
          });
          const companyTransactions = normalizePaymentTransactions(rawPayments, accountById).filter(
            (transaction) =>
              transaction.companyId === connection.companyId ||
              transaction.companyName === connection.companyName
          );
          await upsertCachedPaymentTransactions(connection.companyId, companyTransactions);
          await writeCashflowSyncMeta({
            key: metaKey,
            companyId: connection.companyId,
            completedAt: new Date().toISOString(),
            lastModifiedTimestamp: getMaxLastModified(companyTransactions, previousLastModified)
          });

          await refreshFromCache();
        }
      } catch (error) {
        if (!abortController.signal.aborted) {
          setLiveError(error instanceof Error ? error.message : "Nepodarilo sa načítať payments dáta.");
        }
      } finally {
        if (!abortController.signal.aborted) {
          handledRefreshNonceRef.current = refreshNonce;
          setIsLoadingLiveData(false);
        }
      }
    };

    loadCashflowData();
    return () => {
      abortController.abort();
    };
  }, [connections, syncConnections, refreshNonce, hasLoadedPersistedFilters]);

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
      title="Financie"
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
        title="Financie podľa firiem"
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
