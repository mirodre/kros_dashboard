import { describe, expect, it, vi } from "vitest";

import {
  listConnections,
  removeConnection,
  resolveConnections,
  saveConnections
} from "@/lib/kros-connection-handlers";
import type { ConnectionRepository, StoredConnection } from "@/lib/kros-connections";
import { preferenceScope } from "@/lib/preferences/scope";

const firmaA = preferenceScope({
  sub: "clovek-a",
  organizationId: "tenant-a",
  organizations: [{ id: "tenant-a", name: "Firma A", role: "member" }]
});

const kolegaVFirmeA = preferenceScope({
  sub: "clovek-b",
  organizationId: "tenant-a",
  organizations: [{ id: "tenant-a", name: "Firma A", role: "member" }]
});

const firmaB = preferenceScope({
  sub: "clovek-c",
  organizationId: "tenant-b",
  organizations: [{ id: "tenant-b", name: "Firma B", role: "owner" }]
});

function memoryRepository(): ConnectionRepository {
  const byTenant = new Map<string, StoredConnection[]>();

  return {
    async list(tenantId) {
      return [...(byTenant.get(tenantId) ?? [])];
    },
    async save(scope, connections) {
      const current = byTenant.get(scope.tenantId) ?? [];
      const next = current.filter(
        (existing) => !connections.some((incoming) => incoming.companyId === existing.companyId)
      );
      for (const connection of connections) {
        next.push({ ...connection, connectedAt: "2026-09-03T10:00:00.000Z", connectedBySub: scope.userSub });
      }
      byTenant.set(scope.tenantId, next);
    },
    async remove(tenantId, companyId) {
      byTenant.set(
        tenantId,
        (byTenant.get(tenantId) ?? []).filter((connection) => connection.companyId !== companyId)
      );
    }
  };
}

const prepojenie = { companyId: 111, companyName: "Firma A s.r.o.", token: "tajny-token" };

describe("prepojenia su firemne", () => {
  it("kolega v tej istej firme vidi prepojenie, ktore nekliknul", async () => {
    // Toto je cely zmysel fazy 2: jeden clovek prepoji, ostatni vidia data.
    const repository = memoryRepository();
    await saveConnections(repository, firmaA, { connections: [prepojenie] });

    const result = await listConnections(repository, kolegaVFirmeA);

    expect((result.body as { connections: unknown[] }).connections).toHaveLength(1);
  });

  it("ina firma nevidi nic", async () => {
    const repository = memoryRepository();
    await saveConnections(repository, firmaA, { connections: [prepojenie] });

    const result = await listConnections(repository, firmaB);

    expect((result.body as { connections: unknown[] }).connections).toEqual([]);
  });

  it("ina firma neodpoji cudzie prepojenie", async () => {
    const repository = memoryRepository();
    await saveConnections(repository, firmaA, { connections: [prepojenie] });

    await removeConnection(repository, firmaB, { companyId: 111 });

    const result = await listConnections(repository, firmaA);
    expect((result.body as { connections: unknown[] }).connections).toHaveLength(1);
  });

  it("do prehliadaca nejde token", async () => {
    // Keby sa token vratil v zozname, cely presun na server by bol na nic.
    const repository = memoryRepository();
    await saveConnections(repository, firmaA, { connections: [prepojenie] });

    const result = await listConnections(repository, firmaA);

    expect(JSON.stringify(result.body)).not.toContain("tajny-token");
    expect((result.body as { connections: Record<string, unknown>[] }).connections[0]).toEqual({
      companyId: 111,
      companyName: "Firma A s.r.o.",
      connectedAt: "2026-09-03T10:00:00.000Z"
    });
  });
});

describe("validacia ulozenia", () => {
  it("prepojenie bez tokenu sa odmietne", async () => {
    const result = await saveConnections(memoryRepository(), firmaA, {
      connections: [{ companyId: 1, companyName: "Firma" }]
    });

    expect(result.status).toBe(400);
  });

  it("prazdny zoznam sa odmietne", async () => {
    expect((await saveConnections(memoryRepository(), firmaA, { connections: [] })).status).toBe(400);
    expect((await saveConnections(memoryRepository(), firmaA, null)).status).toBe(400);
  });

  it("odpojenie bez companyId sa odmietne", async () => {
    expect((await removeConnection(memoryRepository(), firmaA, {})).status).toBe(400);
    expect((await removeConnection(memoryRepository(), firmaA, { companyId: "111" })).status).toBe(400);
  });

  it("opakovane prepojenie tej istej firmy hodnotu prepise, nezdvoji", async () => {
    const repository = memoryRepository();
    await saveConnections(repository, firmaA, { connections: [prepojenie] });
    await saveConnections(repository, firmaA, { connections: [{ ...prepojenie, token: "novy" }] });

    const stored = await repository.list("tenant-a");
    expect(stored).toHaveLength(1);
    expect(stored[0].token).toBe("novy");
  });
});

describe("resolveConnections", () => {
  it("bez companyIds vrati vsetky prepojenia firmy", async () => {
    const repository = memoryRepository();
    await saveConnections(repository, firmaA, {
      connections: [prepojenie, { ...prepojenie, companyId: 222, companyName: "Druha" }]
    });

    expect(await resolveConnections(repository, firmaA, undefined)).toHaveLength(2);
  });

  it("companyIds su filter, nie zoznam, ktoremu sa veri", async () => {
    // Podstrceny cudzi companyId nesmie nic pridat — vyberame len z toho, co firma ma.
    const repository = memoryRepository();
    await saveConnections(repository, firmaA, { connections: [prepojenie] });

    const resolved = await resolveConnections(repository, firmaA, [111, 999]);

    expect(resolved.map((connection) => connection.companyId)).toEqual([111]);
  });

  it("cudzi tenant nedostane nic ani cez companyIds", async () => {
    const repository = memoryRepository();
    await saveConnections(repository, firmaA, { connections: [prepojenie] });

    expect(await resolveConnections(repository, firmaB, [111])).toEqual([]);
  });
});

describe("nedostupne uloziste", () => {
  it("konci 503, nie padom", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const fail = () => Promise.reject(new Error("db down"));
    const broken: ConnectionRepository = { list: fail, save: fail, remove: fail };

    expect((await listConnections(broken, firmaA)).status).toBe(503);
    expect((await saveConnections(broken, firmaA, { connections: [prepojenie] })).status).toBe(503);

    spy.mockRestore();
  });
});
