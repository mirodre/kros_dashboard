import {
  defaultValue,
  isValidValue,
  parseStoredValue,
  PREFERENCE_KEY_LIST,
  PREFERENCE_KEYS,
  type PreferenceKey,
  type PreferenceValueMap
} from "./registry";
import { migrationFromLocalStorage, resolvePreferences, type StoredValues } from "./resolve";
import type { TenantMeta } from "./repository";

/**
 * Klientský stav nastavení. Zámerne bez Reactu — `useSyncExternalStore` sedí až nad týmto
 * modulom (`src/lib/use-preference.ts`), takže sa celé správanie (zlučovanie zápisov,
 * migrácia, chovanie pri nedostupnom serveri) dá otestovať v node prostredí bez jsdom.
 *
 * Poradie je dôležité: `localStorage` je cache pre OKAMŽITÝ paint, server je zdroj pravdy,
 * ktorý stav dorovná až keď odpovie. Nikdy sa nečaká na sieť pred prvým vykreslením — inak
 * by človek videl nefiltrovaný dashboard a potom preskok.
 */
export type PreferenceSnapshot = {
  values: PreferenceValueMap;
  /** Kľúče, kde osobná hodnota prebíja firemnú. Podklad pre „Vrátiť sa na firemné". */
  personalKeys: PreferenceKey[];
  tenantMeta: TenantMeta | null;
  /** Server už odpovedal (aspoň raz). Dovtedy platí, čo bolo v prehliadači. */
  isLoaded: boolean;
  /** Človek bez firmy — zdieľanie sa neponúka. */
  isPersonalFallback: boolean;
};

type StorageLike = Pick<Storage, "getItem" | "setItem">;

export type StoreDeps = {
  storage: StorageLike | null;
  fetchImpl: typeof fetch;
  debounceMs: number;
};

const MIGRATED_FLAG_KEY = "kros_dashboard_prefs_migrated_v1";

type ServerResponse = {
  values?: Partial<PreferenceValueMap>;
  personalKeys?: string[];
  storedKeys?: string[];
  tenantMeta?: TenantMeta | null;
  isPersonalFallback?: boolean;
};

function knownKeys(keys: readonly string[] | undefined): PreferenceKey[] {
  return (keys ?? []).filter((key): key is PreferenceKey =>
    PREFERENCE_KEY_LIST.includes(key as PreferenceKey)
  );
}

function readLocalValues(storage: StorageLike | null): StoredValues {
  if (!storage) return {};

  const local: StoredValues = {};
  for (const key of PREFERENCE_KEY_LIST) {
    const raw = storage.getItem(PREFERENCE_KEYS[key].storageKey);
    const parsed = parseStoredValue(key, raw);
    if (parsed !== undefined && isValidValue(key, parsed)) {
      (local as Record<string, unknown>)[key] = parsed;
    }
  }
  return local;
}

function withDefaults(stored: StoredValues): PreferenceValueMap {
  return resolvePreferences({ tenant: {}, user: stored }).values;
}

