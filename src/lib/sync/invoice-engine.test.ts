import { beforeEach, describe, expect, it, vi } from "vitest";
import type { KrosConnection } from "@/lib/kros-types";

const syncMeta = new Map<string, { completedAt?: string; lastModifiedTimestamp?: string }>();

vi.mock("@/lib/invoice-cache", async () => {
  const actual = await vi.importActual<typeof import("@/lib/invoice-cache")>("@/lib/invoice-cache");
  return {
    ...actual,
    readSyncMeta: async (key: string) => syncMeta.get(key) ?? null,
    getCachedInvoices: async () => [],
    upsertCachedInvoices: async () => {},
    writeSyncMeta: async () => {}
  };
});

const { planInvoiceSteps } = await import("./invoice-engine");
const { syncCompanyMetaKey, syncMonthMetaKey } = await import("@/lib/invoice-cache");

const CONNECTION: KrosConnection = {
  companyId: 1,
  companyName: "Kros Trade",
  connectedAt: "2026-01-01T00:00:00Z"
};

function context(overrides: Partial<Parameters<typeof planInvoiceSteps>[0]> = {}) {
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

describe("planInvoiceSteps", () => {
  it("prázdna cache znamená krok na každý mesiac okna", async () => {
    const steps = await planInvoiceSteps(context());
    expect(steps.length).toBeGreaterThan(0);
    expect(steps.every((step) => step.kind === "month")).toBe(true);
  });

  it("hotové mesiace sa už nesťahujú — to je celá ochrana pred duplicitou", async () => {
    const first = await planInvoiceSteps(context());
    for (const step of first) {
      if (step.kind !== "month") continue;
      syncMeta.set(syncMonthMetaKey(CONNECTION.companyId, "ytd", step.monthRange.monthKey), {
        completedAt: "2026-09-01T00:00:00Z"
      });
    }

    expect(await planInvoiceSteps(context())).toEqual([]);
  });

  it("ručné obnovenie nad hotovými mesiacmi doťahuje len zmeny", async () => {
    const first = await planInvoiceSteps(context());
    for (const step of first) {
      if (step.kind !== "month") continue;
      syncMeta.set(syncMonthMetaKey(CONNECTION.companyId, "ytd", step.monthRange.monthKey), {
        completedAt: "2026-09-01T00:00:00Z"
      });
    }
    syncMeta.set(syncCompanyMetaKey(CONNECTION.companyId, "ytd"), {
      completedAt: "2026-09-01T00:00:00Z",
      lastModifiedTimestamp: "2026-09-01T00:00:00Z"
    });

    const steps = await planInvoiceSteps(context({ isManualRefresh: true }));
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({ kind: "changes", lastModifiedTimestamp: "2026-09-01T00:00:00Z" });
  });

  it("firma bez značky zmeny nedostane krok zmien — nemá od čoho merať", async () => {
    const first = await planInvoiceSteps(context());
    for (const step of first) {
      if (step.kind !== "month") continue;
      syncMeta.set(syncMonthMetaKey(CONNECTION.companyId, "ytd", step.monthRange.monthKey), {
        completedAt: "2026-09-01T00:00:00Z"
      });
    }

    expect(await planInvoiceSteps(context({ isManualRefresh: true }))).toEqual([]);
  });

  it("chýbajúci mesiac má prednosť pred krokom zmien", async () => {
    syncMeta.set(syncCompanyMetaKey(CONNECTION.companyId, "ytd"), {
      completedAt: "2026-09-01T00:00:00Z",
      lastModifiedTimestamp: "2026-09-01T00:00:00Z"
    });

    const steps = await planInvoiceSteps(context({ isManualRefresh: true }));
    expect(steps.every((step) => step.kind === "month")).toBe(true);
  });
});
