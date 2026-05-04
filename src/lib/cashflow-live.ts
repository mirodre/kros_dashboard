import type { CompanyPoint, Granularity, KpiCard } from "./mock-data";
import type {
  NormalizedPaymentAccount,
  NormalizedPaymentTransaction
} from "./kros-types";
import type {
  CashflowAccountPoint,
  CashflowPoint,
  CashflowRecentTransaction
} from "./cashflow-mock-data";

type CashflowOverview = {
  points: CashflowPoint[];
  accountPointsById: Record<string, CashflowPoint[]>;
  kpis: KpiCard[];
  accountBreakdown: CashflowAccountPoint[];
  recentTransactions: CashflowRecentTransaction[];
  unsettledTransactions: CashflowRecentTransaction[];
  companyBreakdown: CompanyPoint[];
  availableCompanyNames: string[];
};

function getString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function getNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const normalized = value.replace(/\s/g, "").replace(",", ".");
    const parsed = Number(normalized);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function pickNumber(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = getNumber(record[key]);
    if (value !== undefined) return value;
  }
  return undefined;
}

function pickString(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = getString(record[key]);
    if (value) return value;
  }
  return undefined;
}

function pickIdentifier(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const raw = record[key];
    if (typeof raw === "number" && Number.isFinite(raw)) return String(raw);
    const value = getString(raw);
    if (value) return value;
  }
  return undefined;
}

function getBoolean(value: unknown) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
  }
  return undefined;
}

function pickBoolean(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = getBoolean(record[key]);
    if (value !== undefined) return value;
  }
  return undefined;
}

function hasMatchedDocumentsValue(value: unknown) {
  if (Array.isArray(value)) return value.length > 0;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (Array.isArray(record.items)) return record.items.length > 0;
    if (typeof record.count === "number") return record.count > 0;
  }
  return false;
}

function inferAccountType(rawType?: string) {
  const value = rawType?.toLowerCase() ?? "";
  if (value.includes("cash") || value.includes("poklad")) return "cash";
  if (value.includes("gateway") || value.includes("stripe") || value.includes("paypal")) return "gateway";
  if (value.includes("bank") || value.includes("account") || value.includes("účet")) return "bank";
  return "other";
}

function inferSignedAmount(record: Record<string, unknown>) {
  const signed = pickNumber(record, ["signedAmount", "amountSigned", "amountWithSign"]);
  if (signed !== undefined) return signed;

  const amount = pickNumber(record, [
    "amount",
    "totalAmount",
    "value",
    "sum",
    "sumOfPayment",
    "originalSumOfPayment"
  ]);
  if (amount === undefined) return 0;

  const direction = pickString(record, ["direction", "flow", "type", "paymentType"])?.toLowerCase();
  if (direction && (direction.includes("out") || direction.includes("expense") || direction.includes("debit") || direction.includes("výdav"))) {
    return -Math.abs(amount);
  }
  if (direction && (direction.includes("in") || direction.includes("income") || direction.includes("credit") || direction.includes("príjem"))) {
    return Math.abs(amount);
  }

  const debit = pickNumber(record, ["debitAmount", "amountDebit"]);
  const credit = pickNumber(record, ["creditAmount", "amountCredit"]);
  if (debit !== undefined || credit !== undefined) {
    return (credit ?? 0) - (debit ?? 0);
  }

  return amount;
}

export function normalizePaymentAccounts(rawAccounts: unknown[]): NormalizedPaymentAccount[] {
  const normalized = rawAccounts
    .map((item, index) => {
      const record = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
      const companyName =
        pickString(record, ["__company", "companyName", "CompanyName"]) ?? "Neznáma firma";
      const id =
        pickIdentifier(record, ["id", "accountId", "AccountId", "number"]) ??
        `${companyName}-acc-${index}`;
      const name =
        pickString(record, ["name", "accountName", "AccountName", "displayName"]) ?? `Účet ${index + 1}`;
      const typeRaw = pickString(record, ["type", "accountType", "AccountType"]);
      const currency = pickString(record, ["currency", "Currency"]) ?? "EUR";
      const startingBalance =
        pickNumber(record, ["openingBalance", "initialBalance", "startingBalance", "balance"]) ?? 0;
      const companyId = pickNumber(record, ["__companyId", "companyId", "CompanyId"]);
      return {
        id,
        companyId,
        companyName,
        name,
        type: inferAccountType(typeRaw),
        currency,
        startingBalance
      } satisfies NormalizedPaymentAccount;
    })
    .filter((account) => account.id.length > 0);

  const firstRaw =
    rawAccounts.length > 0 && typeof rawAccounts[0] === "object" && rawAccounts[0] !== null
      ? (rawAccounts[0] as Record<string, unknown>)
      : null;
  // #region agent log
  fetch("http://127.0.0.1:7292/ingest/2c760ae1-6116-4d9d-ad94-448f7b07322c", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "a548d4" },
    body: JSON.stringify({
      sessionId: "a548d4",
      runId: "pre-fix-payments-empty",
      hypothesisId: "H2",
      location: "src/lib/cashflow-live.ts:normalizePaymentAccounts-summary",
      message: "Normalized payment accounts summary",
      data: {
        rawCount: rawAccounts.length,
        normalizedCount: normalized.length,
        firstRawKeys: firstRaw ? Object.keys(firstRaw).slice(0, 20) : [],
        firstNormalized:
          normalized.length > 0 ? { id: normalized[0].id, name: normalized[0].name } : null
      },
      timestamp: Date.now()
    })
  }).catch(() => {});
  // #endregion

  return normalized;
}

