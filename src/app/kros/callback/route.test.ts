import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Test presne toho zlyhania, ktoré prišlo z produkcie: po súhlase v KROS skončil prehliadač
 * na `http://localhost:3000/settings` a napísal „nepodarilo sa pripojiť na server".
 *
 * Príčina bola `new URL(cesta, request.url)` — za reverznou proxy je `request.url` vnútorná
 * adresa kontajnera, nie verejná doména. Preto sa tu kontroluje, že `Location` je RELATÍVNA:
 * v takom prípade si ju prehliadač doplní podľa adresy, na ktorú sám poslal request.
 */
const { state, saved } = vi.hoisted(() => ({
  state: { binding: null as { tenantId: string; userSub: string } | null, hasPool: true },
  saved: { calls: [] as unknown[] }
}));

vi.mock("@/lib/db/pool", () => ({
  getPool: () => (state.hasPool ? ({} as never) : null)
}));

vi.mock("@/lib/kros-oauth-state", () => ({
  oauthStateStore: () => ({
    register: vi.fn(),
    consume: vi.fn(async () => state.binding)
  })
}));

vi.mock("@/lib/kros-connections", () => ({
  postgresConnectionRepository: () => ({
    list: vi.fn(),
    remove: vi.fn(),
    save: vi.fn(async (scope: unknown, connections: unknown) => {
      saved.calls.push({ scope, connections });
    })
  })
}));

vi.mock("@/lib/kros-logs", () => ({ appendKrosLog: vi.fn() }));

const { GET, POST } = await import("@/app/kros/callback/route");

/** Request tak, ako ho vidí server za proxy: vnútorný host, verejný `Host` hlavičkou. */
function callbackRequest(fields: Record<string, string>) {
  const formData = new FormData();
  for (const [key, value] of Object.entries(fields)) formData.set(key, value);

  return new Request("http://localhost:3000/kros/callback", {
    method: "POST",
    headers: { host: "prehlady.krosdoplnky.sk" },
    body: formData
  });
}

const platnyState = "a".repeat(32);

const firma = {
  "data[0][companyId]": "111",
  "data[0][companyName]": "Firma A s.r.o.",
  "data[0][token]": "tajny-token",
  state: platnyState
};

beforeEach(() => {
  state.binding = { tenantId: "tenant-a", userSub: "clovek-a" };
  state.hasPool = true;
  saved.calls = [];
});

describe("presmerovanie z callbacku", () => {
  it("po uspesnom prepojeni je Location relativna, nie na vnutorny host", async () => {
    const response = await POST(callbackRequest(firma));

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/settings?kros_post_result=1");
  });

  it("ani pri chybe nesmie Location niest hostitela", async () => {
    state.binding = null;

    const response = await POST(callbackRequest(firma));

    expect(response.headers.get("location")).toBe("/settings?kros_post_result=error&reason=state");
  });

  it("bez databazy skonci chybou, nie tichym uspechom", async () => {
    state.hasPool = false;

    const response = await POST(callbackRequest(firma));

    expect(response.headers.get("location")).toBe("/settings?kros_post_result=error&reason=db");
    expect(saved.calls).toHaveLength(0);
  });

  it("callback bez firiem nic neulozi", async () => {
    const response = await POST(callbackRequest({ state: platnyState }));

    expect(response.headers.get("location")).toBe("/settings?kros_post_result=error&reason=empty");
    expect(saved.calls).toHaveLength(0);
  });

  it("GET len posle na nastavenia, tiez relativne", async () => {
    const response = await GET();

    expect(response.headers.get("location")).toBe("/settings");
  });
});

describe("ulozenie prepojenia", () => {
  it("zapise sa firme zo state, nie z tela requestu", async () => {
    await POST(callbackRequest(firma));

    expect(saved.calls).toHaveLength(1);
    expect(saved.calls[0]).toEqual({
      scope: { tenantId: "tenant-a", userSub: "clovek-a", isPersonalFallback: false },
      connections: [{ companyId: 111, companyName: "Firma A s.r.o.", token: "tajny-token" }]
    });
  });
});
