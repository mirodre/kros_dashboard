import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Testy `public/sw.js`.
 *
 * Worker nie je modul appky (prehliadač ho servíruje ako statický súbor z `public/`),
 * takže sa tu vyhodnotí v pieskovisku s podvrhnutým `self`, `caches` a `fetch` a testuje
 * sa jeho `fetch` obsluha zvonku — tak, ako ju volá prehliadač.
 *
 * Testuje sa práve toto pravidlo: `/api/*` a HTML stránok sa worker NESMIE dotknúť.
 * Odpovede API sú dáta firmy za prihlásením a cache prehliadača ich prežije aj po
 * odhlásení, takže by ich na tom istom telefóne prečítal aj ďalší človek. Je to jediná
 * chyba v tomto súbore, ktorá by neprišla ako „appka nefunguje", ale ako vynesené dáta.
 */

type FetchHandler = (event: {
  request: Request;
  respondWith: (response: Promise<Response> | Response) => void;
}) => void;

function loadWorker({
  networkFails = false,
  networkRedirects = false
}: { networkFails?: boolean; networkRedirects?: boolean } = {}) {
  const code = readFileSync(new URL("../../public/sw.js", import.meta.url), "utf8");

  const listeners = new Map<string, (event: unknown) => void>();
  const stores = new Map<string, Map<string, Response>>();
  const networkCalls: string[] = [];

  const cacheFor = (name: string) => {
    const existing = stores.get(name);
    if (existing) return existing;
    const created = new Map<string, Response>();
    stores.set(name, created);
    return created;
  };

  const caches = {
    open: async (name: string) => {
      const store = cacheFor(name);
      return {
        addAll: async (urls: string[]) => {
          for (const url of urls) store.set(url, new Response(`precached ${url}`));
        },
        match: async (request: Request | string) => {
          const key = typeof request === "string" ? request : new URL(request.url).pathname;
          return store.get(key);
        },
        put: async (request: Request | string, response: Response) => {
          const key = typeof request === "string" ? request : new URL(request.url).pathname;
          store.set(key, response);
        }
      };
    },
    keys: async () => [...stores.keys()],
    delete: async (name: string) => stores.delete(name)
  };

  const fakeFetch = async (request: Request) => {
    networkCalls.push(new URL(request.url).pathname);
    if (networkFails) throw new TypeError("Failed to fetch");
    const response = new Response(`network ${new URL(request.url).pathname}`, { status: 200 });
    // `redirected` je v Node len na čítanie; podvrhuje sa, aby sa dala overiť poistka
    // proti uloženiu prihlasovacej stránky pod URL assetu.
    if (networkRedirects) Object.defineProperty(response, "redirected", { value: true });
    return response;
  };

  const self = {
    addEventListener: (type: string, handler: (event: unknown) => void) => listeners.set(type, handler),
    location: { origin: "https://prehlady.krosdoplnky.sk" },
    skipWaiting: async () => {},
    clients: { claim: async () => {} }
  };

  new Function("self", "caches", "fetch", code)(self, caches, fakeFetch);

  return { listeners, stores, networkCalls, caches };
}

/** Spustí `install` a `activate` tak, ako to robí prehliadač pri prvej registrácii. */
async function activate(worker: ReturnType<typeof loadWorker>) {
  for (const type of ["install", "activate"] as const) {
    const promises: Promise<unknown>[] = [];
    worker.listeners.get(type)?.({ waitUntil: (promise: Promise<unknown>) => promises.push(promise) });
    await Promise.all(promises);
  }
}

/** Podá workeru request a vráti odpoveď, ktorou ho obslúžil — alebo `null`, ak ho nechal prehliadaču. */
async function handle(
  worker: ReturnType<typeof loadWorker>,
  url: string,
  init: { method?: string; mode?: RequestMode } = {}
): Promise<Response | null> {
  const handler = worker.listeners.get("fetch") as FetchHandler | undefined;
  if (!handler) throw new Error("worker nezaregistroval fetch obsluhu");

  // `mode` sa do `new Request()` v Node zadať nedá, preto sa dopĺňa na hotový objekt.
  const request = new Request(url, { method: init.method ?? "GET" });
  Object.defineProperty(request, "mode", { value: init.mode ?? "cors" });

  let answered: Promise<Response> | Response | null = null;
  handler({ request, respondWith: (response) => void (answered = response) });
  return answered === null ? null : await answered;
}

