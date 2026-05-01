import type { CompanyPoint, Granularity, KpiCard } from "./mock-data";

type CashflowAccountType = "bank" | "cash" | "gateway";

type CashflowAccount = {
  id: string;
  name: string;
  companyName: string;
  type: CashflowAccountType;
  startingBalance: number;
};

type CashflowTransaction = {
  id: string;
  accountId: string;
  companyName: string;
  partnerName?: string;
  remittanceInformation?: string;
  hasMatchedDocuments: boolean;
  isWithoutDocument: boolean;
  bookedAt: string;
  amount: number;
};

export type CashflowPoint = {
  label: string;
  balance: number;
  previousBalance: number;
  inflow: number;
  outflow: number;
};

export type CashflowAccountPoint = {
  id: string;
  name: string;
  companyName: string;
  type: CashflowAccountType;
  amount: number;
  previousAmount: number;
};

export type CashflowRecentTransaction = {
  id: string;
  accountName: string;
  companyName: string;
  partnerName?: string;
  remittanceInformation?: string;
  hasMatchedDocuments: boolean;
  isWithoutDocument: boolean;
  amount: number;
  bookedAt: string;
};

const accounts: CashflowAccount[] = [
  { id: "a1", name: "Tatra banka - hlavný účet", companyName: "Kros Trade", type: "bank", startingBalance: 102400 },
  { id: "a2", name: "VÚB - prevádzka", companyName: "Kros Trade", type: "bank", startingBalance: 48750 },
  { id: "a3", name: "Pokladnica predajňa", companyName: "Kros Retail", type: "cash", startingBalance: 8400 },
  { id: "a4", name: "Stripe gateway", companyName: "Kros Services", type: "gateway", startingBalance: 21600 },
  { id: "a5", name: "ČSOB účet", companyName: "Kros Services", type: "bank", startingBalance: 67250 },
  { id: "a6", name: "Pokladnica servis", companyName: "Kros Services", type: "cash", startingBalance: 5900 }
];

export const CASHFLOW_MOCK_COMPANIES = Array.from(
  new Set(accounts.map((account) => account.companyName))
);

const monthlyCurrentYearTransactions: Omit<CashflowTransaction, "id" | "bookedAt">[] = [
  { accountId: "a1", companyName: "Kros Trade", amount: 22800 },
  { accountId: "a2", companyName: "Kros Trade", amount: -13200 },
  { accountId: "a5", companyName: "Kros Services", amount: 18100 },
  { accountId: "a4", companyName: "Kros Services", amount: -6700 },
  { accountId: "a3", companyName: "Kros Retail", amount: 5200 },
  { accountId: "a6", companyName: "Kros Services", amount: -1800 },
  { accountId: "a4", companyName: "Kros Services", amount: 7600 },
  { accountId: "a2", companyName: "Kros Trade", amount: -2400 }
];

const monthlyPreviousYearTransactions: Omit<CashflowTransaction, "id" | "bookedAt">[] = [
  { accountId: "a1", companyName: "Kros Trade", amount: 19700 },
  { accountId: "a2", companyName: "Kros Trade", amount: -12400 },
  { accountId: "a5", companyName: "Kros Services", amount: 15200 },
  { accountId: "a4", companyName: "Kros Services", amount: -6300 },
  { accountId: "a3", companyName: "Kros Retail", amount: 4100 },
  { accountId: "a6", companyName: "Kros Services", amount: -1500 },
  { accountId: "a4", companyName: "Kros Services", amount: 6500 },
  { accountId: "a2", companyName: "Kros Trade", amount: -3000 }
];

const transactions = buildTransactions();

