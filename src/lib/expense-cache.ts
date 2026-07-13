import type { NormalizedExpense } from "./kros-types";

/**
 * Persistent IndexedDB cache for the Výdavky (expenses) module — same pattern
 * as `invoice-cache.ts` for the Biznis module: month-based full sync plus
 * incremental refresh via LastModifiedTimestamp.
 */
const DB_NAME = "kros_dashboard_expenses_cache";
// v7: sync aj analytiky idú podľa dátumu dodania (deliveryDate) — staršie verzie
// ho nemajú, upgrade preto starú cache premaže a stiahne sa nanovo.
// Pozn.: analytiky počítajú z totalPriceInclVat (suma s DPH) — KROS pri výdavkoch
// sumu bez DPH ani rozpis DPH neposkytuje, pozri readPrices v expenses-live.ts.
const DB_VERSION = 7;
const EXPENSES_STORE = "expenses";
const SYNC_META_STORE = "syncMeta";

export type CachedExpense = NormalizedExpense & {
  cacheKey: string;
  cacheCompanyId: number;
};

export type ExpenseSyncMeta = {
  key: string;
  companyId: number;
  range: "ytd" | "history";
  monthKey?: string;
  completedAt?: string;
  lastModifiedTimestamp?: string;
};

function openCacheDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = request.result;
      if (!db.objectStoreNames.contains(EXPENSES_STORE)) {
        const store = db.createObjectStore(EXPENSES_STORE, { keyPath: "cacheKey" });
        store.createIndex("cacheCompanyId", "cacheCompanyId", { unique: false });
      }
      if (!db.objectStoreNames.contains(SYNC_META_STORE)) {
        db.createObjectStore(SYNC_META_STORE, { keyPath: "key" });
      }

      // Cache je len lokálna kópia dát z API — pri akomkoľvek zvýšení verzie ju
      // premažeme a nechám sa stiahnuť nanovo (žiadne per-verzia migrácie).
      const upgradeTransaction = request.transaction;
      if (event.oldVersion > 0 && event.oldVersion < DB_VERSION && upgradeTransaction) {
        upgradeTransaction.objectStore(EXPENSES_STORE).clear();
        upgradeTransaction.objectStore(SYNC_META_STORE).clear();
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

function expenseCacheKey(companyId: number, expenseId: string) {
  return `${companyId}:${expenseId}`;
}

export function expenseMonthMetaKey(companyId: number, range: ExpenseSyncMeta["range"], monthKey: string) {
  return `month:${range}:${companyId}:${monthKey}`;
}

export function expenseCompanyMetaKey(companyId: number, range: ExpenseSyncMeta["range"]) {
  return `company:${range}:${companyId}`;
}

export async function getCachedExpenses(companyIds: number[]) {
  if (typeof indexedDB === "undefined" || companyIds.length === 0) return [];

  const companySet = new Set(companyIds);
  return createTransaction(EXPENSES_STORE, "readonly", async (transaction) => {
    const store = transaction.objectStore(EXPENSES_STORE);
    const expenses = (await requestToPromise(store.getAll())) as CachedExpense[];
    return expenses.filter((expense) => companySet.has(expense.cacheCompanyId));
  });
}

export async function upsertCachedExpenses(companyId: number, expenses: NormalizedExpense[]) {
  if (typeof indexedDB === "undefined") return;

  await createTransaction(EXPENSES_STORE, "readwrite", async (transaction) => {
    const store = transaction.objectStore(EXPENSES_STORE);
    await Promise.all(
      expenses
        .filter((expense) => expense.id)
        .map((expense) =>
          requestToPromise(
            store.put({
              ...expense,
              cacheCompanyId: companyId,
              cacheKey: expenseCacheKey(companyId, expense.id)
            } satisfies CachedExpense)
          )
        )
    );
  });
}

export async function readExpenseSyncMeta(key: string) {
  if (typeof indexedDB === "undefined") return null;

  return createTransaction(SYNC_META_STORE, "readonly", async (transaction) => {
    const store = transaction.objectStore(SYNC_META_STORE);
    const result = (await requestToPromise(store.get(key))) as ExpenseSyncMeta | undefined;
    return result ?? null;
  });
}

export async function writeExpenseSyncMeta(meta: ExpenseSyncMeta) {
  if (typeof indexedDB === "undefined") return;

  await createTransaction(SYNC_META_STORE, "readwrite", async (transaction) => {
    const store = transaction.objectStore(SYNC_META_STORE);
    await requestToPromise(store.put(meta));
  });
}

export async function clearExpenseCache() {
  if (typeof indexedDB === "undefined") return;

  await createTransaction([EXPENSES_STORE, SYNC_META_STORE], "readwrite", async (transaction) => {
    await Promise.all([
      requestToPromise(transaction.objectStore(EXPENSES_STORE).clear()),
      requestToPromise(transaction.objectStore(SYNC_META_STORE).clear())
    ]);
  });
}
