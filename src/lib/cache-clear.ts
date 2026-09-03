import { PREFERENCE_KEYS, PREFERENCE_KEY_LIST } from "./preferences/registry";

/**
 * Kľúče, ktoré zmaže tlačidlo „Vymazať cache dát" v Nastaveniach.
 *
 * Zoznam je TU, a nie priamo v komponente, práve preto, aby sa naň dal napísať test:
 * odkedy sú filtre v tom istom `localStorage` ako cache dokladov, je jedna dobre mienená
 * „nech to vyčistí poriadne" úprava od toho, aby tlačidlo mazalo aj nastavenia. Na serveri
 * by prežili, takže by sa to prejavilo len ako záhadný návrat filtrov — chyba, ktorú nikto
 * nenahlási zrozumiteľne.
 *
 * Doklady samotné žijú v IndexedDB a mažú ich `clearInvoiceCache()` a spol.
 */
export const CLEARED_LOCAL_KEYS = ["kros_dashboard_last_sync_at"] as const;

/** Kľúče nastavení, ktorých sa tlačidlo NESMIE dotknúť. */
export const PROTECTED_PREFERENCE_KEYS = PREFERENCE_KEY_LIST.map((key) => PREFERENCE_KEYS[key].storageKey);

export function clearLocalDataCacheKeys(storage: Pick<Storage, "removeItem">): void {
  for (const key of CLEARED_LOCAL_KEYS) {
    storage.removeItem(key);
  }
}
