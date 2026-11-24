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
export function holdScreenAwake(): () => void {
  if (typeof navigator === "undefined" || !("wakeLock" in navigator)) return () => {};

  let released = false;
  let sentinel: WakeLockSentinel | null = null;

  const acquire = async () => {
    if (released || sentinel || document.visibilityState !== "visible") return;
    try {
      const next = await navigator.wakeLock.request("screen");
      if (released) {
        void next.release().catch(() => {});
        return;
      }
      sentinel = next;
      next.addEventListener("release", () => {
        if (sentinel === next) sentinel = null;
      });
    } catch {
      // Odmietnuté (šetrenie batérie, stránka na pozadí) — skúsime pri návrate.
    }
  };

  const onVisibilityChange = () => {
    if (document.visibilityState === "visible") void acquire();
  };

  document.addEventListener("visibilitychange", onVisibilityChange);
  void acquire();

  return () => {
    released = true;
    document.removeEventListener("visibilitychange", onVisibilityChange);
    const current = sentinel;
    sentinel = null;
    void current?.release().catch(() => {});
  };
}
