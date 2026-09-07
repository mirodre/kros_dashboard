import type { Pool } from "pg";

import type { PreferenceScope } from "./preferences/scope";
import { decryptToken, encryptToken } from "./token-crypto";

/** Prepojenie tak, ako ho posiela KROS consent — vrátane tokenu. Nikdy neopúšťa server. */
export type ConnectionInput = {
  companyId: number;
  companyName: string;
  token: string;
  webhookSecret?: string;
};

export type StoredConnection = ConnectionInput & {
  connectedAt: string;
  connectedBySub: string;
};

/** Čo o prepojení smie vedieť prehliadač. Token tu zámerne NIE JE. */
export type ConnectionSummary = {
  companyId: number;
  companyName: string;
  connectedAt: string;
};

export type ConnectionRepository = {
  list(tenantId: string): Promise<StoredConnection[]>;
  save(scope: PreferenceScope, connections: ConnectionInput[]): Promise<void>;
  remove(tenantId: string, companyId: number): Promise<void>;
};

export function toSummary(connection: StoredConnection | ConnectionInput & { connectedAt?: string }): ConnectionSummary {
  return {
    companyId: connection.companyId,
    companyName: connection.companyName,
    connectedAt: "connectedAt" in connection && connection.connectedAt ? connection.connectedAt : ""
  };
}

type Row = {
  company_id: string | number;
  company_name: string;
  token_enc: Buffer;
  webhook_secret_enc: Buffer | null;
  connected_by_sub: string;
  connected_at: Date;
};

export function postgresConnectionRepository(pool: Pool): ConnectionRepository {
  return {
    async list(tenantId) {
      const { rows } = await pool.query<Row>(
        `select company_id, company_name, token_enc, webhook_secret_enc, connected_by_sub, connected_at
         from kros_connection where tenant_id = $1 order by company_name`,
        [tenantId]
      );

      return rows.map((row) => ({
        // `bigint` vracia `pg` ako reťazec, aby nestratil presnosť; id firiem sú malé čísla,
        // ale prevod musí byť explicitný, inak by sa `"123" !== 123` prejavilo až vo filtri.
        companyId: Number(row.company_id),
        companyName: row.company_name,
        token: decryptToken(row.token_enc),
        webhookSecret: row.webhook_secret_enc ? decryptToken(row.webhook_secret_enc) : undefined,
        connectedAt: new Date(row.connected_at).toISOString(),
        connectedBySub: row.connected_by_sub
      }));
    },

    async save(scope, connections) {
      const client = await pool.connect();
      try {
        await client.query("begin");
        for (const connection of connections) {
          await client.query(
            `insert into kros_connection
               (tenant_id, company_id, company_name, token_enc, webhook_secret_enc, connected_by_sub, connected_at)
             values ($1, $2, $3, $4, $5, $6, now())
             on conflict (tenant_id, company_id) do update set
               company_name = excluded.company_name,
               token_enc = excluded.token_enc,
               webhook_secret_enc = excluded.webhook_secret_enc,
               connected_by_sub = excluded.connected_by_sub,
               connected_at = now()`,
            [
              scope.tenantId,
              connection.companyId,
              connection.companyName,
              encryptToken(connection.token),
              connection.webhookSecret ? encryptToken(connection.webhookSecret) : null,
              scope.userSub
            ]
          );
        }
        await client.query("commit");
      } catch (error) {
        await client.query("rollback");
        throw error;
      } finally {
        client.release();
      }
    },

    async remove(tenantId, companyId) {
      await pool.query("delete from kros_connection where tenant_id = $1 and company_id = $2", [
        tenantId,
        companyId
      ]);
    }
  };
}
