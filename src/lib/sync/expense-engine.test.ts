import { beforeEach, describe, expect, it, vi } from "vitest";
import type { KrosConnection } from "@/lib/kros-types";

const syncMeta = new Map<string, { completedAt?: string; lastModifiedTimestamp?: string }>();

vi.mock("@/lib/expense-cache", async () => {
  const actual = await vi.importActual<typeof import("@/lib/expense-cache")>("@/lib/expense-cache");
  return {
    ...actual,
    readExpenseSyncMeta: async (key: string) => syncMeta.get(key) ?? null,
    getCachedExpenses: async () => [],
    upsertCachedExpenses: async () => {},
    writeExpenseSyncMeta: async () => {}
  };
});

const { planExpenseSteps } = await import("./expense-engine");
const { expenseCompanyMetaKey, expenseMonthMetaKey } = await import("@/lib/expense-cache");

const CONNECTION: KrosConnection = {
  companyId: 7,
  companyName: "Kros Servis",
  connectedAt: "2026-01-01T00:00:00Z"
};

function context(overrides: Partial<Parameters<typeof planExpenseSteps>[0]> = {}) {
  return {
    connections: [CONNECTION],
    companyIds: [CONNECTION.companyId],
    granularity: "month" as const,
    isManualRefresh: false,
    signal: new AbortController().signal,
    ...overrides
  };
}

async function markAllMonthsDone() {
  const steps = await planExpenseSteps(context());
  for (const step of steps) {
    if (step.kind !== "month") continue;
    syncMeta.set(expenseMonthMetaKey(CONNECTION.companyId, "ytd", step.monthRange.monthKey), {
      completedAt: "2026-09-01T00:00:00Z"
    });
  }
}

beforeEach(() => {
  syncMeta.clear();
});

describe("planExpenseSteps", () => {
  it("prázdna cache znamená krok na každý mesiac okna", async () => {
    const steps = await planExpenseSteps(context());
    expect(steps.length).toBeGreaterThan(0);
    expect(steps.every((step) => step.kind === "month")).toBe(true);
  });

  it("hotové mesiace sa už nesťahujú", async () => {
    await markAllMonthsDone();
    expect(await planExpenseSteps(context())).toEqual([]);
  });

  it("ručné obnovenie nad hotovými mesiacmi doťahuje len zmeny", async () => {
    await markAllMonthsDone();
    syncMeta.set(expenseCompanyMetaKey(CONNECTION.companyId, "ytd"), {
      completedAt: "2026-09-01T00:00:00Z",
      lastModifiedTimestamp: "2026-09-01T00:00:00Z"
    });

    const steps = await planExpenseSteps(context({ isManualRefresh: true }));
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({ kind: "changes", lastModifiedTimestamp: "2026-09-01T00:00:00Z" });
  });

  it("firma bez značky zmeny nedostane krok zmien", async () => {
    await markAllMonthsDone();
    expect(await planExpenseSteps(context({ isManualRefresh: true }))).toEqual([]);
  });

  it("roky plánujú rozsah history, nie ytd — inak by kľúče cache nesedeli", async () => {
    const steps = await planExpenseSteps(context({ granularity: "year" }));
    expect(steps.every((step) => step.range === "history")).toBe(true);
  });

  it("chýbajúci mesiac má prednosť pred krokom zmien", async () => {
    syncMeta.set(expenseCompanyMetaKey(CONNECTION.companyId, "ytd"), {
      completedAt: "2026-09-01T00:00:00Z",
      lastModifiedTimestamp: "2026-09-01T00:00:00Z"
    });

    const steps = await planExpenseSteps(context({ isManualRefresh: true }));
    expect(steps.every((step) => step.kind === "month")).toBe(true);
  });
});
