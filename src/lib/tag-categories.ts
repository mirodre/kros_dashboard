import type { AggregatedBreakdownPoint } from "./kros-types";

/** Kategória pre štítky, ktoré v KROS nemajú priradenú kategóriu (alebo pre neotagované doklady). */
export const UNCATEGORIZED_CATEGORY = "Nedefinované";

/** Kľúč filtra pre režim bez kategórií (jedna spoločná sekcia štítkov). */
export const FLAT_TAG_FILTER_KEY = "__all__";

/**
 * Index mapujúci názov štítku na názov jeho kategórie. Kľúče sú v malých písmenách,
 * lebo KROS páruje štítky bez ohľadu na veľkosť písmen.
 */
export type TagCategoryIndex = {
  categoryByTag: Map<string, string>;
};

/**
 * Aktívne filtre podľa kategórie. Chýbajúci kľúč = všetky štítky kategórie.
 * Neprázdne pole = povolené len tieto štítky. Kategórie sa spájajú cez AND,
 * štítky v rámci kategórie cez OR.
 */
export type TagCategoryFilters = Record<string, string[]>;

export const EMPTY_TAG_CATEGORY_INDEX: TagCategoryIndex = {
  categoryByTag: new Map()
};

type RawTag = {
  name?: unknown;
  category?: { name?: unknown } | null;
};

/** Postaví index z odpovede endpointu /api/kros/tags (pole TagResponse objektov). */
export function buildTagCategoryIndex(rawTags: unknown[]): TagCategoryIndex {
  const categoryByTag = new Map<string, string>();

  for (const rawTag of rawTags) {
    const tag = rawTag as RawTag;
    const name = typeof tag.name === "string" ? tag.name.trim() : "";
    if (!name) continue;

    const categoryName =
      tag.category && typeof tag.category.name === "string" && tag.category.name.trim()
        ? tag.category.name.trim()
        : UNCATEGORIZED_CATEGORY;

    const key = name.toLowerCase();
    const existing = categoryByTag.get(key);
    // Pri viacerých firmách: skutočná kategória má prednosť pred „Nedefinované“,
    // aby neskôr prichádzajúci štítok bez kategórie neprepísal správne zaradenie.
    if (existing && existing !== UNCATEGORIZED_CATEGORY && categoryName === UNCATEGORIZED_CATEGORY) {
      continue;
    }
    categoryByTag.set(key, categoryName);
  }

  return { categoryByTag };
}

/** Vráti kategóriu daného štítku; štítky bez záznamu spadajú do „Nedefinované“. */
export function categoryForTag(index: TagCategoryIndex, tagName: string): string {
  return index.categoryByTag.get(tagName.trim().toLowerCase()) ?? UNCATEGORIZED_CATEGORY;
}

/** True, ak poznáme aspoň jednu skutočnú (neprázdnu) kategóriu štítkov. */
export function hasRealCategories(index: TagCategoryIndex): boolean {
  for (const category of index.categoryByTag.values()) {
    if (category !== UNCATEGORIZED_CATEGORY) return true;
  }
  return false;
}

export function hasActiveTagFilters(filters: TagCategoryFilters): boolean {
  return Object.values(filters).some((selected) => selected.length > 0);
}

/** True, ak štítok nie je odfiltrovaný aktívnym filtrom svojej kategórie. */
export function isTagAllowedByFilters(
  tagName: string,
  filters: TagCategoryFilters,
  index: TagCategoryIndex
): boolean {
  const flat = filters[FLAT_TAG_FILTER_KEY];
  if (flat && flat.length > 0) {
    return flat.some((tag) => tag.toLowerCase() === tagName.trim().toLowerCase());
  }

  const category = categoryForTag(index, tagName);
  const selected = filters[category];
  if (!selected || selected.length === 0) return true;
  return selected.some((tag) => tag.toLowerCase() === tagName.trim().toLowerCase());
}

/**
 * Doklad prejde filtrom, ak spĺňa každú aktívnu kategóriu (AND). V rámci kategórie stačí
 * jeden zo zvolených štítkov (OR).
 *
 * Rozkliknuté štítky sú samostatné podmienky, ale s tou istou logikou: focus na dvoch
 * štítkoch JEDNEJ kategórie výber ROZŠÍRI (Apartmán 1 alebo Apartmán 2), focus v dvoch
 * rôznych kategóriách ho zúži (Apartmán 1 a zároveň Náklady 2). Predtým sa focus vyhodnocoval
 * ako čisté AND, čo pri dvoch štítkoch tej istej kategórie nemohlo vyjsť nikdy — doklad nesie
 * v jednej dimenzii spravidla jediný štítok, takže prehľad zostal prázdny.
 *
 * `index` je nepovinný: bez skutočných kategórií žijú všetky štítky v jednej spoločnej
 * sekcii, takže sa focus vyhodnotí ako jedno OR — presne ako pri jedinej kategórii.
 */