export function normalizePaymentTransactions(
  rawPayments: unknown[],
  accountById: Map<string, NormalizedPaymentAccount>
): NormalizedPaymentTransaction[] {
  const normalized = rawPayments
    .map((item, index) => {
      const record = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
      const accountId =
        pickIdentifier(record, ["accountId", "AccountId", "paymentAccountId", "PaymentAccountId"]) ??
        "";
      const linkedAccount = accountById.get(accountId);
      const companyName =
        pickString(record, ["__company", "companyName", "CompanyName"]) ??
        linkedAccount?.companyName ??
        "Neznáma firma";
      const accountName =
        pickString(record, ["accountName", "AccountName"]) ??
        linkedAccount?.name ??
        "Neznámy účet";
      const currency =
        pickString(record, ["currency", "Currency"]) ?? linkedAccount?.currency ?? "EUR";
      const bookedAt =
        pickString(
          record,
          ["bookedAt", "BookedAt", "bookedDate", "BookedDate", "date", "Date", "dateOfPayment"]
        ) ??
        new Date().toISOString();
      const companyId = pickNumber(record, ["__companyId", "companyId", "CompanyId"]);
      const id = pickIdentifier(record, ["id", "paymentId", "PaymentId"]) ?? `payment-${index}`;
      const hasMatchedDocuments = hasMatchedDocumentsValue(record.matchedDocuments);
      const isWithoutDocument =
        pickBoolean(record, ["isWithoutDocument", "IsWithoutDocument"]) ?? false;
      return {
        id,
        companyId,
        companyName,
        accountId: accountId || linkedAccount?.id || `unknown-account-${index}`,
        accountName,
        partnerName: pickString(record, ["partnerName", "PartnerName"]),
        remittanceInformation: pickString(record, [
          "remittanceInformation",
          "RemittanceInformation",
          "paymentReference",
          "PaymentReference"
        ]),
        hasMatchedDocuments,
        isWithoutDocument,
        amount: inferSignedAmount(record),
        bookedAt,
        description: pickString(record, ["description", "note", "message", "reference"]),
        currency
      } satisfies NormalizedPaymentTransaction;
    })
    .filter((payment) => payment.bookedAt.length > 0);

  const unmatchedAccountIds = normalized.filter((payment) => !accountById.has(payment.accountId)).length;
  const firstRaw =
    rawPayments.length > 0 && typeof rawPayments[0] === "object" && rawPayments[0] !== null
      ? (rawPayments[0] as Record<string, unknown>)
      : null;

  // #region agent log
  fetch("http://127.0.0.1:7292/ingest/2c760ae1-6116-4d9d-ad94-448f7b07322c", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "a548d4" },
    body: JSON.stringify({
      sessionId: "a548d4",
      runId: "pre-fix-payments-empty",
      hypothesisId: "H2",
      location: "src/lib/cashflow-live.ts:normalizePaymentTransactions-summary",
      message: "Normalized payment transactions summary",
      data: {
        rawCount: rawPayments.length,
        normalizedCount: normalized.length,
        unmatchedAccountIds,
        firstRawKeys: firstRaw ? Object.keys(firstRaw).slice(0, 20) : [],
        firstRawAccountCandidates: firstRaw
          ? {
              accountId: firstRaw.accountId,
              AccountId: firstRaw.AccountId,
              paymentAccountId: firstRaw.paymentAccountId,
              PaymentAccountId: firstRaw.PaymentAccountId
            }
          : null,
        firstRawAmountCandidates: firstRaw
          ? {
              amount: firstRaw.amount,
              totalAmount: firstRaw.totalAmount,
              sumOfPayment: firstRaw.sumOfPayment,
              originalSumOfPayment: firstRaw.originalSumOfPayment,
              debitAmount: firstRaw.debitAmount,
              creditAmount: firstRaw.creditAmount
            }
          : null
      },
      timestamp: Date.now()
    })
  }).catch(() => {});
  // #endregion

  return normalized;
}

