import { describe, expect, it } from "vitest";

import {
  INSTALL_HINT_STORAGE_KEY,
  INSTALL_SNOOZE_STEPS_MS,
  isIosDevice,
  nextInstallHint,
  readInstallHint,
  resolveInstallMethod,
  shouldOfferInstall,
  writeInstallHint,
  type InstallHint
} from "@/lib/install-prompt";

const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1";
const IPADOS =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15";
const ANDROID =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36";
const MAC_DESKTOP =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 8, 8, 12, 0, 0);

function fakeStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value)
  };
}

describe("isIosDevice", () => {
  it("pozna iPhone", () => {
    expect(isIosDevice(IPHONE)).toBe(true);
  });

  it("pozna iPadOS, ktore sa hlasi ako Macintosh — rozhodne dotykove ovladanie", () => {
    // iPadOS 13+ posiela desktopovy userAgent. Bez `maxTouchPoints` by iPad vypadol z
    // instrukcii „Zdielat → Pridat na plochu" a nemal by ako appku nainstalovat.
    expect(isIosDevice(IPADOS, 5)).toBe(true);
  });

  it("desktopovy Mac nie je iOS", () => {
    // Ta ista veta naopak: keby stacil „Macintosh", appka by na Macu ukazovala
    // instrukcie s tlacidlom Zdielat, ktore v Chrome na Macu nie je.
    expect(isIosDevice(IPADOS, 0)).toBe(false);
    expect(isIosDevice(MAC_DESKTOP, 0)).toBe(false);
  });

  it("Android nie je iOS", () => {
    expect(isIosDevice(ANDROID, 5)).toBe(false);
  });
});

describe("resolveInstallMethod", () => {
  it("s eventom prehliadaca instaluje appka sama", () => {
    expect(
      resolveInstallMethod({ hasPromptEvent: true, isInstalled: false, userAgent: ANDROID })
    ).toBe("browser-prompt");
  });

  it("iOS bez eventu dostane instrukcie", () => {
    expect(
      resolveInstallMethod({ hasPromptEvent: false, isInstalled: false, userAgent: IPHONE })
    ).toBe("ios-share");
  });

  it("uz nainstalovanej appke sa instalacia neponuka, ani ked event prisiel", () => {
    // Chrome vie `beforeinstallprompt` poslat aj tam, kde appka na ploche uz je (iny
    // profil, iny prehliadac). Ponukat instalaciu v okne, ktore sa PRAVE otvorilo z
    // plochy, je najviditelnejsi druh nezmyslu.
    expect(
      resolveInstallMethod({ hasPromptEvent: true, isInstalled: true, userAgent: ANDROID })
    ).toBe("unavailable");
    expect(
      resolveInstallMethod({ hasPromptEvent: false, isInstalled: true, userAgent: IPHONE })
    ).toBe("unavailable");
  });

  it("prehliadac, ktory to nevie, nedostane nic", () => {
    expect(
      resolveInstallMethod({ hasPromptEvent: false, isInstalled: false, userAgent: MAC_DESKTOP })
    ).toBe("unavailable");
  });
});

describe("readInstallHint", () => {
  it("prazdne ulozisko je „este nikdy nezavreta\"", () => {
    expect(readInstallHint(fakeStorage())).toBeNull();
  });

  it("prezije zapis, ktory nie je JSON", () => {
    expect(readInstallHint(fakeStorage({ [INSTALL_HINT_STORAGE_KEY]: "{nie json" }))).toBeNull();
  });

  it.each([
    JSON.stringify({ dismissedAt: "vcera", dismissals: 1 }),
    JSON.stringify({ dismissedAt: NOW }),
    JSON.stringify({ dismissedAt: NOW, dismissals: 0 }),
    JSON.stringify([NOW, 1]),
    JSON.stringify(null)
  ])("pokazeny tvar berie ako nic: %s", (raw) => {
    // Pozvanka nie je hodna vynimky: kazdy nezmysel v ulozisti znamena „nezavrel ju
    // nikto", teda ukaze sa. Horsi scenar je opacny — jeden pokazeny zapis a pozvanka
    // by uz nikdy nefungovala nikomu.
    expect(readInstallHint(fakeStorage({ [INSTALL_HINT_STORAGE_KEY]: raw }))).toBeNull();
  });

  it("cita, co zapisal writeInstallHint", () => {
    const storage = fakeStorage();
    const hint = nextInstallHint(null, NOW);
    writeInstallHint(storage, hint);
    expect(readInstallHint(storage)).toEqual({ dismissedAt: NOW, dismissals: 1 });
  });

  it("zakazane ulozisko (privatny rezim) nespadne", () => {
    const throwing = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("SecurityError");
      }
    };
    expect(readInstallHint(throwing)).toBeNull();
    expect(() => writeInstallHint(throwing, { dismissedAt: NOW, dismissals: 1 })).not.toThrow();
  });
});

describe("nextInstallHint", () => {
  it("pocita zavretia, nie prepisuje", () => {
    const first = nextInstallHint(null, NOW);
    expect(first).toEqual({ dismissedAt: NOW, dismissals: 1 });
    expect(nextInstallHint(first, NOW + DAY)).toEqual({ dismissedAt: NOW + DAY, dismissals: 2 });
  });
});

describe("shouldOfferInstall", () => {
  const hint = (dismissals: number, dismissedAt = NOW): InstallHint => ({ dismissedAt, dismissals });

  it("bez sposobu instalacie nikdy", () => {
    expect(shouldOfferInstall({ method: "unavailable", hint: null, now: NOW })).toBe(false);
  });

  it("prvykrat sa ukaze", () => {
    expect(shouldOfferInstall({ method: "browser-prompt", hint: null, now: NOW })).toBe(true);
    expect(shouldOfferInstall({ method: "ios-share", hint: null, now: NOW })).toBe(true);
  });

  it("po prvom zavreti drzi ticho cely odklad", () => {
    const [first] = INSTALL_SNOOZE_STEPS_MS;
    expect(shouldOfferInstall({ method: "ios-share", hint: hint(1), now: NOW + first - 1 })).toBe(false);
    expect(shouldOfferInstall({ method: "ios-share", hint: hint(1), now: NOW + first })).toBe(true);
  });

  it("druhe zavretie predlzuje ticho, nie skracuje", () => {
    const [first, second] = INSTALL_SNOOZE_STEPS_MS;
    expect(second).toBeGreaterThan(first);
    expect(shouldOfferInstall({ method: "ios-share", hint: hint(2), now: NOW + second - 1 })).toBe(false);
    expect(shouldOfferInstall({ method: "ios-share", hint: hint(2), now: NOW + second })).toBe(true);
  });

  it("po vycerpani odkladov sa sama neukaze uz nikdy", () => {
    // Dve odmietnutia su odpoved. Instalovat sa da dalej z Nastaveni — appka to len
    // prestane ponukat sama.
    const farFuture = NOW + 10 * 365 * DAY;
    expect(shouldOfferInstall({ method: "browser-prompt", hint: hint(3), now: farFuture })).toBe(false);
    expect(shouldOfferInstall({ method: "browser-prompt", hint: hint(9), now: farFuture })).toBe(false);
  });

  it("zapis z buducnosti neuzamkne pozvanku navzdy", () => {
    // Preskocene hodiny alebo prenesene ulozisko: rozdiel by bol negativny a odklad by
    // nevyprsal nikdy — vtedy je spravna odpoved „ukaz", nie „mlc do konca sveta".
    expect(shouldOfferInstall({ method: "ios-share", hint: hint(1, NOW + 100 * DAY), now: NOW })).toBe(true);
  });
});
