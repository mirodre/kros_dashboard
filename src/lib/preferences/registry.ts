import type { Granularity } from "@/lib/mock-data";

/**
 * Jediné miesto pravdy o tom, čo si appka pamätá a na akej úrovni.
 *
 * `tenant` = firemné nastavenie zdieľané všetkými v tenante, s možnosťou osobného
 * prepísania. `user` = ergonómia jedného človeka; zdieľať zbalenie panela alebo granularitu
 * by znamenalo prestavovať kolegovi obrazovku pri každom kliknutí.
 *
 * Kto sem pridáva kľúč, MUSÍ sa rozhodnúť pre úroveň — test v `resolve.test.ts` stráži, že
 * ergonomické kľúče na firemnú úroveň neprepadnú.
 */
export type PreferenceLevel = "tenant" | "user";

export type PreferenceValueMap = {
  "revenue.tagFilters": Record<string, string[]>;
  "revenue.companies": string[];
  "expenses.tagFilters": Record<string, string[]>;
  "expenses.companies": string[];
  "cashflow.companies": string[];
  "ui.granularity": Granularity;
  "ui.collapsed.tagCategories": string[];
  "ui.collapsed.companies": boolean;
  "ui.collapsed.expensesCompanies": boolean;
  "ui.collapsed.recentInvoices": boolean;
  "ui.collapsed.recentExpenses": boolean;
  "ui.collapsed.expenseVendors": boolean;
};

export type PreferenceKey = keyof PreferenceValueMap;

type Definition<K extends PreferenceKey> = {
  level: PreferenceLevel;
  /**
   * Kľúč, pod ktorým hodnota žije v `localStorage`. Zámerne to sú DNEŠNÉ mená: lokálne
   * úložisko zostáva cache nad serverom, takže po nasadení tam ľudia nájdu svoje filtre bez
   * akejkoľvek migrácie v prehliadači, a keby sa nasadenie vrátilo, appka o ne nepríde.
   */
  storageKey: string;
  default: PreferenceValueMap[K];
  isValid: (value: unknown) => value is PreferenceValueMap[K];
};

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isTagFilters(value: unknown): value is Record<string, string[]> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  return Object.values(value as Record<string, unknown>).every(isStringArray);
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === "boolean";
}

function isGranularity(value: unknown): value is Granularity {
  return value === "week" || value === "month" || value === "year";
}

/**
 * Zbalenie panela je päťkrát tá istá definícia. Návratový typ je napísaný štrukturálne
 * (`default: boolean`), nie ako `Definition<konkrétny kľúč>` — inak by sa hodnota dala
 * priradiť len tomu jednému kľúču, od ktorého by generický parameter pochádzal.
 */
const collapsedPanel = (
  storageKey: string
): { level: PreferenceLevel; storageKey: string; default: boolean; isValid: (value: unknown) => value is boolean } => ({
  level: "user",
  storageKey,
  default: false,
  isValid: isBoolean
});

export const PREFERENCE_KEYS: { [K in PreferenceKey]: Definition<K> } = {
  "revenue.tagFilters": {
    level: "tenant",
    storageKey: "kros_dashboard_selected_tags",
    default: {},
    isValid: isTagFilters
  },
  "revenue.companies": {
    level: "tenant",
    storageKey: "kros_dashboard_revenue_selected_companies",
    default: [],
    isValid: isStringArray
  },
  "expenses.tagFilters": {
    level: "tenant",
    storageKey: "kros_dashboard_expenses_selected_tags",
    default: {},
    isValid: isTagFilters
  },
  "expenses.companies": {
    level: "tenant",
    storageKey: "kros_dashboard_expenses_selected_companies",
    default: [],
    isValid: isStringArray
  },
  "cashflow.companies": {
    level: "tenant",
    storageKey: "kros_dashboard_cashflow_selected_companies",
    default: [],
    isValid: isStringArray
  },
  "ui.granularity": {
    level: "user",
    // Novy kluc: granularita dnes zije v `globalThis` a straca sa pri kazdom reloade.
    storageKey: "kros_dashboard_granularity",
    default: "month",
    isValid: isGranularity
  },
  "ui.collapsed.tagCategories": {
    level: "user",
    storageKey: "kros_dashboard_collapsed_tag_categories",
    default: [],
    isValid: isStringArray
  },
  "ui.collapsed.companies": collapsedPanel("kros_dashboard_collapsed_companies"),
  "ui.collapsed.expensesCompanies": collapsedPanel("kros_dashboard_expenses_collapsed_companies"),
  "ui.collapsed.recentInvoices": collapsedPanel("kros_dashboard_collapsed_recent_invoices"),
  "ui.collapsed.recentExpenses": collapsedPanel("kros_dashboard_collapsed_recent_expenses"),
  "ui.collapsed.expenseVendors": collapsedPanel("kros_dashboard_collapsed_expense_vendors")
};

export const PREFERENCE_KEY_LIST = Object.keys(PREFERENCE_KEYS) as PreferenceKey[];

export function isPreferenceKey(key: string): key is PreferenceKey {
  return Object.hasOwn(PREFERENCE_KEYS, key);
}

/** Kľúč prijme hodnotu, len ak sedí typ aj úroveň. Neznámy kľúč neprijme nič. */
export function isValidValue(key: string, value: unknown): boolean {
  return isPreferenceKey(key) && PREFERENCE_KEYS[key].isValid(value);
}

export function isTenantKey(key: string): boolean {
  return isPreferenceKey(key) && PREFERENCE_KEYS[key].level === "tenant";
}

export function defaultValue<K extends PreferenceKey>(key: K): PreferenceValueMap[K] {
  return PREFERENCE_KEYS[key].default;
}

/**
 * Prečíta hodnotu tak, ako ju do `localStorage` zapísala niektorá zo starších verzií appky.
 * Zbalenie panela sa kedysi ukladalo ako `"1"` / `"0"` (`usePersistedCollapsed`), nie ako
 * JSON — bez tohto by sa všetkým pri prvom načítaní všetky panely rozbalili.
 */
export function parseStoredValue(key: PreferenceKey, raw: string | null): unknown {
  if (raw === null || raw === "") return undefined;

  // Len pri booleovskych klucoch: `"1"` v poli firiem by bola nezmyselna hodnota, ktoru ma
  // zahodit validacia, nie ju domysliet na `true`.
  if (typeof PREFERENCE_KEYS[key].default === "boolean") {
    if (raw === "1") return true;
    if (raw === "0") return false;
  }

  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}
