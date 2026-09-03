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
  }
];