export function computeCashflowOverviewFromLiveData({
  accounts,
  transactions,
  granularity,
  selectedCompanies,
  allowedCompanyIds
}: {
  accounts: NormalizedPaymentAccount[];
  transactions: NormalizedPaymentTransaction[];
  granularity: Granularity;
  selectedCompanies: string[];
  /** When set (e.g. from filtered KROS connections), match accounts by `companyId` in addition to `companyName`. */
  allowedCompanyIds?: number[];
}): CashflowOverview {
  const selectedCompanySet = new Set(selectedCompanies);
  const allowedIdSet =
    allowedCompanyIds && allowedCompanyIds.length > 0 ? new Set(allowedCompanyIds) : null;

  const accountScope = accounts.filter((account) => {
    if (selectedCompanySet.size === 0) return true;
    if (allowedIdSet && account.companyId != null && allowedIdSet.has(account.companyId)) return true;
    return selectedCompanySet.has(account.companyName);
  });
  const accountIdScope = new Set(accountScope.map((account) => account.id));
  const transactionScope = transactions.filter((transaction) => accountIdScope.has(transaction.accountId));

  // #region agent log
  fetch("http://127.0.0.1:7292/ingest/2c760ae1-6116-4d9d-ad94-448f7b07322c", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "a548d4" },
    body: JSON.stringify({
      sessionId: "a548d4",
      runId: "pre-fix-payments-empty",
      hypothesisId: "H2",
      location: "src/lib/cashflow-live.ts:computeCashflowOverviewFromLiveData-scope",
      message: "Live compute scope sizes",
      data: {
        accountsCount: accounts.length,
        accountScopeCount: accountScope.length,
        transactionsCount: transactions.length,
        transactionScopeCount: transactionScope.length
      },
      timestamp: Date.now()
    })
  }).catch(() => {});
  // #endregion

  const now = new Date();
  const currentPeriod = getPeriodWindow(granularity, now, 0);
  const previousPeriod = getPeriodWindow(granularity, now, -1);
  const currentBuckets = createBuckets(granularity, currentPeriod.start, currentPeriod.end);
  const previousBuckets = createBuckets(granularity, previousPeriod.start, previousPeriod.end);
  const currentBucketMetrics = computeBucketMetrics(currentBuckets, transactionScope);
  const previousBucketMetrics = computeBucketMetrics(previousBuckets, transactionScope);

  const openingCurrent = computeOpeningBalance(accountScope, transactionScope, currentPeriod.start);
  const openingPrevious = computeOpeningBalance(accountScope, transactionScope, previousPeriod.start);

  let runningCurrent = openingCurrent;
  let runningPrevious = openingPrevious;
  const points: CashflowPoint[] = currentBucketMetrics.map((bucket, index) => {
    runningCurrent += bucket.net;
    runningPrevious += previousBucketMetrics[index]?.net ?? 0;
    return {
      label: bucket.label,
      balance: runningCurrent,
      previousBalance: runningPrevious,
      inflow: bucket.inflow,
      outflow: bucket.outflow
    };
  });
  const accountPointsById = accountScope.reduce<Record<string, CashflowPoint[]>>((acc, account) => {
    const accountTransactions = transactionScope.filter((transaction) => transaction.accountId === account.id);
    const openingCurrentAccount = computeOpeningBalance([account], accountTransactions, currentPeriod.start);
    const openingPreviousAccount = computeOpeningBalance([account], accountTransactions, previousPeriod.start);
    const accountCurrentBuckets = computeBucketMetrics(currentBuckets, accountTransactions);
    const accountPreviousBuckets = computeBucketMetrics(previousBuckets, accountTransactions);
    let runningCurrentAccount = openingCurrentAccount;
    let runningPreviousAccount = openingPreviousAccount;
    acc[account.id] = accountCurrentBuckets.map((bucket, index) => {
      runningCurrentAccount += bucket.net;
      runningPreviousAccount += accountPreviousBuckets[index]?.net ?? 0;
      return {
        label: bucket.label,
        balance: runningCurrentAccount,
        previousBalance: runningPreviousAccount,
        inflow: bucket.inflow,
        outflow: bucket.outflow
      };
    });
    return acc;
  }, {});

  const currentInflow = currentBucketMetrics.reduce((sum, bucket) => sum + bucket.inflow, 0);
  const currentOutflow = currentBucketMetrics.reduce((sum, bucket) => sum + bucket.outflow, 0);
  const previousInflow = previousBucketMetrics.reduce((sum, bucket) => sum + bucket.inflow, 0);
  const previousOutflow = previousBucketMetrics.reduce((sum, bucket) => sum + bucket.outflow, 0);

  const currentBalance = points.at(-1)?.balance ?? openingCurrent;
  const previousBalance = points.at(-1)?.previousBalance ?? openingPrevious;

  const kpis: KpiCard[] = [
    kpi("Aktuálny zostatok", currentBalance, previousBalance),
    kpi("Príjmy v období", currentInflow, previousInflow),
    kpi("Výdavky v období", currentOutflow, previousOutflow),
    kpi("Netto tok", currentInflow - currentOutflow, previousInflow - previousOutflow)
  ];

  const accountBreakdown: CashflowAccountPoint[] = accountScope
    .map((account) => ({
      id: account.id,
      name: account.name,
      companyName: account.companyName,
      type: account.type,
      amount: computeAccountClosingBalance(account, transactionScope, currentPeriod.end),
      previousAmount: computeAccountClosingBalance(account, transactionScope, previousPeriod.end)
    }))
    .sort((a, b) => {
      const bPayments = computeAccountPaymentCount(b.id, transactionScope, currentPeriod.end);
      const aPayments = computeAccountPaymentCount(a.id, transactionScope, currentPeriod.end);
      if (bPayments !== aPayments) return bPayments - aPayments;
      return b.amount - a.amount;
    });

  const recentTransactions: CashflowRecentTransaction[] = transactionScope
    .slice()
    .sort((a, b) => new Date(b.bookedAt).getTime() - new Date(a.bookedAt).getTime())
    .map((transaction) => ({
      id: transaction.id,
      accountId: transaction.accountId,
      accountName: transaction.accountName,
      companyName: transaction.companyName,
      partnerName: transaction.partnerName,
      remittanceInformation: transaction.remittanceInformation,
      hasMatchedDocuments: transaction.hasMatchedDocuments,
      isWithoutDocument: transaction.isWithoutDocument,
      amount: transaction.amount,
      bookedAt: transaction.bookedAt
    }));
  const unsettledTransactions: CashflowRecentTransaction[] = transactionScope
    .filter((transaction) => !transaction.hasMatchedDocuments && !transaction.isWithoutDocument)
    .slice()
    .sort((a, b) => new Date(b.bookedAt).getTime() - new Date(a.bookedAt).getTime())
    .map((transaction) => ({
      id: transaction.id,
      accountId: transaction.accountId,
      accountName: transaction.accountName,
      companyName: transaction.companyName,
      partnerName: transaction.partnerName,
      remittanceInformation: transaction.remittanceInformation,
      hasMatchedDocuments: transaction.hasMatchedDocuments,
      isWithoutDocument: transaction.isWithoutDocument,
      amount: transaction.amount,
      bookedAt: transaction.bookedAt
    }));

  const companyBreakdown = accountBreakdown.reduce<Map<string, CompanyPoint>>((acc, account) => {
    const existing = acc.get(account.companyName);
    if (existing) {
      existing.amount += account.amount;
      existing.previousAmount += account.previousAmount;
    } else {
      acc.set(account.companyName, {
        name: account.companyName,
        amount: account.amount,
        previousAmount: account.previousAmount
      });
    }
    return acc;
  }, new Map());

  return {
    points,
    accountPointsById,
    kpis,
    accountBreakdown,
    recentTransactions,
    unsettledTransactions,
    companyBreakdown: Array.from(companyBreakdown.values()).sort((a, b) => b.amount - a.amount),
    availableCompanyNames: Array.from(new Set(accounts.map((account) => account.companyName)))
  };
}

