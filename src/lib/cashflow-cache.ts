import type { NormalizedPaymentAccount, NormalizedPaymentTransaction } from "./kros-types";

/**
 * Persistent IndexedDB cache for the Peniaze (cashflow) module — same pattern
 * as `invoice-cache.ts` for the Biznis module, so data survives closing the app.
 */
const DB_NAME = "kros_dashboard_cashflow_cache";
const DB_VERSION = 1;
const ACCOUNTS_STORE = "accounts";
const TRANSACTIONS_STORE = "transactions";
const SYNC_META_STORE = "syncMeta";

/** Legacy sessionStorage cache key, kept only so clearing wipes old leftovers. */
const LEGACY_SESSION_CACHE_KEY = "kros_dashboard_cashflow_live_cache_v1";

export type CachedPaymentAccount = NormalizedPaymentAccount & {
  cacheKey: string;
  cacheCompanyId: number;
};

export type CachedPaymentTransaction = NormalizedPaymentTransaction & {
  cacheKey: string;
  cacheCompanyId: number;
};

export type CashflowSyncMeta = {
  key: string;
  companyId: number;
  completedAt?: string;
  lastModifiedTimestamp?: string;
};

function openCacheDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(ACCOUNTS_STORE)) {
        const store = db.createObjectStore(ACCOUNTS_STORE, { keyPath: "cacheKey" });
        store.createIndex("cacheCompanyId", "cacheCompanyId", { unique: false });
      }
      if (!db.objectStoreNames.contains(TRANSACTIONS_STORE)) {
        const store = db.createObjectStore(TRANSACTIONS_STORE, { keyPath: "cacheKey" });
        store.createIndex("cacheCompanyId", "cacheCompanyId", { unique: false });
      }
      if (!db.objectStoreNames.contains(SYNC_META_STORE)) {
        db.createObjectStore(SYNC_META_STORE, { keyPath: "key" });
      }
    };

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

function createTransaction<T>(
  storeNames: string | string[],
  mode: IDBTransactionMode,
  operation: (transaction: IDBTransaction) => Promise<T>
): Promise<T> {
  return openCacheDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(storeNames, mode);
        transaction.oncomplete = () => db.close();
        transaction.onerror = () => {
          db.close();
          reject(transaction.error);
        };
        transaction.onabort = () => {
          db.close();
          reject(transaction.error);
        };

        operation(transaction).then(resolve).catch((error) => {
          transaction.abort();
          reject(error);
        });
      })
  );
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

function cacheKey(companyId: number, itemId: string) {
  return `${companyId}:${itemId}`;
}

export function cashflowCompanyMetaKey(companyId: number) {
  return `company:${companyId}`;
}

export async function getCachedPaymentAccounts(companyIds: number[]) {
  if (typeof indexedDB === "undefined" || companyIds.length === 0) return [];

  const companySet = new Set(companyIds);
  return createTransaction(ACCOUNTS_STORE, "readonly", async (transaction) => {
    const store = transaction.objectStore(ACCOUNTS_STORE);
    const accounts = (await requestToPromise(store.getAll())) as CachedPaymentAccount[];
    return accounts.filter((account) => companySet.has(account.cacheCompanyId));
  });
}

export async function getCachedPaymentTransactions(companyIds: number[]) {
  if (typeof indexedDB === "undefined" || companyIds.length === 0) return [];

  const companySet = new Set(companyIds);
  return createTransaction(TRANSACTIONS_STORE, "readonly", async (transaction) => {
    const store = transaction.objectStore(TRANSACTIONS_STORE);
    const transactions = (await requestToPromise(store.getAll())) as CachedPaymentTransaction[];
    return transactions.filter((item) => companySet.has(item.cacheCompanyId));
  });
}

/** Replaces all cached accounts of the company — account lists are always fetched in full. */
export async function replaceCachedPaymentAccounts(
  companyId: number,
  accounts: NormalizedPaymentAccount[]
) {
  if (typeof indexedDB === "undefined") return;

  await createTransaction(ACCOUNTS_STORE, "readwrite", async (transaction) => {
    const store = transaction.objectStore(ACCOUNTS_STORE);
    const existing = (await requestToPromise(store.getAll())) as CachedPaymentAccount[];
    await Promise.all(
      existing
        .filter((account) => account.cacheCompanyId === companyId)
        .map((account) => requestToPromise(store.delete(account.cacheKey)))
    );
    await Promise.all(
      accounts
        .filter((account) => account.id)
        .map((account) =>
          requestToPromise(
            store.put({
              ...account,
              cacheCompanyId: companyId,
              cacheKey: cacheKey(companyId, account.id)
            } satisfies CachedPaymentAccount)
          )
        )
    );
  });
}

export async function upsertCachedPaymentTransactions(
  companyId: number,
  transactions: NormalizedPaymentTransaction[]
) {
  if (typeof indexedDB === "undefined") return;

  await createTransaction(TRANSACTIONS_STORE, "readwrite", async (transaction) => {
    const store = transaction.objectStore(TRANSACTIONS_STORE);
    await Promise.all(
      transactions
        .filter((item) => item.id)
        .map((item) =>
          requestToPromise(
            store.put({
              ...item,
              cacheCompanyId: companyId,
              cacheKey: cacheKey(companyId, item.id)
            } satisfies CachedPaymentTransaction)
          )
        )
    );
  });
}

export async function readCashflowSyncMeta(key: string) {
  if (typeof indexedDB === "undefined") return null;

  return createTransaction(SYNC_META_STORE, "readonly", async (transaction) => {
    const store = transaction.objectStore(SYNC_META_STORE);
    const result = (await requestToPromise(store.get(key))) as CashflowSyncMeta | undefined;
    return result ?? null;
  });
}

export async function writeCashflowSyncMeta(meta: CashflowSyncMeta) {
  if (typeof indexedDB === "undefined") return;

  await createTransaction(SYNC_META_STORE, "readwrite", async (transaction) => {
    const store = transaction.objectStore(SYNC_META_STORE);
    await requestToPromise(store.put(meta));
  });
}

export async function clearCashflowCache() {
  if (typeof window !== "undefined") {
    try {
      sessionStorage.removeItem(LEGACY_SESSION_CACHE_KEY);
    } catch {
      // Ignore storage access errors (private mode, quota).
    }
  }

  if (typeof indexedDB === "undefined") return;

  await createTransaction(
    [ACCOUNTS_STORE, TRANSACTIONS_STORE, SYNC_META_STORE],
    "readwrite",
    async (transaction) => {
      await Promise.all([
        requestToPromise(transaction.objectStore(ACCOUNTS_STORE).clear()),
        requestToPromise(transaction.objectStore(TRANSACTIONS_STORE).clear()),
        requestToPromise(transaction.objectStore(SYNC_META_STORE).clear())
      ]);
    }
  );
}