export function createPreferenceStore(deps: StoreDeps) {
  const localValues = readLocalValues(deps.storage);
  const listeners = new Set<() => void>();

  let snapshot: PreferenceSnapshot = {
    values: withDefaults(localValues),
    personalKeys: [],
    tenantMeta: null,
    isLoaded: false,
    isPersonalFallback: false
  };

  let pending: Record<string, unknown> = {};
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inFlight: Promise<void> = Promise.resolve();

  function emit(next: Partial<PreferenceSnapshot>) {
    snapshot = { ...snapshot, ...next };
    for (const listener of listeners) listener();
  }

  function persistLocally(key: PreferenceKey, value: unknown) {
    (localValues as Record<string, unknown>)[key] = value;
    try {
      deps.storage?.setItem(PREFERENCE_KEYS[key].storageKey, JSON.stringify(value));
    } catch {
      // Plné alebo zakázané úložisko nesmie zhodiť zmenu filtra; server je aj tak zdroj pravdy.
    }
  }

  async function send(method: "PATCH" | "DELETE", body: unknown): Promise<boolean> {
    try {
      const response = await deps.fetchImpl("/api/preferences", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  async function flushNow(): Promise<void> {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }

    const batch = pending;
    pending = {};
    if (Object.keys(batch).length === 0) return;

    const ok = await send("PATCH", batch);
    if (!ok) {
      // Neúspešný zápis nie je chybová hláška: hodnota ostáva lokálne a pošle sa s ďalšou
      // zmenou alebo pri ďalšom načítaní stránky. Novšie hodnoty majú prednosť pred vrátenými.
      pending = { ...batch, ...pending };
      return;
    }

    emit({ personalKeys: [...new Set([...snapshot.personalKeys, ...knownKeys(Object.keys(batch))])] });
  }

  function scheduleFlush() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      inFlight = flushNow();
    }, deps.debounceMs);
  }

  function getSnapshot(): PreferenceSnapshot {
    return snapshot;
  }

  function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => void listeners.delete(listener);
  }

  function set<K extends PreferenceKey>(key: K, value: PreferenceValueMap[K]): void {
    if (!isValidValue(key, value)) return;

    persistLocally(key, value);
    emit({ values: { ...snapshot.values, [key]: value } });

    // Zápisy sa zlučujú: rýchle klikanie vo filtri má poslať jeden PATCH, nie dvadsať.
    pending = { ...pending, [key]: value };
    scheduleFlush();
  }

  /**
   * Jednorazové nahranie toho, čo si appka pamätala v prehliadači pred touto fázou.
   * Ide do OSOBNEJ úrovne — do firemnej nikdy, inak by prvý človek po nasadení prestavil
   * dashboard celej firme podľa toho, čo mal náhodou vo svojom prehliadači.
   */
  async function migrate(storedKeys: readonly PreferenceKey[]): Promise<void> {
    if (deps.storage?.getItem(MIGRATED_FLAG_KEY) === "1") return;

    const upload = migrationFromLocalStorage(localValues, storedKeys);
    if (Object.keys(upload).length > 0) {
      const ok = await send("PATCH", upload);
      if (!ok) return;

      emit({
        personalKeys: [...new Set([...snapshot.personalKeys, ...knownKeys(Object.keys(upload))])]
      });
    }

    try {
      deps.storage?.setItem(MIGRATED_FLAG_KEY, "1");
    } catch {
      // Bez príznaku sa migrácia skúsi znova; `storedKeys` ju aj tak druhýkrát nepustí.
    }
  }

  /** Načíta serverový stav a dorovná ním lokálny. Volá sa raz pri štarte appky. */
  async function load(): Promise<void> {
    let payload: ServerResponse | null = null;

    try {
      const response = await deps.fetchImpl("/api/preferences", { method: "GET" });
      if (response.ok) payload = (await response.json()) as ServerResponse;
    } catch {
      // Offline alebo nedostupný server: ostáva lokálny stav, appka funguje ďalej.
    }

    if (!payload) return;

    const storedKeys = knownKeys(payload.storedKeys);

    // Kľúč, ktorý čaká na odoslanie, sa serverovou hodnotou NEPREPISUJE. Bez toho by zmena
    // urobená v prvej sekunde po otvorení stránky preblikla späť na starú hodnotu — a o pár
    // set milisekúnd by ju zápis aj tak poslal na server. Teda rozpor medzi tým, čo človek
    // vidí, a tým, čo je uložené.
    const awaitingSend = new Set(Object.keys(pending));

    // Server prepisuje LEN kľúče, ktoré naozaj pozná. Ostatné ostávajú lokálne — inak by
    // prvé načítanie zmazalo nastavenia, ktoré sa ešte nestihli nahrať.
    const merged: StoredValues = { ...localValues };
    for (const key of storedKeys) {
      if (awaitingSend.has(key)) continue;

      const value = payload.values?.[key];
      if (value !== undefined && isValidValue(key, value)) {
        (merged as Record<string, unknown>)[key] = value;
        persistLocally(key, value);
      }
    }

    emit({
      values: withDefaults(merged),
      personalKeys: knownKeys(payload.personalKeys),
      tenantMeta: payload.tenantMeta ?? null,
      isLoaded: true,
      isPersonalFallback: payload.isPersonalFallback === true
    });

    await migrate(storedKeys);
  }

  /** „Nastaviť ako firemné predvolené" — hodnoty sa stanú firemnými pre celý tenant. */
  async function shareWithTenant(keys: PreferenceKey[]): Promise<boolean> {
    // Najprv sa doposiela, čo čaká na debounce: inak by firma dostala hodnotu, ktorú človek
    // práve prepísal a ešte neodoslal.
    await flushNow();

    const body: Record<string, unknown> = {};
    for (const key of keys) body[key] = snapshot.values[key];

    try {
      const response = await deps.fetchImpl("/api/preferences/tenant", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      if (!response.ok) return false;
    } catch {
      return false;
    }

    await load();
    return true;
  }

  /** „Vrátiť sa na firemné" — zmaže osobné prepísanie a načíta firemnú hodnotu. */
  async function resetToTenant(keys: PreferenceKey[]): Promise<boolean> {
    await flushNow();

    if (!(await send("DELETE", { keys }))) return false;

    await load();
    return true;
  }

  /** Len pre testy a odchod zo stránky: dopošle, čo čaká na debounce. */
  async function flush(): Promise<void> {
    await flushNow();
    await inFlight;
  }

  return { getSnapshot, subscribe, set, load, migrate, shareWithTenant, resetToTenant, flush };
}

export type PreferenceStore = ReturnType<typeof createPreferenceStore>;

/** Default pre server-side render: hodnoty z registra, žiadny prístup k `localStorage`. */
export const SERVER_SNAPSHOT: PreferenceSnapshot = {
  values: resolvePreferences({ tenant: {}, user: {} }).values,
  personalKeys: [],
  tenantMeta: null,
  isLoaded: false,
  isPersonalFallback: false
};

export { defaultValue };
