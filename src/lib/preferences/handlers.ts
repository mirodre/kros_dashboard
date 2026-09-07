import { isPreferenceKey, isTenantKey, isValidValue, type PreferenceKey } from "./registry";
import type { PreferenceRepository } from "./repository";
import { resolvePreferences } from "./resolve";
import type { PreferenceScope } from "./scope";

export type HandlerResult = {
  status: number;
  body: unknown;
};

/**
 * Handlery sú čisté funkcie nad rozhraním úložiska a scope-om — v route súboroch zostáva len
 * `auth()` a prevod na `Response`. Dôvod je ten istý ako pri `auth-callbacks.ts`: route
 * handler sa mimo Next runtime importovať nedá, takže by na najdôležitejšie pravidlo appky
 * (nikto nevidí do cudzieho tenanta) nešiel napísať test.
 *
 * `scope` je PARAMETER, nikdy nie súčasť tela requestu. Práve preto sa `tenantId` z tela
 * nedá podstrčiť — nie je kam.
 */

function parseEntries(body: unknown, options: { tenantOnly: boolean }): Record<string, unknown> | string {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return "Telo požiadavky musí byť objekt s nastaveniami.";
  }

  const entries: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(body)) {
    if (!isPreferenceKey(key)) {
      return `Neznáme nastavenie: ${key}`;
    }
    if (!isValidValue(key, value)) {
      return `Neplatná hodnota nastavenia: ${key}`;
    }
    if (options.tenantOnly && !isTenantKey(key)) {
      return `Nastavenie ${key} je osobné a nedá sa zdieľať firme.`;
    }
    entries[key] = value;
  }

  if (Object.keys(entries).length === 0) {
    return "Telo požiadavky neobsahuje žiadne nastavenie.";
  }

  return entries;
}

function parseKeys(body: unknown): PreferenceKey[] | string {
  const keys = (body as { keys?: unknown })?.keys;
  if (!Array.isArray(keys) || keys.length === 0) {
    return "Chýba zoznam kľúčov na zmazanie.";
  }

  const parsed: PreferenceKey[] = [];
  for (const key of keys) {
    if (typeof key !== "string" || !isPreferenceKey(key)) {
      return `Neznáme nastavenie: ${String(key)}`;
    }
    parsed.push(key);
  }

  return parsed;
}

/** Nedostupná databáza nie je chyba klienta ani dôvod na pád — appka beží ďalej lokálne. */
function unavailable(error: unknown): HandlerResult {
  console.error("Nastavenia: úložisko nedostupné:", error);
  return { status: 503, body: { error: "Nastavenia sa práve nedajú načítať zo servera." } };
}

/**
 * Počet ľudí, ktorí firmu v appke otvorili. Zlyhanie zapíšeme a vrátime `null`: nastavenia
 * sa musia načítať aj vtedy, keď sa evidencia členov nepodarí — je to len podklad pre to,
 * či ponúknuť zdieľanie filtrov.
 */
async function countMembers(
  repository: PreferenceRepository,
  scope: PreferenceScope
): Promise<number | null> {
  if (scope.isPersonalFallback) return null;
  try {
    return await repository.touchMember(scope);
  } catch (error) {
    console.error("Nastavenia: evidencia členov firmy zlyhala:", error);
    return null;
  }
}

export async function getPreferences(
  repository: PreferenceRepository,
  scope: PreferenceScope
): Promise<HandlerResult> {
  try {
    const levels = await repository.read(scope);
    const resolved = resolvePreferences(levels);

    return {
      status: 200,
      body: {
        values: resolved.values,
        personalKeys: resolved.personalKeys,
        storedKeys: resolved.storedKeys,
        tenantMeta: levels.tenantMeta,
        isPersonalFallback: scope.isPersonalFallback,
        memberCount: await countMembers(repository, scope)
      }
    };
  } catch (error) {
    return unavailable(error);
  }
}

export async function patchPersonal(
  repository: PreferenceRepository,
  scope: PreferenceScope,
  body: unknown
): Promise<HandlerResult> {
  const entries = parseEntries(body, { tenantOnly: false });
  if (typeof entries === "string") return { status: 400, body: { error: entries } };

  try {
    await repository.writeUser(scope, entries);
    return { status: 200, body: { ok: true } };
  } catch (error) {
    return unavailable(error);
  }
}

export async function putTenant(
  repository: PreferenceRepository,
  scope: PreferenceScope,
  body: unknown
): Promise<HandlerResult> {
  const entries = parseEntries(body, { tenantOnly: true });
  if (typeof entries === "string") return { status: 400, body: { error: entries } };

  try {
    // Zdieľanie firemnej hodnoty zmaže osobné prepísanie toho, kto zdieľa — inak by ako
    // jediný nevidel to, čo práve nastavil všetkým, a hlásil by to ako chybu.
    await repository.writeTenant(scope, entries);
    await repository.deleteUser(scope, Object.keys(entries));
    return { status: 200, body: { ok: true } };
  } catch (error) {
    return unavailable(error);
  }
}

export async function deletePersonal(
  repository: PreferenceRepository,
  scope: PreferenceScope,
  body: unknown
): Promise<HandlerResult> {
  const keys = parseKeys(body);
  if (typeof keys === "string") return { status: 400, body: { error: keys } };

  try {
    await repository.deleteUser(scope, keys);
    return { status: 200, body: { ok: true } };
  } catch (error) {
    return unavailable(error);
  }
}
