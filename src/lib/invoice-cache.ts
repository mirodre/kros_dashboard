import type { NormalizedInvoice } from "./kros-types";

const DB_NAME = "kros_dashboard_cache";
const DB_VERSION = 1;
const INVOICES_STORE = "invoices";
const SYNC_META_STORE = "syncMeta";

export type CachedInvoice = NormalizedInvoice & {
  cacheKey: string;
  companyId: number;
};

export type SyncMeta = {
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

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(INVOICES_STORE)) {
        const store = db.createObjectStore(INVOICES_STORE, { keyPath: "cacheKey" });
        store.createIndex("companyId", "companyId", { unique: false });
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

function invoiceCacheKey(companyId: number, invoiceId: string) {
  return `${companyId}:${invoiceId}`;
}

export function monthKeyFromDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export function syncMonthMetaKey(companyId: number, range: SyncMeta["range"], monthKey: string) {
  return `month:${range}:${companyId}:${monthKey}`;
}

export function syncCompanyMetaKey(companyId: number, range: SyncMeta["range"]) {
  return `company:${range}:${companyId}`;
}

export async function getCachedInvoices(companyIds: number[]) {
  if (typeof indexedDB === "undefined" || companyIds.length === 0) return [];

  const companySet = new Set(companyIds);
  return createTransaction(INVOICES_STORE, "readonly", async (transaction) => {
    const store = transaction.objectStore(INVOICES_STORE);
    const invoices = (await requestToPromise(store.getAll())) as CachedInvoice[];
    return invoices.filter((invoice) => companySet.has(invoice.companyId));
  });
}

export async function upsertCachedInvoices(companyId: number, invoices: NormalizedInvoice[]) {
  if (typeof indexedDB === "undefined") return;

  await createTransaction(INVOICES_STORE, "readwrite", async (transaction) => {
    const store = transaction.objectStore(INVOICES_STORE);
    await Promise.all(
      invoices
        .filter((invoice) => invoice.id)
        .map((invoice) =>
          requestToPromise(
            store.put({
              ...invoice,
              companyId,
              cacheKey: invoiceCacheKey(companyId, invoice.id)
            } satisfies CachedInvoice)
          )
        )
    );
  });
}

export async function readSyncMeta(key: string) {
  if (typeof indexedDB === "undefined") return null;

  return createTransaction(SYNC_META_STORE, "readonly", async (transaction) => {
    const store = transaction.objectStore(SYNC_META_STORE);
    const result = (await requestToPromise(store.get(key))) as SyncMeta | undefined;
    return result ?? null;
  });
}

export async function writeSyncMeta(meta: SyncMeta) {
  if (typeof indexedDB === "undefined") return;

  await createTransaction(SYNC_META_STORE, "readwrite", async (transaction) => {
    const store = transaction.objectStore(SYNC_META_STORE);
    await requestToPromise(store.put(meta));
  });
}

export async function clearInvoiceCache() {
  if (typeof indexedDB === "undefined") return;

  await createTransaction([INVOICES_STORE, SYNC_META_STORE], "readwrite", async (transaction) => {
    await Promise.all([
      requestToPromise(transaction.objectStore(INVOICES_STORE).clear()),
      requestToPromise(transaction.objectStore(SYNC_META_STORE).clear())
    ]);
  });
}