export function getCashflowOverview(granularity: Granularity, selectedCompanies: string[] = []) {
  const selectedCompanySet = new Set(selectedCompanies);
  const accountScope = accounts.filter(
    (account) => selectedCompanySet.size === 0 || selectedCompanySet.has(account.companyName)
  );
  const accountIdScope = new Set(accountScope.map((account) => account.id));
  const transactionScope = transactions.filter((transaction) => accountIdScope.has(transaction.accountId));

  const now = new Date();
  const currentPeriod = getPeriodWindow(granularity, now, 0);
  const previousPeriod = getPeriodWindow(granularity, now, -1);

  const openingBalanceCurrent = computeOpeningBalance(accountScope, transactionScope, currentPeriod.start);
  const openingBalancePrevious = computeOpeningBalance(accountScope, transactionScope, previousPeriod.start);

  const currentBuckets = createBuckets(granularity, currentPeriod.start, currentPeriod.end);
  const previousBuckets = createBuckets(granularity, previousPeriod.start, previousPeriod.end);

  const currentBucketMetrics = computeBucketMetrics(currentBuckets, transactionScope);
  const previousBucketMetrics = computeBucketMetrics(previousBuckets, transactionScope);

  let runningCurrent = openingBalanceCurrent;
  let runningPrevious = openingBalancePrevious;
  const points: CashflowPoint[] = currentBucketMetrics.map((bucket, index) => {
    const previousBucket = previousBucketMetrics[index];
    runningCurrent += bucket.net;
    runningPrevious += previousBucket?.net ?? 0;

    return {
      label: bucket.label,
      balance: runningCurrent,
      previousBalance: runningPrevious,
      inflow: bucket.inflow,
      outflow: bucket.outflow
    };
  });

  const currentInflow = currentBucketMetrics.reduce((sum, bucket) => sum + bucket.inflow, 0);
  const currentOutflow = currentBucketMetrics.reduce((sum, bucket) => sum + bucket.outflow, 0);
  const previousInflow = previousBucketMetrics.reduce((sum, bucket) => sum + bucket.inflow, 0);
  const previousOutflow = previousBucketMetrics.reduce((sum, bucket) => sum + bucket.outflow, 0);
  const currentBalance = points.length > 0 ? points[points.length - 1].balance : openingBalanceCurrent;
  const previousBalance =
    points.length > 0 ? points[points.length - 1].previousBalance : openingBalancePrevious;

  const kpis: KpiCard[] = [
    kpi("Aktuálny zostatok", currentBalance, previousBalance),
    kpi("Príjmy v období", currentInflow, previousInflow),
    kpi("Výdavky v období", currentOutflow, previousOutflow),
    kpi("Netto tok", currentInflow - currentOutflow, previousInflow - previousOutflow)
  ];

  const accountBreakdown = accountScope
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

  const accountNameById = new Map(accountScope.map((account) => [account.id, account.name]));
  const recentTransactions: CashflowRecentTransaction[] = transactionScope
    .slice()
    .sort((a, b) => new Date(b.bookedAt).getTime() - new Date(a.bookedAt).getTime())
    .slice(0, 10)
    .map((transaction) => ({
      id: transaction.id,
      accountName: accountNameById.get(transaction.accountId) ?? transaction.accountId,
      companyName: transaction.companyName,
      partnerName: transaction.partnerName,
      remittanceInformation: transaction.remittanceInformation,
      hasMatchedDocuments: transaction.hasMatchedDocuments,
      isWithoutDocument: transaction.isWithoutDocument,
      amount: transaction.amount,
      bookedAt: transaction.bookedAt
    }));

  const companyBreakdown = accountScope
    .reduce<Map<string, CompanyPoint>>((acc, account) => {
      const current = computeAccountClosingBalance(account, transactionScope, currentPeriod.end);
      const previous = computeAccountClosingBalance(account, transactionScope, previousPeriod.end);
      const existing = acc.get(account.companyName);
      if (existing) {
        existing.amount += current;
        existing.previousAmount += previous;
      } else {
        acc.set(account.companyName, {
          name: account.companyName,
          amount: current,
          previousAmount: previous
        });
      }
      return acc;
    }, new Map())
    .values();

  return {
    points,
    kpis,
    accountBreakdown,
    recentTransactions,
    unsettledTransactions: recentTransactions.filter(
      (transaction) => !transaction.hasMatchedDocuments && !transaction.isWithoutDocument
    ),
    companyBreakdown: Array.from(companyBreakdown).sort((a, b) => b.amount - a.amount),
    availableCompanyNames: CASHFLOW_MOCK_COMPANIES
  };
}

function buildTransactions() {
  const list: CashflowTransaction[] = [];
  let id = 1;
  for (let month = 0; month < 12; month += 1) {
    for (let index = 0; index < monthlyCurrentYearTransactions.length; index += 1) {
      const record = monthlyCurrentYearTransactions[index];
      list.push({
        id: `txn-${id++}`,
        accountId: record.accountId,
        companyName: record.companyName,
        partnerName: `Partner ${index + 1}`,
        remittanceInformation: `Variabilný symbol ${1000 + index}`,
        hasMatchedDocuments: index % 2 === 0,
        isWithoutDocument: index % 2 !== 0,
        amount: addVariance(record.amount, month, index),
        bookedAt: new Date(2026, month, 4 + index * 2).toISOString()
      });
    }
    for (let index = 0; index < monthlyPreviousYearTransactions.length; index += 1) {
      const record = monthlyPreviousYearTransactions[index];
      list.push({
        id: `txn-${id++}`,
        accountId: record.accountId,
        companyName: record.companyName,
        partnerName: `Partner ${index + 1}`,
        remittanceInformation: `Variabilný symbol ${2000 + index}`,
        hasMatchedDocuments: index % 2 === 0,
        isWithoutDocument: index % 2 !== 0,
        amount: addVariance(record.amount, month, index),
        bookedAt: new Date(2025, month, 5 + index * 2).toISOString()
      });
    }
  }

  // Ensure demo always contains visible "today" movements.
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  list.push(
    {
      id: `txn-${id++}`,
      accountId: "a5",
      companyName: "Kros Services",
      partnerName: "Booking.com",
      remittanceInformation: "Rezervácia apríl",
      hasMatchedDocuments: true,
      isWithoutDocument: false,
      amount: 12450,
      bookedAt: now.toISOString()
    },
    {
      id: `txn-${id++}`,
      accountId: "a2",
      companyName: "Kros Trade",
      partnerName: "Dodávateľ energia",
      remittanceInformation: "Platba záloha",
      hasMatchedDocuments: false,
      isWithoutDocument: true,
      amount: -3810,
      bookedAt: yesterday.toISOString()
    }
  );

  return list;
}

