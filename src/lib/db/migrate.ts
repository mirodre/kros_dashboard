import { MIGRATIONS, type Migration } from "./migrations";

/**
 * Minimálny klient, ktorý migrácie potrebujú. Nie `pg.Pool` — vďaka tomu sa dá celý beh
 * otestovať bez databázy, rovnako ako `advanceToken` vo fáze SSO testujeme bez Auth.js.
 */
export type MigrationClient = {
  query(sql: string, params?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>;
};

/**
 * Zámok drží celý beh, nielen jednotlivú migráciu. „Jedna replika" je dnes prevádzková
 * podmienka (`docs/SSO-prechod.md`), nie technická záruka — a keby ju niekto zvýšením počtu
 * replík porušil, práve tu by to spôsobilo tichú škodu: dva procesy by naraz videli prázdnu
 * `schema_migrations` a obe by pustili `create table`. Číslo je ľubovoľné, len musí byť
 * stabilné.
 */
const ADVISORY_LOCK_KEY = 4207360172;

const SCHEMA_TABLE = `
  create table if not exists schema_migrations (
    name       text        primary key,
    applied_at timestamptz not null default now()
  );
`;

/** Vráti mená migrácií, ktoré tento beh aplikoval (prázdne pole = schéma bola aktuálna). */
export async function runMigrations(
  client: MigrationClient,
  migrations: readonly Migration[] = MIGRATIONS
): Promise<string[]> {
  await client.query("select pg_advisory_lock($1)", [ADVISORY_LOCK_KEY]);

  try {
    await client.query(SCHEMA_TABLE);
    const { rows } = await client.query("select name from schema_migrations");
    const applied = new Set(rows.map((row) => String(row.name)));
    const performed: string[] = [];

    for (const migration of migrations) {
      if (applied.has(migration.name)) continue;

      // Transakcia per migrácia, nie na celý beh: zlyhanie tretej nemá zahodiť prvé dve,
      // ktoré prešli — tie sú zapísané a druhýkrát sa nespustia.
      await client.query("begin");
      try {
        await client.query(migration.sql);
        await client.query("insert into schema_migrations (name) values ($1)", [migration.name]);
        await client.query("commit");
      } catch (error) {
        await client.query("rollback");
        throw error;
      }

      performed.push(migration.name);
    }

    return performed;
  } finally {
    // `finally` aj pri výnimke: nepustený advisory lock prežije až do konca spojenia
    // a ďalší štart appky by na ňom ticho visel.
    await client.query("select pg_advisory_unlock($1)", [ADVISORY_LOCK_KEY]);
  }
}
