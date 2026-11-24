/**
 * Drží displej zapnutý, kým beží dlhá práca (sťahovanie z KROS). Bez toho sa
 * telefón po chvíli nečinnosti zamkne, systém appku uspí a rozrobené spojenie
 * spadne.
 *
 * Zámok vie prehliadač kedykoľvek zobrať — vždy, keď stránka zmizne z obrazovky.
 * Po návrate si ho preto pýtame znova. Kde Wake Lock API chýba (starší iOS),
 * funkcia potichu nerobí nič: je to pohodlie, nie podmienka sťahovania.
 *
 * Vracia funkciu, ktorá zámok pustí.
 */

type Listener = () => void;

let unheldHolders = 0;
const listeners = new Set<Listener>();

function setUnheld(delta: number) {
  const before = unheldHolders > 0;
  unheldHolders = Math.max(0, unheldHolders + delta);
  if (before !== unheldHolders > 0) for (const listener of listeners) listener();
}

export function subscribeToScreenAwakeUnavailable(listener: Listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * True, keď práca beží, no displej sa nám udržať nepodarilo — obrazovka
 * sťahovania vtedy človeku povie, že zamknutie sťahovanie pozastaví.
 */
export function getScreenAwakeUnavailable() {
  return unheldHolders > 0;
}

export function holdScreenAwake(): () => void {
  if (typeof navigator === "undefined") return () => {};

  let released = false;
  let sentinel: WakeLockSentinel | null = null;
  let countedUnheld = false;

  const markUnheld = (unheld: boolean) => {
    if (countedUnheld === unheld) return;
    countedUnheld = unheld;
    setUnheld(unheld ? 1 : -1);
  };

  if (!("wakeLock" in navigator)) {
    markUnheld(true);
    return () => markUnheld(false);
  }

  const acquire = async () => {
    if (released || sentinel || document.visibilityState !== "visible") return;
    try {
      const next = await navigator.wakeLock.request("screen");
      if (released) {
        void next.release().catch(() => {});
        return;
      }
      sentinel = next;
      markUnheld(false);
      next.addEventListener("release", () => {
        if (sentinel === next) sentinel = null;
      });
    } catch {
      // Odmietnuté (šetrenie batérie, stránka na pozadí) — skúsime pri návrate.
      if (!released) markUnheld(true);
    }
  };

  const onVisibilityChange = () => {
    if (document.visibilityState === "visible") void acquire();
  };

  document.addEventListener("visibilitychange", onVisibilityChange);
  void acquire();

  return () => {
    released = true;
    markUnheld(false);
    document.removeEventListener("visibilitychange", onVisibilityChange);
    const current = sentinel;
    sentinel = null;
    void current?.release().catch(() => {});
  };
}