function addVariance(amount: number, month: number, position: number) {
  const direction = amount >= 0 ? 1 : -1;
  const variance = ((month + 1) * ((position % 3) + 1) * 37) % 480;
  return amount + variance * direction;
}

function kpi(title: string, currentValue: number, previousValue: number): KpiCard {
  return {
    title,
    currentValue,
    previousValue,
    deltaPct: getDelta(currentValue, previousValue)
  };
}

function getDelta(current: number, previous: number) {
  if (previous === 0) return current === 0 ? 0 : 100;
  return ((current - previous) / Math.abs(previous)) * 100;
}

function computeOpeningBalance(
  scopeAccounts: CashflowAccount[],
  scopeTransactions: CashflowTransaction[],
  periodStart: Date
) {
  const accountStarting = scopeAccounts.reduce((sum, account) => sum + account.startingBalance, 0);
  const transactionsBeforePeriod = scopeTransactions
    .filter((transaction) => new Date(transaction.bookedAt).getTime() < periodStart.getTime())
    .reduce((sum, transaction) => sum + transaction.amount, 0);
  return accountStarting + transactionsBeforePeriod;
}

function computeAccountClosingBalance(
  account: CashflowAccount,
  scopeTransactions: CashflowTransaction[],
  periodEnd: Date
) {
  const transactionsInRange = scopeTransactions
    .filter(
      (transaction) =>
        transaction.accountId === account.id &&
        new Date(transaction.bookedAt).getTime() <= periodEnd.getTime()
    )
    .reduce((sum, transaction) => sum + transaction.amount, 0);
  return account.startingBalance + transactionsInRange;
}

function computeAccountPaymentCount(
  accountId: string,
  scopeTransactions: CashflowTransaction[],
  periodEnd: Date
) {
  return scopeTransactions.filter(
    (transaction) =>
      transaction.accountId === accountId &&
      new Date(transaction.bookedAt).getTime() <= periodEnd.getTime()
  ).length;
}

type PeriodWindow = {
  start: Date;
  end: Date;
};

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
    const start = new Date(anchor.getFullYear(), 0 + shift * 12, 1);
    const end = new Date(start.getFullYear(), start.getMonth() + 12, 0, 23, 59, 59, 999);
    return { start, end };
  }

  const start = new Date(anchor.getFullYear() + shift * 5, 0, 1);
  const end = new Date(start.getFullYear() + 5, 0, 0, 23, 59, 59, 999);
  return { start, end };
}

type Bucket = {
  label: string;
  start: Date;
  end: Date;
};

function createBuckets(granularity: Granularity, periodStart: Date, periodEnd: Date): Bucket[] {
  if (granularity === "week") {
    const list: Bucket[] = [];
    for (let i = 0; i < 7; i += 1) {
      const start = new Date(periodStart);
      start.setDate(periodStart.getDate() + i);
      const end = new Date(start);
      end.setHours(23, 59, 59, 999);
      list.push({ label: start.toLocaleDateString("sk-SK", { weekday: "short" }), start, end });
    }
    return list;
  }

  if (granularity === "month") {
    const list: Bucket[] = [];
    for (let month = 0; month < 12; month += 1) {
      const start = new Date(periodStart.getFullYear(), month, 1);
      const end = new Date(periodStart.getFullYear(), month + 1, 0, 23, 59, 59, 999);
      if (start > periodEnd) break;
      list.push({
        label: start.toLocaleDateString("sk-SK", { month: "short" }).replace(".", ""),
        start,
        end
      });
    }
    return list;
  }

  const list: Bucket[] = [];
  for (let yearOffset = 0; yearOffset < 5; yearOffset += 1) {
    const start = new Date(periodStart.getFullYear() + yearOffset, 0, 1);
    const end = new Date(periodStart.getFullYear() + yearOffset, 11, 31, 23, 59, 59, 999);
    list.push({ label: `${start.getFullYear()}`, start, end });
  }
  return list;
}

type BucketMetrics = {
  label: string;
  inflow: number;
  outflow: number;
  net: number;
};

function computeBucketMetrics(buckets: Bucket[], scopeTransactions: CashflowTransaction[]): BucketMetrics[] {
  return buckets.map((bucket) => {
    let inflow = 0;
    let outflow = 0;
    for (const transaction of scopeTransactions) {
      const bookedAt = new Date(transaction.bookedAt).getTime();
      if (bookedAt < bucket.start.getTime() || bookedAt > bucket.end.getTime()) continue;
      if (transaction.amount >= 0) inflow += transaction.amount;
      else outflow += Math.abs(transaction.amount);
    }
    return {
      label: bucket.label,
      inflow,
      outflow,
      net: inflow - outflow
    };
  });
}
