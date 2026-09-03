import { describe, expect, it, vi } from "vitest";

import {
  deletePersonal,
  getPreferences,
  patchPersonal,
  putTenant
} from "@/lib/preferences/handlers";
import type { PreferenceRepository } from "@/lib/preferences/repository";
import { preferenceScope, scopeFromSession } from "@/lib/preferences/scope";

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

/** Pamäťové úložisko s rovnakým kľúčovaním ako Postgres — tenant a (user, tenant). */
function memoryRepository(): PreferenceRepository {
  const tenant = new Map<string, Record<string, unknown>>();
  const tenantMeta = new Map<string, { updatedBySub: string; updatedAt: string }>();
  const user = new Map<string, Record<string, unknown>>();

  return {
    async read(scope) {
      return {
        tenant: { ...(tenant.get(scope.tenantId) ?? {}) },
        user: { ...(user.get(`${scope.userSub}|${scope.tenantId}`) ?? {}) },
        tenantMeta: tenantMeta.get(scope.tenantId) ?? null
      };
    },
    async writeUser(scope, entries) {
      const key = `${scope.userSub}|${scope.tenantId}`;
      user.set(key, { ...(user.get(key) ?? {}), ...entries });
    },
    async writeTenant(scope, entries) {
      tenant.set(scope.tenantId, { ...(tenant.get(scope.tenantId) ?? {}), ...entries });
      tenantMeta.set(scope.tenantId, { updatedBySub: scope.userSub, updatedAt: "2026-09-03T10:00:00.000Z" });
    },
    async deleteUser(scope, keys) {
      const key = `${scope.userSub}|${scope.tenantId}`;
      const current = { ...(user.get(key) ?? {}) };
      for (const entry of keys) delete current[entry];
      user.set(key, current);
    }
  };
}

function brokenRepository(): PreferenceRepository {
  const fail = () => Promise.reject(new Error("databaza nedostupna"));
  return { read: fail, writeUser: fail, writeTenant: fail, deleteUser: fail };
}

describe("izolacia tenantov", () => {
  it("clovek z inej firmy nevidi firemne nastavenia", async () => {
    const repository = memoryRepository();
    await putTenant(repository, firmaA, { "revenue.companies": ["Firma A s.r.o."] });

    const cudzi = await getPreferences(repository, firmaB);

    expect((cudzi.body as { values: Record<string, unknown> }).values["revenue.companies"]).toEqual([]);
  });

  it("kolega v tej istej firme firemne nastavenie vidi", async () => {
    const repository = memoryRepository();
    await putTenant(repository, firmaA, { "revenue.companies": ["Firma A s.r.o."] });

    const kolega = await getPreferences(repository, kolegaVFirmeA);

    expect((kolega.body as { values: Record<string, unknown> }).values["revenue.companies"]).toEqual([
      "Firma A s.r.o."
    ]);
  });

  it("osobne nastavenie nevidi ani kolega v tej istej firme", async () => {
    const repository = memoryRepository();
    await patchPersonal(repository, firmaA, { "ui.granularity": "year" });

    const kolega = await getPreferences(repository, kolegaVFirmeA);

    expect((kolega.body as { values: Record<string, unknown> }).values["ui.granularity"]).toBe("month");
  });

  it("tenantId z tela requestu sa ignoruje", async () => {
    const repository = memoryRepository();

    // Telo nesie cudzi tenant aj cudzi sub — oboje su neznáme kluce, teda 400, a scope
    // sa z tela poskladat neda: handler ho dostava ako parameter zo session.
    const result = await patchPersonal(repository, firmaA, {
      tenantId: "tenant-b",
      userSub: "clovek-c",
      "revenue.companies": ["Firma A s.r.o."]
    });

    expect(result.status).toBe(400);

    const cudzi = await getPreferences(repository, firmaB);
    expect((cudzi.body as { values: Record<string, unknown> }).values["revenue.companies"]).toEqual([]);
  });
});

