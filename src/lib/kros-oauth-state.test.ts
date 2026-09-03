import { describe, expect, it } from "vitest";

import { isValidOAuthState, oauthStateStore } from "@/lib/kros-oauth-state";

type Call = { sql: string; params?: unknown[] };

/** Pamäťová napodobenina tabuľky: `delete ... returning` musí ostať jedným krokom. */
function fakeDb(initial: Record<string, { tenantId: string; userSub: string; expiresAt: string }> = {}) {
  const rows = new Map(Object.entries(initial));
  const calls: Call[] = [];

  const client = {
    async query(sql: string, params?: unknown[]) {
      calls.push({ sql: sql.trim(), params });

      if (sql.includes("delete from kros_oauth_state") && sql.includes("returning")) {
        const state = String(params?.[0]);
        const now = String(params?.[1]);
        const row = rows.get(state);
        if (!row || row.expiresAt <= now) return { rows: [] };
        rows.delete(state);
        return { rows: [{ tenant_id: row.tenantId, user_sub: row.userSub }] };
      }

      if (sql.startsWith("insert into kros_oauth_state")) {
        rows.set(String(params?.[0]), {
          tenantId: String(params?.[1]),
          userSub: String(params?.[2]),
          expiresAt: String(params?.[3])
        });
      }

      return { rows: [] };
    }
  };

  return { store: oauthStateStore(client), rows, calls };
}

const state = "a".repeat(32);
const now = new Date("2026-09-03T10:00:00.000Z");
const later = new Date("2026-09-03T10:05:00.000Z");
const binding = { tenantId: "tenant-a", userSub: "clovek-a" };

describe("isValidOAuthState", () => {
  it("prijme 32 hex znakov a nic ine", () => {
    expect(isValidOAuthState(state)).toBe(true);
    expect(isValidOAuthState("kratky")).toBe(false);
    expect(isValidOAuthState(`${state};drop table`)).toBe(false);
  });
});

describe("oauthStateStore", () => {
  it("vydany state vrati firmu a cloveka", async () => {
    const { store } = fakeDb();
    await store.register(state, binding, new Date("2026-09-03T10:10:00.000Z"));

    expect(await store.consume(state, later)).toEqual(binding);
  });

  it("state sa da pouzit len raz", async () => {
    const { store } = fakeDb();
    await store.register(state, binding, new Date("2026-09-03T10:10:00.000Z"));

    await store.consume(state, later);

    expect(await store.consume(state, later)).toBeNull();
  });

  it("spotrebovanie je jeden prikaz, nie citanie a potom mazanie", async () => {
    // Dva subezne callbacky by pri citani a nasledujucom mazani presli oba.
    const { store, calls } = fakeDb();
    await store.register(state, binding, new Date("2026-09-03T10:10:00.000Z"));
    calls.length = 0;

    await store.consume(state, later);

    expect(calls).toHaveLength(1);
    expect(calls[0].sql).toContain("returning");
  });

  it("vyprsany state neprejde", async () => {
    const { store } = fakeDb();
    await store.register(state, binding, new Date("2026-09-03T10:01:00.000Z"));

    expect(await store.consume(state, later)).toBeNull();
  });

  it("neznamy state neprejde", async () => {
    const { store } = fakeDb();

    expect(await store.consume(state, now)).toBeNull();
  });

  it("nezmyselny tvar sa do databazy vobec nedostane", async () => {
    const { store, calls } = fakeDb();

    expect(await store.consume("../../etc/passwd", now)).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it("vydanie uprace prepadnute stavy", async () => {
    const { store, calls } = fakeDb();
    await store.register(state, binding, new Date("2026-09-03T10:10:00.000Z"));

    expect(calls.some((call) => call.sql.includes("expires_at < now()"))).toBe(true);
  });
});