function kpi(title: string, currentValue: number, previousValue: number): KpiCard {
  return {
    title,
    currentValue,
    previousValue,
    deltaPct: deltaPct(currentValue, previousValue)
  };
}

function deltaPct(current: number, previous: number) {
  if (previous === 0) return current === 0 ? 0 : 100;
  return ((current - previous) / Math.abs(previous)) * 100;
}

function computeOpeningBalance(
  scopeAccounts: NormalizedPaymentAccount[],
  scopeTransactions: NormalizedPaymentTransaction[],
  periodStart: Date
) {
  const accountStarting = scopeAccounts.reduce((sum, account) => sum + account.startingBalance, 0);
  const transactionsBeforePeriod = scopeTransactions
    .filter((transaction) => new Date(transaction.bookedAt).getTime() < periodStart.getTime())
    .reduce((sum, transaction) => sum + transaction.amount, 0);
  return accountStarting + transactionsBeforePeriod;
}

function computeAccountClosingBalance(
  account: NormalizedPaymentAccount,
  scopeTransactions: NormalizedPaymentTransaction[],
  periodEnd: Date
) {
  const flow = scopeTransactions
    .filter(
      (transaction) =>
        transaction.accountId === account.id &&
        new Date(transaction.bookedAt).getTime() <= periodEnd.getTime()
    )
    .reduce((sum, transaction) => sum + transaction.amount, 0);
  return account.startingBalance + flow;
}

