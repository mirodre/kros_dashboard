import { describe, expect, it, vi } from "vitest";

import { singleFlight } from "@/lib/single-flight";

const RETAIN = 60_000;

/** Prísľub, ktorý test uvoľní až keď chce — bez neho by „súbežnosť" nebola súbežnosť. */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (error: unknown) => void } {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
}

/**
 * Hodiny sú vstrekované, takže testy okna neplynú v reálnom čase — žiadny `setTimeout`,
 * žiadne uspávanie, a okno sa dá preskočiť presne na hranicu.
 */
function clock(start = 1_700_000_000_000) {
  let nowMs = start;

  return {
    nowMs: () => nowMs,
    advance: (ms: number) => {
      nowMs += ms;
    }
  };
}

function flight<T>(operation: (key: string) => Promise<T>, time = clock()) {
  return singleFlight(operation, { retainMs: RETAIN, nowMs: time.nowMs });
}

describe("singleFlight", () => {
  it("dva subezne volania s tym istym klucom spustia operaciu raz", async () => {
    const gate = deferred<string>();
    const operation = vi.fn(async () => gate.promise);
    const once = flight(operation);

    const first = once("RT");
    const second = once("RT");
    gate.resolve("RT2");

    expect(await first).toBe("RT2");
    expect(await second).toBe("RT2");
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it("rozne kluce sa nezdielaju", async () => {
    const operation = vi.fn(async (key: string) => `${key}-out`);
    const once = flight(operation);

    const [a, b] = await Promise.all([once("RT-a"), once("RT-b")]);

    expect(a).toBe("RT-a-out");
    expect(b).toBe("RT-b-out");
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it("neskory volajuci v okne dostane uz rotovany vysledok, nie novu operaciu", async () => {
    // Rotovaná `Set-Cookie` odchádza na odpovedi requestu, ktorý obnovu spustil, a tá môže
    // pri proxovaní na `api-economy.kros.sk` visieť sekundy. Prehliadač teda ešte chvíľu
    // posiela PÔVODNÚ cookie: request, ktorý medzitým vznikne (klik, prefetch), by inak
    // zavolal token endpoint tokenom, ktorý služba už revokovala, a session by zomrela.
    const time = clock();
    const operation = vi.fn(async (key: string) => `${key}2`);
    const once = flight(operation, time);

    const first = await once("RT");
    time.advance(RETAIN - 1);
    const late = await once("RT");

    expect(late).toBe(first);
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it("po uplynuti okna sa operacia spusti znova", async () => {
    // Okno nie je cache navždy: keď dobehne, ďalší request má obnovovať sám. Musí byť
    // hlboko pod TTL claimov, aby sa doň nikdy nezmestili dve rotácie tej istej session.
    const time = clock();
    const operation = vi.fn(async (key: string) => `${key}2`);
    const once = flight(operation, time);

    await once("RT");
    time.advance(RETAIN);

    await once("RT");

    expect(operation).toHaveBeenCalledTimes(2);
  });

  it("zlyhanie sa nedrzi, kluc je hned znova skusitelny", async () => {
    // Prechodná nedostupnosť služby musí byť okamžite skúsiteľná znova; podržať ju by
    // z jedného bliknutia urobilo výpadok na celú dĺžku okna. A keby sa záznam nemazal
    // vôbec, prvé zlyhanie by kľúč zamrzlo navždy.
    const gate = deferred<string>();
    const operation = vi.fn(async () => gate.promise);
    const once = flight(operation);

    const first = once("RT");
    const second = once("RT");
    gate.reject(new Error("503"));

    await expect(first).rejects.toThrow("503");
    await expect(second).rejects.toThrow("503");

    // Nový pokus po zlyhaní musí operáciu spustiť znova, a to bez posunu hodín.
    await expect(once("RT")).rejects.toThrow("503");
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it("synchronna vynimka z operacie nezamrzne kluc", async () => {
    let calls = 0;
    const once = flight<string>((key: string) => {
      calls += 1;
      if (calls === 1) {
        throw new Error("boom"); // Synchrónne, nie odmietnutý prísľub.
      }

      return Promise.resolve(`${key}-ok`);
    });

    expect(() => once("RT")).toThrow("boom");
    await expect(once("RT")).resolves.toBe("RT-ok");
    expect(calls).toBe(2);
  });
});
