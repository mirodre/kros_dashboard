import { beforeEach, describe, expect, it, vi } from "vitest";
import type { KrosConnection } from "@/lib/kros-types";

const syncMeta = new Map<string, { completedAt?: string; lastModifiedTimestamp?: string }>();

vi.mock("@/lib/cashflow-cache", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/cashflow-cache")>("@/lib/cashflow-cache");
  return {
    ...actual,
    readCashflowSyncMeta: async (key: string) => syncMeta.get(key) ?? null,
    getCachedPaymentAccounts: async () => [],
    getCachedPaymentTransactions: async () => [],
    replaceCachedPaymentAccounts: async () => {},
    upsertCachedPaymentTransactions: async () => {},
    writeCashflowSyncMeta: async () => {}
  };
});

const { planCashflowSteps } = await import("./cashflow-engine");
const { cashflowCompanyMetaKey } = await import("@/lib/cashflow-cache");

const CONNECTION: KrosConnection = {
  companyId: 3,
  companyName: "Kros Financie",
  connectedAt: "2026-01-01T00:00:00Z"
};

function context(overrides: Partial<Parameters<typeof planCashflowSteps>[0]> = {}) {
  return {
    connections: [CONNECTION],
    companyIds: [CONNECTION.companyId],
    granularity: "month" as const,
    isManualRefresh: false,
    signal: new AbortController().signal,
    ...overrides
  };
}

beforeEach(() => {
  syncMeta.clear();
});

describe("planCashflowSteps", () => {
  it("firma bez syncu dostane plný krok", async () => {
    const steps = await planCashflowSteps(context());
    expect(steps).toHaveLength(1);
    expect(steps[0].needsFullSync).toBe(true);
  });

  it("hotová firma sa pri automatickom otvorení nesťahuje", async () => {
    syncMeta.set(cashflowCompanyMetaKey(CONNECTION.companyId), {
      completedAt: "2026-09-01T00:00:00Z"
    });
    expect(await planCashflowSteps(context())).toEqual([]);
  });

  it("ručné obnovenie hotovú firmu doťahuje inkrementálne", async () => {
    syncMeta.set(cashflowCompanyMetaKey(CONNECTION.companyId), {
      completedAt: "2026-09-01T00:00:00Z",
      lastModifiedTimestamp: "2026-09-01T00:00:00Z"
    });

    const steps = await planCashflowSteps(context({ isManualRefresh: true }));
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({
      needsFullSync: false,
      lastModifiedTimestamp: "2026-09-01T00:00:00Z"
    });
  });

  it("každá prepojená firma je vlastný krok", async () => {
    const second: KrosConnection = { ...CONNECTION, companyId: 4, companyName: "Druhá" };
    const steps = await planCashflowSteps(
      context({ connections: [CONNECTION, second], companyIds: [3, 4] })
    );
    expect(steps.map((step) => step.connection.companyId)).toEqual([3, 4]);
  });
});
