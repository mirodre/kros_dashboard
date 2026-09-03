"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CashflowDashboard } from "@/components/cashflow-dashboard";
import { CompaniesDashboard } from "@/components/companies-dashboard";
import { DashboardShell } from "@/components/dashboard-shell";
import { DemoDataBanner } from "@/components/demo-data-banner";
import { FilterMismatchNotice } from "@/components/filter-mismatch-notice";
import { CASHFLOW_MOCK_COMPANIES, getCashflowOverview } from "@/lib/cashflow-mock-data";
import {
  computeCashflowOverviewFromLiveData,
  normalizePaymentAccounts,
  normalizePaymentTransactions
} from "@/lib/cashflow-live";
import { useSyncProgress, type SyncStep } from "@/lib/use-sync-progress";
import { readNdjsonStream } from "@/lib/ndjson-stream";
import {
  estimatePaymentSyncProgress,
  type PaymentSyncStats
} from "@/lib/payment-sync-progress";
import {
  cashflowCompanyMetaKey,
  getCachedPaymentAccounts,
  getCachedPaymentTransactions,
  readCashflowSyncMeta,
  replaceCachedPaymentAccounts,
  upsertCachedPaymentTransactions,
  writeCashflowSyncMeta
} from "@/lib/cashflow-cache";
import { useKrosConnections } from "@/lib/use-kros-connections";
import { usePreference } from "@/lib/use-preference";
import { applyCompanyFilter } from "@/lib/preferences/company-filter";
import type {
  KrosConnection,
  NormalizedPaymentAccount,
  NormalizedPaymentTransaction
} from "@/lib/kros-types";

/** Riadky priebehu z `/api/kros/payments` (NDJSON stream). */
type PaymentsStreamEvent =
  | ({ type: "progress"; phase: "payments"; companyName: string } & PaymentSyncStats)
  | PaymentsResultEvent;

type PaymentsResultEvent = { type: "result"; data?: unknown[]; errors?: { message?: string }[] };

/**
 * Sťahovanie firmy je jeden krok — zoznam účtov je proti pohybom krátky, takže
 * by ako vlastný krok zabral polovicu baru a ten by potom skočil na 50 % a
 * zvyšok sa vliekol. Účty preto dostanú len začiatok kroku.
 */