export function documentMatchesTagFilters(
  documentTags: string[],
  filters: TagCategoryFilters,
  focusedTags: string[] = [],
  index: TagCategoryIndex = EMPTY_TAG_CATEGORY_INDEX
): boolean {
  const documentTagSet = new Set(documentTags.map((tag) => tag.trim().toLowerCase()));

  const constraints = Object.values(filters).filter((selected) => selected.length > 0);

  const focusByCategory = new Map<string, string[]>();
  for (const tag of focusedTags) {
    const category = tagFilterKey(index, tag);
    focusByCategory.set(category, [...(focusByCategory.get(category) ?? []), tag]);
  }
  constraints.push(...focusByCategory.values());

  if (constraints.length === 0) return true;

  return constraints.every((selected) =>
    selected.some((tag) => documentTagSet.has(tag.trim().toLowerCase()))
  );
}

/** Nastaví / zruší filter jednej kategórie. Prázdny výber = všetky štítky (bez filtra). */
export function setCategoryTagFilter(
  filters: TagCategoryFilters,
  category: string,
  selected: string[]
): TagCategoryFilters {
  const next = { ...filters };
  if (selected.length === 0) {
    delete next[category];
  } else {
    next[category] = selected;
  }
  return next;
}

/**
 * Kľúč, pod ktorý štítok patrí vo filtri aj vo fokuse. Bez skutočných kategórií
 * (KROS ich nemá vyplnené) žijú všetky štítky v jednej spoločnej sekcii.
 */
export function tagFilterKey(index: TagCategoryIndex, tagName: string): string {
  return hasRealCategories(index) ? categoryForTag(index, tagName) : FLAT_TAG_FILTER_KEY;
}

/** Všetky explicitne zvolené štítky naprieč kategóriami (na kontrolu focusu a pod.). */
export function allSelectedTags(filters: TagCategoryFilters): string[] {
  return Object.values(filters).flat();
}

/**
 * Zrovná uloženú hodnotu filtra na dnešný tvar. Zvlášť od `parseStoredTagFilters`, lebo tú
 * istú normalizáciu potrebuje aj register nastavení (`src/lib/preferences/registry.ts`) nad
 * hodnotou, ktorá už prešla `JSON.parse` — a bez nej by sa STARÝ plochý formát (pole štítkov
 * bez kategórií) zahodil ako neplatný a ľuďom by pri prvom načítaní zmizli filtre.
 */
export function normalizeTagFilters(parsed: unknown): TagCategoryFilters {
  if (Array.isArray(parsed)) {
    const tags = parsed.filter((tag): tag is string => typeof tag === "string");
    return tags.length > 0 ? { [FLAT_TAG_FILTER_KEY]: tags } : {};
  }

  if (parsed && typeof parsed === "object") {
    const result: TagCategoryFilters = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (!Array.isArray(value)) continue;
      const tags = value.filter((tag): tag is string => typeof tag === "string");
      if (tags.length > 0) result[key] = tags;
    }
    return result;
  }

  return {};
}

export function parseStoredTagFilters(raw: string | null): TagCategoryFilters {
  if (!raw) return {};
  try {
    return normalizeTagFilters(JSON.parse(raw) as unknown);
  } catch {
    // Ignore invalid persisted filter payload.
  }
  return {};
}

/** Starý flat filter rozdelí do kategórií, keď už poznáme index. */
export function migrateFlatFiltersToCategories(
  filters: TagCategoryFilters,
  index: TagCategoryIndex
): TagCategoryFilters {
  const flat = filters[FLAT_TAG_FILTER_KEY];
  if (!flat || flat.length === 0 || !hasRealCategories(index)) return filters;

  const byCategory: TagCategoryFilters = {};
  for (const tag of flat) {
    const category = categoryForTag(index, tag);
    const bucket = byCategory[category] ?? [];
    bucket.push(tag);
    byCategory[category] = bucket;
  }
  return byCategory;
}

export type TagCategoryGroup = {
  category: string;
  points: AggregatedBreakdownPoint[];
};

const collator = new Intl.Collator("sk-SK", { sensitivity: "base" });

/** Kategórie abecedne, „Nedefinované“ vždy posledné — rovnaké poradie ako sekcie štítkov. */
export function sortTagCategories(categories: string[]): string[] {
  return [...categories].sort((a, b) => {
    if (a === UNCATEGORIZED_CATEGORY) return 1;
    if (b === UNCATEGORIZED_CATEGORY) return -1;
    return collator.compare(a, b);
  });
}

/**
 * Zoskupí breakdown body podľa kategórie štítku. Kategórie sú zoradené abecedne,
 * „Nedefinované“ je vždy posledné. Poradie bodov v rámci kategórie ostáva zachované.
 */
export function groupTagPointsByCategory(
  points: AggregatedBreakdownPoint[],
  index: TagCategoryIndex
): TagCategoryGroup[] {
  const groups = new Map<string, AggregatedBreakdownPoint[]>();

  for (const point of points) {
    const category = categoryForTag(index, point.name);
    const bucket = groups.get(category);
    if (bucket) {
      bucket.push(point);
    } else {
      groups.set(category, [point]);
    }
  }

  return Array.from(groups.entries())
    .map(([category, categoryPoints]) => ({ category, points: categoryPoints }))
    .sort((a, b) => {
      if (a.category === UNCATEGORIZED_CATEGORY) return 1;
      if (b.category === UNCATEGORIZED_CATEGORY) return -1;
      return collator.compare(a.category, b.category);
    });
}
