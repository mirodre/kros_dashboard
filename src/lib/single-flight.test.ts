import { describe, expect, it, vi } from "vitest";

import { singleFlight } from "@/lib/single-flight";

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

describe("singleFlight", () => {
  it("dva subezne volania s tym istym klucom spustia operaciu raz", async () => {
    const gate = deferred<string>();
    const operation = vi.fn(async () => gate.promise);
    const once = singleFlight(operation);

    const first = once("RT");
    const second = once("RT");
    gate.resolve("RT2");

    expect(await first).toBe("RT2");
    expect(await second).toBe("RT2");
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it("rozne kluce sa nezdielaju", async () => {
    const operation = vi.fn(async (key: string) => `${key}-out`);
    const once = singleFlight(operation);

    const [a, b] = await Promise.all([once("RT-a"), once("RT-b")]);

    expect(a).toBe("RT-a-out");
    expect(b).toBe("RT-b-out");
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it("po dokonceni sa kluc uvolni, dalsie volanie znova spusti operaciu", async () => {
    // Nie je to cache: rotovaný token sa nesmie vydávať druhý raz po tom, čo prvá obnova
    // skončila — vtedy už je v cookie a ďalší request má obnovovať tým novým.
    const operation = vi.fn(async (key: string) => `${key}!`);
    const once = singleFlight(operation);

    await once("RT");
    await once("RT");

    expect(operation).toHaveBeenCalledTimes(2);
  });

  it("zlyhanie kluc uvolni a dostanu ho vsetci subezni volajuci", async () => {
    // Keby sa záznam mazal len pri úspechu, jedno zlyhanie by kľúč zamrzlo navždy
    // a session s tým refresh tokenom by sa už nikdy neobnovila.
    const gate = deferred<string>();
    const operation = vi.fn(async () => gate.promise);
    const once = singleFlight(operation);

    const first = once("RT");
    const second = once("RT");
    gate.reject(new Error("503"));

    await expect(first).rejects.toThrow("503");
    await expect(second).rejects.toThrow("503");

    // Nový pokus po zlyhaní musí operáciu spustiť znova.
    await expect(once("RT")).rejects.toThrow("503");
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it("synchronna vynimka z operacie nezamrzne kluc", async () => {
    let calls = 0;
    const once = singleFlight<string>((key: string) => {
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
