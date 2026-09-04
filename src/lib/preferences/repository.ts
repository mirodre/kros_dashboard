import type { Pool } from "pg";

import type { PreferenceScope } from "./scope";
import type { StoredValues } from "./resolve";

export type TenantMeta = {
  updatedBySub: string;
  updatedAt: string;
};

export type PreferenceLevels = {
  tenant: StoredValues;
  user: StoredValues;
  tenantMeta: TenantMeta | null;
};

/**
 * Rozhranie, nie trieda: handlery dostávajú úložisko ako parameter, takže sa dajú testovať
 * proti pamäťovej implementácii bez databázy — rovnaký vzor ako `LifecycleDeps` vo fáze SSO.
 */
export type PreferenceRepository = {
  read(scope: PreferenceScope): Promise<PreferenceLevels>;
  writeUser(scope: PreferenceScope, entries: Record<string, unknown>): Promise<void>;
  writeTenant(scope: PreferenceScope, entries: Record<string, unknown>): Promise<void>;
  deleteUser(scope: PreferenceScope, keys: string[]): Promise<void>;
  /**
   * Zapíše, že tento človek firmu práve otvoril, a vráti počet ľudí, ktorí ju otvorili
   * doteraz. Appka z toho vie jediné: či má vo firme zmysel ponúkať zdieľanie filtrov.
   */
  touchMember(scope: PreferenceScope): Promise<number>;
};

function toValues(rows: Array<{ key: string; value: unknown }>): StoredValues {
  const values: StoredValues = {};
  for (const row of rows) {
    (values as Record<string, unknown>)[row.key] = row.value;
  }
  return values;
}

export function postgresRepository(pool: Pool): PreferenceRepository {
  return {
    async read(scope) {
      const [tenant, user, meta] = await Promise.all([
        pool.query<{ key: string; value: unknown }>(
          "select key, value from tenant_preference where tenant_id = $1",
          [scope.tenantId]
        ),
        pool.query<{ key: string; value: unknown }>(
          "select key, value from user_preference where user_sub = $1 and tenant_id = $2",
          [scope.userSub, scope.tenantId]
        ),
        pool.query<{ updated_by_sub: string; updated_at: Date }>(
          "select updated_by_sub, updated_at from tenant_preference where tenant_id = $1 order by updated_at desc limit 1",
          [scope.tenantId]
        )
      ]);

      const metaRow = meta.rows[0];

      return {
        tenant: toValues(tenant.rows),
        user: toValues(user.rows),
        tenantMeta: metaRow
          ? { updatedBySub: metaRow.updated_by_sub, updatedAt: new Date(metaRow.updated_at).toISOString() }
          : null
      };
    },

    async writeUser(scope, entries) {
      const client = await pool.connect();
      try {
        await client.query("begin");
        for (const [key, value] of Object.entries(entries)) {
          await client.query(
            `insert into user_preference (user_sub, tenant_id, key, value, updated_at)
             values ($1, $2, $3, $4, now())
             on conflict (user_sub, tenant_id, key)
             do update set value = excluded.value, updated_at = now()`,
            [scope.userSub, scope.tenantId, key, JSON.stringify(value)]
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

    async writeTenant(scope, entries) {
      const client = await pool.connect();
      try {
        await client.query("begin");
        for (const [key, value] of Object.entries(entries)) {
          await client.query(
            `insert into tenant_preference (tenant_id, key, value, updated_at, updated_by_sub)
             values ($1, $2, $3, now(), $4)
             on conflict (tenant_id, key)
             do update set value = excluded.value, updated_at = now(), updated_by_sub = excluded.updated_by_sub`,
            [scope.tenantId, key, JSON.stringify(value), scope.userSub]
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

    async deleteUser(scope, keys) {
      if (keys.length === 0) return;
      await pool.query(
        "delete from user_preference where user_sub = $1 and tenant_id = $2 and key = any($3::text[])",
        [scope.userSub, scope.tenantId, keys]
      );
    },

    async touchMember(scope) {
      await pool.query(
        `insert into tenant_member (tenant_id, user_sub)
         values ($1, $2)
         on conflict (tenant_id, user_sub)
         do update set last_seen_at = now()`,
        [scope.tenantId, scope.userSub]
      );
      const result = await pool.query<{ count: string }>(
        "select count(*)::text as count from tenant_member where tenant_id = $1",
        [scope.tenantId]
      );
      return Number(result.rows[0]?.count ?? "1");
    }
  };
}
