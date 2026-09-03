import {
  isValidValue,
  PREFERENCE_KEY_LIST,
  PREFERENCE_KEYS,
  type PreferenceKey,
  type PreferenceValueMap
} from "./registry";

/** Hodnoty tak, ako ležia v jednej úrovni úložiska. Chýbajúci kľúč = úroveň ho nemá. */
export type StoredValues = Partial<Record<PreferenceKey, unknown>>;

export type ResolvedPreferences = {
  /** Každý kľúč z registra — vždy s hodnotou, aj keby to mal byť default. */
  values: PreferenceValueMap;
  /** Kľúče, kde osobná hodnota prebila firemnú (podklad pre „Vrátiť sa na firemné"). */
  personalKeys: PreferenceKey[];
  /** Kľúče, ktoré server pozná na niektorej úrovni. Čo tu nie je, sa smie migrovať. */
  storedKeys: PreferenceKey[];
};

/**
 * `osobné ?? firemné ?? default`. Neplatná hodnota v úložisku sa správa, akoby tam nebola —
 * appka nesmie spadnúť na tom, čo do DB zapísala jej staršia verzia alebo ručný zásah.
 */
export function resolvePreferences(levels: { tenant: StoredValues; user: StoredValues }): ResolvedPreferences {
  const values = {} as PreferenceValueMap;
  const personalKeys: PreferenceKey[] = [];
  const storedKeys: PreferenceKey[] = [];

  for (const key of PREFERENCE_KEY_LIST) {
    const personal = levels.user[key];
    const shared = levels.tenant[key];
    const hasPersonal = personal !== undefined && isValidValue(key, personal);
    const hasShared = shared !== undefined && isValidValue(key, shared);

    if (hasPersonal || hasShared) storedKeys.push(key);
    if (hasPersonal) personalKeys.push(key);

    // Zápis cez `as never` je jediná cesta, ako sa v cykle nad zväzom kľúčov dostať k typu
    // konkrétneho kľúča; hodnotu už overila `isValidValue`.
    (values as Record<string, unknown>)[key] = hasPersonal
      ? personal
      : hasShared
        ? shared
        : PREFERENCE_KEYS[key].default;
  }

  return { values, personalKeys, storedKeys };
}

/**
 * Čo z prehliadača nahrať na server pri prvom načítaní po nasadení.
 *
 * Nahráva sa LEN kľúč, ktorý server nepozná na žiadnej úrovni. Keby sa nahrávalo aj to, čo
 * server má, vrátil by sa zmazaný filter z mŕtvych pri každom otvorení appky na zariadení,
 * kde ešte leží stará hodnota.
 */
export function migrationFromLocalStorage(
  local: StoredValues,
  storedKeys: readonly PreferenceKey[]
): Partial<Record<PreferenceKey, unknown>> {
  const known = new Set(storedKeys);
  const upload: Partial<Record<PreferenceKey, unknown>> = {};

  for (const key of PREFERENCE_KEY_LIST) {
    if (known.has(key)) continue;

    const value = local[key];
    if (value === undefined || !isValidValue(key, value)) continue;

    upload[key] = value;
  }

  return upload;
}