describe("validacia", () => {
  it("neznamy kluc konci 400", async () => {
    const result = await patchPersonal(memoryRepository(), firmaA, { "revenue.evil": ["x"] });

    expect(result.status).toBe(400);
  });

  it("neplatna hodnota konci 400", async () => {
    const result = await patchPersonal(memoryRepository(), firmaA, { "ui.granularity": "storocie" });

    expect(result.status).toBe(400);
  });

  it("osobny kluc sa neda zdielat firme", async () => {
    const result = await putTenant(memoryRepository(), firmaA, { "ui.collapsed.companies": true });

    expect(result.status).toBe(400);
    expect(String((result.body as { error: string }).error)).toContain("osobné");
  });

  it("firemny kluc sa da ulozit aj osobne", async () => {
    const result = await patchPersonal(memoryRepository(), firmaA, { "revenue.companies": ["A"] });

    expect(result.status).toBe(200);
  });

  it("prazdne telo konci 400", async () => {
    expect((await patchPersonal(memoryRepository(), firmaA, {})).status).toBe(400);
    expect((await patchPersonal(memoryRepository(), firmaA, null)).status).toBe(400);
    expect((await patchPersonal(memoryRepository(), firmaA, ["pole"])).status).toBe(400);
  });
});

describe("zdielanie a navrat", () => {
  it("zdielanie zmaze osobne prepisanie toho, kto zdiela", async () => {
    // Inak by jediny nevidel to, co prave nastavil vsetkym.
    const repository = memoryRepository();
    await patchPersonal(repository, firmaA, { "revenue.companies": ["Moje"] });
    await putTenant(repository, firmaA, { "revenue.companies": ["Firemne"] });

    const po = await getPreferences(repository, firmaA);
    const body = po.body as { values: Record<string, unknown>; personalKeys: string[] };

    expect(body.values["revenue.companies"]).toEqual(["Firemne"]);
    expect(body.personalKeys).not.toContain("revenue.companies");
  });

  it("navrat na firemne zmaze osobnu hodnotu", async () => {
    const repository = memoryRepository();
    await putTenant(repository, firmaA, { "revenue.companies": ["Firemne"] });
    await patchPersonal(repository, firmaA, { "revenue.companies": ["Moje"] });

    await deletePersonal(repository, firmaA, { keys: ["revenue.companies"] });

    const body = (await getPreferences(repository, firmaA)).body as { values: Record<string, unknown> };
    expect(body.values["revenue.companies"]).toEqual(["Firemne"]);
  });

  it("stopa po zmene firemneho nastavenia zostava", async () => {
    // Rolu nekontrolujeme, takze `updated_by_sub` je jedine, co po zmene ostane.
    const repository = memoryRepository();
    await putTenant(repository, firmaA, { "revenue.companies": ["Firemne"] });

    const body = (await getPreferences(repository, firmaA)).body as {
      tenantMeta: { updatedBySub: string } | null;
    };
    expect(body.tenantMeta?.updatedBySub).toBe("clovek-a");
  });

  it("navrat bez zoznamu klucov konci 400", async () => {
    expect((await deletePersonal(memoryRepository(), firmaA, {})).status).toBe(400);
    expect((await deletePersonal(memoryRepository(), firmaA, { keys: [] })).status).toBe(400);
  });
});

describe("nedostupna databaza", () => {
  it("cita sa 503 a nic nespadne", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    expect((await getPreferences(brokenRepository(), firmaA)).status).toBe(503);
    expect((await patchPersonal(brokenRepository(), firmaA, { "ui.granularity": "year" })).status).toBe(503);

    spy.mockRestore();
  });
});

describe("scopeFromSession", () => {
  it("bez session nie je scope", () => {
    expect(scopeFromSession(null)).toBeNull();
    expect(scopeFromSession({})).toBeNull();
    expect(scopeFromSession({ claims: {} })).toBeNull();
  });

  it("session s claimami da scope firmy", () => {
    const scope = scopeFromSession({
      claims: {
        sub: "clovek-a",
        organizationId: "tenant-a",
        organizations: [{ id: "tenant-a", name: "Firma A", role: "member" }]
      }
    });

    expect(scope).toEqual({ tenantId: "tenant-a", userSub: "clovek-a", isPersonalFallback: false });
  });
});