const ACCOUNTS_SHARE = 0.08;


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
  // Granularitu Financie len čítajú (vlastný prepínač nemajú), ale je to to isté osobné
  // nastavenie ako na ostatných prehľadoch — teraz už prežije aj reload.
  const [granularity] = usePreference("ui.granularity");
  const [selectedCompanies, setSelectedCompanies] = usePreference("cashflow.companies");
  const [focusedCompany, setFocusedCompany] = useState<string | null>(null);
  // Prepojenia sú firemné a žijú na serveri.
  const { connections, isLoading: isLoadingConnections } = useKrosConnections();
  const [hasLoadedPersistedFilters, setHasLoadedPersistedFilters] = useState(false);
  const [liveAccounts, setLiveAccounts] = useState<NormalizedPaymentAccount[]>([]);
  const [liveTransactions, setLiveTransactions] = useState<NormalizedPaymentTransaction[]>([]);
  const [liveError, setLiveError] = useState<string | null>(null);
  const [isLoadingLiveData, setIsLoadingLiveData] = useState(false);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const handledRefreshNonceRef = useRef(0);
  const {
    progress: syncProgress,
    beginSync,
    startStep,
    advanceStep,
    completeStep,
    endSync
  } = useSyncProgress();

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

  // Prázdny výber = všetky prepojené firmy; inak prienik. Neprázdny výber bez prieniku
  // nesťahuje nič a povie to hláškou — nespadne späť na sťahovanie všetkých firiem.
  const companyFilter = useMemo(
    () => applyCompanyFilter(connections, selectedCompanies, (connection) => connection.companyName),
    [connections, selectedCompanies]
  );
  const syncConnections = companyFilter.companies;

  // Prvý render beží ešte pred pripojením k store-u, takže sa sťahovanie odkladá o tik.
  useEffect(() => {
    setHasLoadedPersistedFilters(true);
  }, []);

  useEffect(() => {
    if (!hasLoadedPersistedFilters) return;

    if (connections.length === 0) {
      setLiveAccounts([]);
      setLiveTransactions([]);
      setLiveError(null);
      endSync();
      return;
    }

    if (syncConnections.length === 0) {
      setLiveAccounts([]);
      setLiveTransactions([]);
      setLiveError(null);
      setIsLoadingLiveData(false);
      endSync();
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
        body: JSON.stringify({ companyIds: companies.map((connection) => connection.companyId) }),
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
      companyIds: number[];
      lastModifiedTimestamp?: string;
    }) => {
      const response = await fetch("/api/kros/payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: abortController.signal
      });

      if (!response.ok || !response.body) {
        throw new Error("Nepodarilo sa načítať payments dáta.");
      }

      // Dáta prídu posledným riadkom streamu, dovtedy chodí priebeh sťahovania.
      const collected: { result: PaymentsResultEvent | null } = { result: null };
      let fraction = 0;
      await readNdjsonStream(response.body, (raw) => {
        const event = raw as PaymentsStreamEvent;
        if (event?.type === "result") {
          collected.result = event;
          return;
        }
        if (event?.type !== "progress") return;

        const estimate = estimatePaymentSyncProgress(event, { previousFraction: fraction });
        fraction = estimate.fraction;
        advanceStep(
          ACCOUNTS_SHARE + (1 - ACCOUNTS_SHARE) * fraction,
          [`pohyby ${event.loaded}`, estimate.periodLabel].filter(Boolean).join(" · ")
        );
      });

      const payload = collected.result;
      if (!payload) {
        throw new Error("Nepodarilo sa načítať payments dáta — sťahovanie sa nedokončilo.");
      }
      if (Array.isArray(payload.errors) && payload.errors.length > 0) {
        throw new Error(payload.errors[0]?.message ?? "Niektoré firmy sa nepodarilo načítať.");
      }
      return Array.isArray(payload.data) ? payload.data : [];
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
      return { cachedAccounts, cachedTransactions };
    };

    const loadCashflowData = async () => {
      const cached = await refreshFromCache();
      const hasCachedData = cached.cachedAccounts.length > 0 || cached.cachedTransactions.length > 0;
      setLiveError(null);

      try {
        // Najprv plán: ktoré firmy treba stiahnuť. Každá má dva kroky (účty +
        // pohyby), takže progress bar pozná celok pred prvým fetchom.
        const pendingConnections: {
          connection: KrosConnection;
          needsFullSync: boolean;
          lastModifiedTimestamp?: string;
        }[] = [];
        for (const connection of syncConnections) {
          const meta = await readCashflowSyncMeta(cashflowCompanyMetaKey(connection.companyId));
          const needsFullSync = !meta?.completedAt;
          if (!needsFullSync && !isManualRefresh) continue;
          pendingConnections.push({
            connection,
            needsFullSync,
            lastModifiedTimestamp: meta?.lastModifiedTimestamp
          });
        }

        if (abortController.signal.aborted) return;
        const syncSteps: SyncStep[] = pendingConnections.map(({ connection }) => ({
          key: `${connection.companyId}:payments`,
          group: connection.companyName,
          label: "bankové účty a pohyby"
        }));
        // Bez dát na obrazovke sťahujeme naplno, krátke dosynchronizovanie nad
        // existujúcimi dátami stačí v hlavičke.
        beginSync(syncSteps, !hasCachedData);
        if (pendingConnections.length > 0) {
          setIsLoadingLiveData(true);
        }

        for (const [
          index,
          { connection, needsFullSync, lastModifiedTimestamp }
        ] of pendingConnections.entries()) {
          if (abortController.signal.aborted) return;

          const metaKey = cashflowCompanyMetaKey(connection.companyId);
          startStep(index);
          advanceStep(ACCOUNTS_SHARE / 2, "bankové účty");

          // Account list and balances are small and change over time — always fetch in full.
          const rawAccounts = await fetchAccounts([connection]);
          const companyAccounts = normalizePaymentAccounts(rawAccounts).filter(
            (account) =>
              account.companyId === connection.companyId ||
              account.companyName === connection.companyName
          );
          await replaceCachedPaymentAccounts(connection.companyId, companyAccounts);

          if (abortController.signal.aborted) return;
          advanceStep(ACCOUNTS_SHARE, "pohyby na účtoch");

          const accountById = new Map(companyAccounts.map((account) => [account.id, account]));
          const previousLastModified = lastModifiedTimestamp;
          const rawPayments = await fetchPayments({
            companyIds: [connection.companyId],
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
          completeStep();

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
          endSync();
        }
      }
    };

    loadCashflowData();
    return () => {
      abortController.abort();
    };
  }, [
    connections,
    syncConnections,
    refreshNonce,
    hasLoadedPersistedFilters,
    beginSync,
    startStep,
    advanceStep,
    completeStep,
    endSync
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
      title="Financie"
      isSyncing={isLoadingLiveData}
      syncProgress={syncProgress}
      syncNote="Pohyby na účtoch ťaháme pre každú firmu naraz, preto prvé načítanie trvá dlhšie. Ostanú uložené v zariadení — pri ďalšom otvorení sa dosynchronizujú len zmeny."
      onRefresh={connections.length > 0 ? () => setRefreshNonce((value) => value + 1) : undefined}
    >
      {shouldShowMockData && !isLoadingConnections ? <DemoDataBanner /> : null}
      {companyFilter.noneAvailable ? <FilterMismatchNotice onShowAll={() => setSelectedCompanies([])} /> : null}
      <CashflowDashboard
        kpis={overview.kpis}
        points={overview.points}
        accountPointsById={overview.accountPointsById}
        accounts={overview.accountBreakdown}
        recentTransactions={overview.recentTransactions}
        unsettledTransactions={overview.unsettledTransactions}
        isMockData={shouldShowMockData}
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