function computeAccountPaymentCount(
  accountId: string,
  scopeTransactions: NormalizedPaymentTransaction[],
  periodEnd: Date
) {
  return scopeTransactions.filter(
    (transaction) =>
      transaction.accountId === accountId &&
      new Date(transaction.bookedAt).getTime() <= periodEnd.getTime()
  ).length;
}

type PeriodWindow = { start: Date; end: Date };

function getPeriodWindow(granularity: Granularity, anchor: Date, shift: number): PeriodWindow {
  if (granularity === "week") {
    const day = anchor.getDay() || 7;
    const start = new Date(anchor);
    start.setDate(anchor.getDate() - day + 1 + shift * 7);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    end.setHours(23, 59, 59, 999);
    return { start, end };
  }
  if (granularity === "month") {
    const start = new Date(anchor.getFullYear() + shift, 0, 1);
    // For year-to-date monthly view, keep only months that already elapsed.
    // Previous period mirrors the same month/day cutoff for like-for-like comparison.
    const end = new Date(
      anchor.getFullYear() + shift,
      anchor.getMonth(),
      anchor.getDate(),
      23,
      59,
      59,
      999
    );
    return { start, end };
  }
  const start = new Date(anchor.getFullYear() + shift * 5, 0, 1);
  const end = new Date(start.getFullYear() + 5, 0, 0, 23, 59, 59, 999);
  return { start, end };
}

type Bucket = { label: string; start: Date; end: Date };

function createBuckets(granularity: Granularity, periodStart: Date, periodEnd: Date): Bucket[] {
  if (granularity === "week") {
    return Array.from({ length: 7 }).map((_, index) => {
      const start = new Date(periodStart);
      start.setDate(periodStart.getDate() + index);
      const end = new Date(start);
      end.setHours(23, 59, 59, 999);
      return {
        label: start.toLocaleDateString("sk-SK", { weekday: "short" }),
        start,
        end
      };
    });
  }
  if (granularity === "month") {
    const buckets: Bucket[] = [];
    for (let month = 0; month < 12; month += 1) {
      const start = new Date(periodStart.getFullYear(), month, 1);
      const end = new Date(periodStart.getFullYear(), month + 1, 0, 23, 59, 59, 999);
      if (start > periodEnd) break;
      buckets.push({
        label: start.toLocaleDateString("sk-SK", { month: "short" }).replace(".", ""),
        start,
        end
      });
    }
    return buckets;
  }
  return Array.from({ length: 5 }).map((_, yearOffset) => {
    const start = new Date(periodStart.getFullYear() + yearOffset, 0, 1);
    const end = new Date(periodStart.getFullYear() + yearOffset, 11, 31, 23, 59, 59, 999);
    return { label: String(start.getFullYear()), start, end };
  });
}

type BucketMetrics = { label: string; inflow: number; outflow: number; net: number };

function computeBucketMetrics(buckets: Bucket[], transactions: NormalizedPaymentTransaction[]): BucketMetrics[] {
  return buckets.map((bucket) => {
    let inflow = 0;
    let outflow = 0;
    for (const transaction of transactions) {
      const time = new Date(transaction.bookedAt).getTime();
      if (time < bucket.start.getTime() || time > bucket.end.getTime()) continue;
      if (transaction.amount >= 0) inflow += transaction.amount;
      else outflow += Math.abs(transaction.amount);
    }
    return { label: bucket.label, inflow, outflow, net: inflow - outflow };
  });
}
