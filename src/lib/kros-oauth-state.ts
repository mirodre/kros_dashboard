import type { Pool } from "pg";

/**
 * Jednorazový `state` pre KROS integration-consent, viazaný na firmu a človeka, ktorý ho
 * vydal.
 *
 * Väzba je nutnosť, nie ozdoba: KROS posiela výsledok ako cross-site POST na
 * `/kros/callback` a `SameSite=Lax` session cookie sa pri ňom neodošle (vysvetlené
 * v `src/lib/public-paths.ts`). Callback teda zo session nezistí NIČ — jediné, čo o ňom
 * vie, je `state`. Keby `state` nenesol tenanta, prepojenie by sa nemalo komu zapísať.
 *
 * Vedľajší efekt väzby: `state` sa nedá zaregistrovať bez prihlásenia, čo bolo riziko
 * pomenované už v spec-e fázy SSO.
 */
export type OAuthStateBinding = {
  tenantId: string;
  userSub: string;
};

export type OAuthStateStore = {
  register(state: string, binding: OAuthStateBinding, expiresAt: Date): Promise<void>;
  consume(state: string, now: Date): Promise<OAuthStateBinding | null>;
};

export const STATE_TTL_MS = 10 * 60 * 1000;

export function isValidOAuthState(state: string): boolean {
  return /^[a-f0-9]{32}$/i.test(state);
}

type QueryClient = {
  query(sql: string, params?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>;
};

export function oauthStateStore(client: QueryClient | Pool): OAuthStateStore {
  const db = client as QueryClient;

  return {
    async register(state, binding, expiresAt) {
      // Upratanie prepadnutých pri každom vydaní: je to jeden lacný delete a vyhne sa
      // samostatnej údržbovej úlohe kvôli tabuľke, kde riadky žijú desať minút.
      await db.query("delete from kros_oauth_state where expires_at < now()");
      await db.query(
        `insert into kros_oauth_state (state, tenant_id, user_sub, expires_at)
         values ($1, $2, $3, $4)
         on conflict (state) do update set
           tenant_id = excluded.tenant_id,
           user_sub = excluded.user_sub,
           expires_at = excluded.expires_at`,
        [state, binding.tenantId, binding.userSub, expiresAt.toISOString()]
      );
    },

    async consume(state, now) {
      if (!isValidOAuthState(state)) return null;

      // Zmazanie a čítanie JEDNÝM príkazom: `state` musí byť použiteľný práve raz, a keby
      // sa najprv čítalo a potom mazalo, dva súbežné callbacky by prešli oba.
      const { rows } = await db.query(
        `delete from kros_oauth_state
         where state = $1 and expires_at > $2
         returning tenant_id, user_sub`,
        [state, now.toISOString()]
      );

      const row = rows[0];
      if (!row) return null;

      return { tenantId: String(row.tenant_id), userSub: String(row.user_sub) };
    }
  };
}