describe("public/sw.js", () => {
  it("ma fetch obsluhu — bez nej Chromium appku neponukne nainstalovat", async () => {
    // Toto nie je detail: instalovatelnost na Androide je podmienena workerom s `fetch`
    // obsluhou. Bez nej `beforeinstallprompt` nikdy nepride a vlastna pozvanka
    // (`install-invite.tsx`) by na Androide nemala co ukazovat.
    const worker = loadWorker();
    expect(worker.listeners.has("fetch")).toBe(true);
  });

  it("offline stranku si ulozi uz pri instalacii", async () => {
    // Ked prehliadac ostane bez siete, uz sa nic dotahovat neda. Offline stranka preto
    // musi byt v cache PRED prvym vypadkom.
    const worker = loadWorker();
    await activate(worker);
    const shell = [...worker.stores.values()].find((store) => store.has("/offline.html"));
    expect(shell).toBeDefined();
  });

  it("odpovede /api/* nikdy neobsluzi ani neuklada", async () => {
    const worker = loadWorker();
    await activate(worker);

    for (const path of ["/api/kros/invoices", "/api/kros/payments?rok=2026", "/api/preferences"]) {
      const response = await handle(worker, `https://prehlady.krosdoplnky.sk${path}`);
      expect(response).toBeNull();
    }

    const cached = [...worker.stores.values()].flatMap((store) => [...store.keys()]);
    expect(cached.some((key) => key.startsWith("/api/"))).toBe(false);
  });

  it("HTML modulov sa neuklada — naviguje sa vzdy zo siete", async () => {
    const worker = loadWorker();
    await activate(worker);

    const response = await handle(worker, "https://prehlady.krosdoplnky.sk/expenses", {
      mode: "navigate"
    });
    expect(await response?.text()).toBe("network /expenses");

    const cached = [...worker.stores.values()].flatMap((store) => [...store.keys()]);
    expect(cached).not.toContain("/expenses");
  });

  it("bez siete vrati navigacia offline stranku, nie chybu prehliadaca", async () => {
    const worker = loadWorker({ networkFails: true });
    await activate(worker);

    const response = await handle(worker, "https://prehlady.krosdoplnky.sk/", { mode: "navigate" });
    expect(await response?.text()).toBe("precached /offline.html");
  });

  it("hashovane assety buildu berie z cache a siet uz nepytá", async () => {
    const worker = loadWorker();
    await activate(worker);
    const asset = "https://prehlady.krosdoplnky.sk/_next/static/chunks/abc123.js";

    expect(await (await handle(worker, asset))?.text()).toBe("network /_next/static/chunks/abc123.js");
    expect(await (await handle(worker, asset))?.text()).toBe("network /_next/static/chunks/abc123.js");
    // Druhy request uz na siet nesiel — v URL je hash buildu, takze obsah sa pod nou
    // nikdy nezmeni.
    expect(worker.networkCalls).toEqual(["/_next/static/chunks/abc123.js"]);
  });

  it("presmerovanu odpoved neuklada", async () => {
    // Keby cesta k assetu niekedy skoncila presmerovanim na prihlasenie, ulozila by sa
    // pod URL skriptu prihlasovacia stranka a appka by z cache dostavala HTML namiesto
    // JavaScriptu — az kym by niekto cache nezmazal.
    const worker = loadWorker({ networkRedirects: true });
    await activate(worker);
    const asset = "https://prehlady.krosdoplnky.sk/_next/static/chunks/abc123.js";

    await handle(worker, asset);
    await handle(worker, asset);

    expect(worker.networkCalls).toEqual([
      "/_next/static/chunks/abc123.js",
      "/_next/static/chunks/abc123.js"
    ]);
  });

  it("cudzi origin a zapisy prehliadacu nechava", async () => {
    const worker = loadWorker();
    await activate(worker);

    expect(await handle(worker, "https://api-economy.kros.sk/invoices")).toBeNull();
    expect(
      await handle(worker, "https://prehlady.krosdoplnky.sk/api/preferences", { method: "POST" })
    ).toBeNull();
  });
});
