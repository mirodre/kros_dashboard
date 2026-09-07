import { describe, expect, it } from "vitest";

import { runMigrations, type MigrationClient } from "@/lib/db/migrate";
import type { Migration } from "@/lib/db/migrations";

type FakeOptions = {
  applied?: string[];
  failOn?: string;
};

function fakeClient(options: FakeOptions = {}) {
  const applied = new Set(options.applied ?? []);
  const statements: string[] = [];

  const client: MigrationClient = {
    async query(sql, params) {
      statements.push(sql.trim());

      if (options.failOn && sql.includes(options.failOn)) {
        throw new Error("zlyhanie migracie");
      }

      if (sql.includes("select name from schema_migrations")) {
        return { rows: [...applied].map((name) => ({ name })) };
      }

      if (sql.startsWith("insert into schema_migrations")) {
        applied.add(String(params?.[0]));
      }

      return { rows: [] };
    }
  };

  return { client, statements, applied };
}

const migrations: Migration[] = [
  { name: "001_prva", sql: "create table prva ()" },
  { name: "002_druha", sql: "create table druha ()" }
];

describe("runMigrations", () => {
  it("aplikuje vsetky migracie a zapise ich", async () => {
    const { client, applied } = fakeClient();

    const performed = await runMigrations(client, migrations);

    expect(performed).toEqual(["001_prva", "002_druha"]);
    expect([...applied]).toEqual(["001_prva", "002_druha"]);
  });

  it("druhy beh neaplikuje nic", async () => {
    const { client } = fakeClient({ applied: ["001_prva", "002_druha"] });

    const performed = await runMigrations(client, migrations);

    expect(performed).toEqual([]);
  });

  it("preskoci uz aplikovanu a pusti len zvysok", async () => {
    const { client, statements } = fakeClient({ applied: ["001_prva"] });

    const performed = await runMigrations(client, migrations);

    expect(performed).toEqual(["002_druha"]);
    expect(statements).not.toContain("create table prva ()");
    expect(statements).toContain("create table druha ()");
  });

  it("zlyhanie migracie ju vrati a nezapise", async () => {
    const { client, statements, applied } = fakeClient({ failOn: "create table druha" });

    await expect(runMigrations(client, migrations)).rejects.toThrow("zlyhanie migracie");

    // Prva presla a ostava zapisana; druha sa vratila, takze pri dalsom starte sa pustí znova.
    expect([...applied]).toEqual(["001_prva"]);
    expect(statements).toContain("rollback");
  });

  it("uvolni zamok aj ked migracia zlyha", async () => {
    const { client, statements } = fakeClient({ failOn: "create table prva" });

    await expect(runMigrations(client, migrations)).rejects.toThrow();

    // Nepusteny advisory lock by prezil do konca spojenia a dalsi start appky by na nom visel.
    expect(statements.some((sql) => sql.includes("pg_advisory_unlock"))).toBe(true);
  });

  it("zamok drzi cely beh, nie jednotlivu migraciu", async () => {
    const { client, statements } = fakeClient();

    await runMigrations(client, migrations);

    const locks = statements.filter((sql) => sql.includes("pg_advisory_lock"));
    expect(locks).toHaveLength(1);
  });
});
