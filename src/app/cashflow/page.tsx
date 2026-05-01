"use client";

import { useEffect, useMemo, useState } from "react";
import { CashflowDashboard } from "@/components/cashflow-dashboard";
import { CompaniesDashboard } from "@/components/companies-dashboard";
import { DashboardShell } from "@/components/dashboard-shell";
import { CASHFLOW_MOCK_COMPANIES, getCashflowOverview } from "@/lib/cashflow-mock-data";
import {
  computeCashflowOverviewFromLiveData,
  normalizePaymentAccounts,
  normalizePaymentTransactions
} from "@/lib/cashflow-live";
import { readConnections } from "@/lib/kros-storage";
import type {
  KrosConnection,
  NormalizedPaymentAccount,
  NormalizedPaymentTransaction
} from "@/lib/kros-types";
import type { Granularity } from "@/lib/mock-data";

const COMPANY_FILTER_STORAGE_KEY = "kros_dashboard_selected_companies";
const CASHFLOW_LIVE_CACHE_KEY = "kros_dashboard_cashflow_live_cache_v1";

type CashflowLiveCachePayload = {
  companyIds: number[];
  accounts: NormalizedPaymentAccount[];
  transactions: NormalizedPaymentTransaction[];
  savedAt: string;
};

declare global {
  var __krosDashboardGranularity: Granularity | undefined;
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

    const connectionIds = connections.map((connection) => connection.companyId).sort((a, b) => a - b);
    try {
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
        cachedIds.length === connectionIds.length &&
        cachedIds.every((id, index) => id === connectionIds[index]);
      if (!hasSameScope) {
        setHasHydratedLiveCache(true);
        return;
      }

      if (Array.isArray(parsed?.accounts) && Array.isArray(parsed?.transactions)) {
        setLiveAccounts(parsed.accounts);
        setLiveTransactions(parsed.transactions);
        setLiveError(null);
      }
    } catch {
      // Ignore invalid cache payload.
    } finally {
      setHasHydratedLiveCache(true);
    }
  }, [connections, hasLoadedPersistedFilters]);

  useEffect(() => {
    if (!hasHydratedLiveCache) return;
    if (connections.length === 0) {
      setLiveAccounts([]);
      setLiveTransactions([]);
      setLiveError(null);
      return;
    }

    // Keep dashboard loaded between menu switches and re-fetch only on manual pull-to-refresh.
    // Fresh load is triggered when cache is missing (both arrays empty).
    const hasCachedLiveData = liveAccounts.length > 0 || liveTransactions.length > 0;
    if (refreshNonce === 0 && hasCachedLiveData) return;

    const companyScope = connections;

    if (companyScope.length === 0) {
      setLiveAccounts([]);
      setLiveTransactions([]);
      return;
    }

    const abortController = new AbortController();
    setIsLoadingLiveData(true);
    setLiveError(null);

    const loadLivePayments = async () => {
      try {
        const [accountsResponse, paymentsResponse] = await Promise.all([
          fetch("/api/kros/payments/accounts", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ companies: companyScope }),
            signal: abortController.signal
          }),
          fetch("/api/kros/payments", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              companies: companyScope
            }),
            signal: abortController.signal
          })
        ]);

        const accountsPayload = await accountsResponse.json();
        const paymentsPayload = await paymentsResponse.json();
        if (!accountsResponse.ok || !paymentsResponse.ok) {
          throw new Error("Nepodarilo sa načítať payments dáta.");
        }

        const normalizedAccounts = normalizePaymentAccounts(
          Array.isArray(accountsPayload?.data) ? accountsPayload.data : []
        );
        const accountById = new Map(normalizedAccounts.map((account) => [account.id, account]));
        const normalizedTransactions = normalizePaymentTransactions(
          Array.isArray(paymentsPayload?.data) ? paymentsPayload.data : [],
          accountById
        );

        // #region agent log
        fetch("http://127.0.0.1:7292/ingest/2c760ae1-6116-4d9d-ad94-448f7b07322c", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "a548d4" },
          body: JSON.stringify({
            sessionId: "a548d4",
            runId: "pre-fix-payments-empty",
            hypothesisId: "H3",
            location: "src/app/cashflow/page.tsx:loadLivePayments-normalized",
            message: "Normalized live payload summary",
            data: {
              rawAccountsCount: Array.isArray(accountsPayload?.data) ? accountsPayload.data.length : -1,
              rawPaymentsCount: Array.isArray(paymentsPayload?.data) ? paymentsPayload.data.length : -1,
              normalizedAccountsCount: normalizedAccounts.length,
              normalizedTransactionsCount: normalizedTransactions.length,
              samplePayment:
                normalizedTransactions.length > 0
                  ? {
                      accountId: normalizedTransactions[0]?.accountId,
                      amount: normalizedTransactions[0]?.amount,
                      bookedAt: normalizedTransactions[0]?.bookedAt
                    }
                  : null
            },
            timestamp: Date.now()
          })
        }).catch(() => {});
        // #endregion

        if (!abortController.signal.aborted) {
          setLiveAccounts(normalizedAccounts);
          setLiveTransactions(normalizedTransactions);
          setLiveError(null);
          try {
            const payload: CashflowLiveCachePayload = {
              companyIds: companyScope.map((connection) => connection.companyId),
              accounts: normalizedAccounts,
              transactions: normalizedTransactions,
              savedAt: new Date().toISOString()
            };
            sessionStorage.setItem(CASHFLOW_LIVE_CACHE_KEY, JSON.stringify(payload));
          } catch {
            // Ignore cache write failures.
          }
        }
      } catch (error) {
        if (!abortController.signal.aborted) {
          setLiveError(error instanceof Error ? error.message : "Nepodarilo sa načítať payments dáta.");
          setLiveAccounts([]);
          setLiveTransactions([]);
        }
      } finally {
        if (!abortController.signal.aborted) {
          setIsLoadingLiveData(false);
        }
      }
    };

    loadLivePayments();
    return () => {
      abortController.abort();
    };
  }, [connections, liveAccounts.length, liveTransactions.length, refreshNonce, hasHydratedLiveCache]);

  const hasLiveData = liveAccounts.length > 0 || liveTransactions.length > 0;
  const liveOverview = useMemo(
    () =>
      hasLiveData
        ? computeCashflowOverviewFromLiveData({
            accounts: liveAccounts,
            transactions: liveTransactions,
            granularity,
            selectedCompanies: effectiveCompanies
          })
        : null,
    [hasLiveData, liveAccounts, liveTransactions, granularity, effectiveCompanies]
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
      title="Peňažný dashboard"
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
