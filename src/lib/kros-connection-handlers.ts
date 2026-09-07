import type { ConnectionInput, ConnectionRepository, StoredConnection } from "./kros-connections";
import type { PreferenceScope } from "./preferences/scope";

export type HandlerResult = {
  status: number;
  body: unknown;
};

/**
 * Čisté handlery nad rozhraním úložiska — dôvod je ten istý ako pri nastaveniach: route
 * handler sa mimo Next runtime importovať nedá, takže by na pravidlo „nikto nevidí do
 * cudzej firmy" nešlo napísať test.
 *
 * `scope` je vždy PARAMETER zo session. Tenant sa z tela requestu nedá podstrčiť, lebo ho
 * odtiaľ nikto nečíta.
 */

function parseConnections(body: unknown): ConnectionInput[] | string {
  const raw = (body as { connections?: unknown })?.connections;
  if (!Array.isArray(raw) || raw.length === 0) {
    return "Telo požiadavky neobsahuje žiadne prepojenie.";
  }

  const parsed: ConnectionInput[] = [];
  for (const item of raw) {
    const connection = item as Partial<ConnectionInput>;
    if (
      typeof connection.companyId !== "number" ||
      !Number.isFinite(connection.companyId) ||
      typeof connection.companyName !== "string" ||
      connection.companyName === "" ||
      typeof connection.token !== "string" ||
      connection.token === ""
    ) {
      return "Prepojenie nemá platné companyId, companyName a token.";
    }

    parsed.push({
      companyId: connection.companyId,
      companyName: connection.companyName,
      token: connection.token,
      webhookSecret: typeof connection.webhookSecret === "string" ? connection.webhookSecret : undefined
    });
  }

  return parsed;
}

function unavailable(error: unknown): HandlerResult {
  console.error("Prepojenia: úložisko nedostupné:", error);
  return { status: 503, body: { error: "Prepojenia sa práve nedajú načítať." } };
}

export async function listConnections(
  repository: ConnectionRepository,
  scope: PreferenceScope
): Promise<HandlerResult> {
  try {
    const connections = await repository.list(scope.tenantId);

    return {
      status: 200,
      // Do prehliadača ide zoznam firiem, NIKDY tokeny — to je celý zmysel presunu na server.
      body: {
        connections: connections.map((connection) => ({
          companyId: connection.companyId,
          companyName: connection.companyName,
          connectedAt: connection.connectedAt
        }))
      }
    };
  } catch (error) {
    return unavailable(error);
  }
}

export async function saveConnections(
  repository: ConnectionRepository,
  scope: PreferenceScope,
  body: unknown
): Promise<HandlerResult> {
  const connections = parseConnections(body);
  if (typeof connections === "string") return { status: 400, body: { error: connections } };

  try {
    await repository.save(scope, connections);
    return { status: 200, body: { ok: true, count: connections.length } };
  } catch (error) {
    return unavailable(error);
  }
}

export async function removeConnection(
  repository: ConnectionRepository,
  scope: PreferenceScope,
  body: unknown
): Promise<HandlerResult> {
  const companyId = (body as { companyId?: unknown })?.companyId;
  if (typeof companyId !== "number" || !Number.isFinite(companyId)) {
    return { status: 400, body: { error: "Chýba companyId firmy, ktorú treba odpojiť." } };
  }

  try {
    await repository.remove(scope.tenantId, companyId);
    return { status: 200, body: { ok: true } };
  } catch (error) {
    return unavailable(error);
  }
}

/**
 * Prepojenia pre dátové routy. `companyIds` je len FILTER nad tým, čo firma naozaj má —
 * nie zoznam, ktorému by sa verilo: čo v úložisku tenanta nie je, sa nedá vyžiadať.
 */
export async function resolveConnections(
  repository: ConnectionRepository,
  scope: PreferenceScope,
  companyIds: unknown
): Promise<StoredConnection[]> {
  const all = await repository.list(scope.tenantId);

  if (!Array.isArray(companyIds) || companyIds.length === 0) return all;

  const wanted = new Set(companyIds.filter((id): id is number => typeof id === "number"));
  return all.filter((connection) => wanted.has(connection.companyId));
}
