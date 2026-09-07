"use client";

import { useCallback, useSyncExternalStore } from "react";

import { defaultValue, type PreferenceKey, type PreferenceValueMap } from "./preferences/registry";
import {
  createPreferenceStore,
  SERVER_SNAPSHOT,
  type PreferenceSnapshot,
  type PreferenceStore
} from "./preferences/store";

let store: PreferenceStore | null = null;

/**
 * Jeden store na celú appku. Nie React context: nastavenia číta aj `usePersistedCollapsed`
 * hlboko v strome a provider okolo každej stránky by bol len obal navyše — tu nejde
 * o hodnoty viazané na miesto v strome, ale o jeden globálny stav.
 */
export function preferenceStore(): PreferenceStore {
  store ??= createPreferenceStore({
    storage: typeof window === "undefined" ? null : window.localStorage,
    fetchImpl: (input, init) => fetch(input, init),
    // Rádovo stovky milisekúnd: dosť na zlúčenie klikania vo filtri, málo na to, aby sa
    // stratilo pri zavretí stránky.
    debounceMs: 800
  });

  return store;
}

export function usePreferences(): PreferenceSnapshot {
  return useSyncExternalStore(
    (listener) => preferenceStore().subscribe(listener),
    () => preferenceStore().getSnapshot(),
    // Server render nemá `localStorage`, takže tam platia defaulty z registra. Prvý paint
    // v prehliadači už má hodnoty z úložiska — bez čakania na sieť.
    () => SERVER_SNAPSHOT
  );
}

export function usePreference<K extends PreferenceKey>(
  key: K
): [PreferenceValueMap[K], (value: PreferenceValueMap[K]) => void] {
  const value = useSyncExternalStore(
    (listener) => preferenceStore().subscribe(listener),
    () => preferenceStore().getSnapshot().values[key],
    () => defaultValue(key)
  );

  const setValue = useCallback((next: PreferenceValueMap[K]) => preferenceStore().set(key, next), [key]);

  return [value, setValue];
}
