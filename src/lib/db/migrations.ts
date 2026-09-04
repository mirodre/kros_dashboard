/**
 * Migrácie sú TypeScript konštanty, nie `.sql` súbory čítané z disku.
 *
 * Next.js pri builde balí route handlery aj `instrumentation.ts` do `.next/`, takže
 * `readFile(process.cwd() + "/src/lib/db/migrations")` by fungovalo len dovtedy, kým na
 * serveri leží aj zdrojový strom — a to je predpoklad, ktorý nikto nikde nedeklaruje.
 * Reťazec v module sa zabalí spolu s kódom a beží rovnako v dev aj v produkcii.
 */
export type Migration = {
  name: string;
  sql: string;
};

export const MIGRATIONS: readonly Migration[] = [
  {
    name: "001_preferences",
    sql: `
      create table if not exists tenant_preference (
        tenant_id      text        not null,
        key            text        not null,
        value          jsonb       not null,
        updated_at     timestamptz not null default now(),
        updated_by_sub text        not null,
        primary key (tenant_id, key)
      );

      create table if not exists user_preference (
        user_sub   text        not null,
        tenant_id  text        not null,
        key        text        not null,
        value      jsonb       not null,
        updated_at timestamptz not null default now(),
        primary key (user_sub, tenant_id, key)
      );
    `
  },
  {
    name: "002_kros_connections",
    sql: `
      create table if not exists kros_connection (
        tenant_id          text        not null,
        company_id         bigint      not null,
        company_name       text        not null,
        token_enc          bytea       not null,
        webhook_secret_enc bytea,
        connected_by_sub   text        not null,
        connected_at       timestamptz not null default now(),
        primary key (tenant_id, company_id)
      );

      create table if not exists kros_oauth_state (
        state      text        primary key,
        tenant_id  text        not null,
        user_sub   text        not null,
        expires_at timestamptz not null
      );
    `
  },
  {
    /**
     * Kto z firmy appku naozaj otvoril. Slúži na jedinú otázku: je vo firme viac ľudí?
     * Bez toho sa nedá povedať, či má zmysel ponúkať zdieľanie filtrov firme — SSO nám
     * zoznam členov nedáva a `user_preference` má riadok až po prvej zmene nastavenia.
     */
    name: "003_tenant_members",
    sql: `
      create table if not exists tenant_member (
        tenant_id     text        not null,
        user_sub      text        not null,
        first_seen_at timestamptz not null default now(),
        last_seen_at  timestamptz not null default now(),
        primary key (tenant_id, user_sub)
      );
    `
  }
];
