"use client";

import { useCallback, useEffect, useState } from "react";

import {
  nextInstallHint,
  readInstallHint,
  resolveInstallMethod,
  shouldOfferInstall,
  writeInstallHint,
  type InstallHint,
  type InstallMethod,
  type InstallOutcome
} from "./install-prompt";

/**
 * Event, ktorý Chromium posiela, keď je appka nainštalovateľná. V `lib.dom.d.ts` nie je
 * (nie je to štandard), preto vlastný typ — nie `any`.
 */
type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

/**
 * Zachytenie eventu je na ÚROVNI MODULU, nie v efekte komponentu — a to je celý dôvod,
 * prečo tento súbor existuje oddelene od komponentu.
 *
 * Chromium strieľa `beforeinstallprompt` hneď po načítaní stránky, teda spravidla skôr,
 * ako React stihne namontovať čokoľvek. Listener v `useEffect` by ho preto na Androide
 * pravidelne prespal a appka by ponúkala inštaláciu, len keď sa človek náhodou zdržal do
 * druhého behu. Modul sa vyhodnotí pri importe (teda pri načítaní chunku layoutu), event
 * si odloží a hook si ho pri montáži vyzdvihne.
 *
 * `preventDefault()` je tu to podstatné: potlačí prehliadačový pásik „Install app", aby
 * pozvánku nakreslila appka sama. Systémový dialóg príde až z `install()`.
 */
let capturedEvent: BeforeInstallPromptEvent | null = null;
let wasInstalledDuringSession = false;
const subscribers = new Set<() => void>();

function notify() {
  for (const subscriber of subscribers) subscriber();
}

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    capturedEvent = event as BeforeInstallPromptEvent;
    notify();
  });

  window.addEventListener("appinstalled", () => {
    // Po inštalácii event už neplatí — druhé `prompt()` by skončilo výnimkou.
    capturedEvent = null;
    wasInstalledDuringSession = true;
    notify();
  });
}

/** Beží appka z plochy, teda mimo prehliadača? */
function detectInstalled(): boolean {
  if (typeof window === "undefined") return false;
  if (wasInstalledDuringSession) return true;
  // `navigator.standalone` je vlastná vec Safari na iOS a v typoch DOM nie je.
  if ((window.navigator as Navigator & { standalone?: boolean }).standalone === true) return true;
  return ["standalone", "fullscreen", "minimal-ui"].some(
    (mode) => window.matchMedia(`(display-mode: ${mode})`).matches
  );
}

export type InstallPrompt = {
  method: InstallMethod;
  /** Appka beží z plochy. Vtedy sa neponúka nič — už je hotovo. */
  isInstalled: boolean;
  /** Smie sa pozvánka ukázať sama (spôsob existuje a odklad po zavretí vypršal). */
  canInvite: boolean;
  /** Vyvolá systémový dialóg inštalácie. Na iOS nie je čo vyvolať — vracia `unavailable`. */
  install: () => Promise<InstallOutcome>;
  /** Človek pozvánku zavrel: zapíše odklad, ďalší je dlhší, po druhom je ticho. */
  snooze: () => void;
};

/**
 * Stav inštalácie appky pre komponenty pozvánky.
 *
 * SSR: prvý render je zámerne „nič sa nedá" — `window` na serveri neexistuje a hádať
 * podľa userAgentu zo servera by znamenalo poslať do HTML pozvánku, ktorú by hydratácia
 * o chvíľu vzala späť. Pozvánka je aj tak časovaná (`INSTALL_INVITE_DELAY_MS`).
 */
export function useInstallPrompt(): InstallPrompt {
  const [hasPromptEvent, setHasPromptEvent] = useState(false);
  const [isInstalled, setIsInstalled] = useState(false);
  const [hint, setHint] = useState<InstallHint | null>(null);
  const [now, setNow] = useState(0);

  useEffect(() => {
    const sync = () => {
      setHasPromptEvent(capturedEvent !== null);
      setIsInstalled(detectInstalled());
    };

    sync();
    setHint(readInstallHint(window.localStorage));
    setNow(Date.now());

    subscribers.add(sync);

    // Inštalácia z prehliadačového menu appku prepne do `standalone` bez toho, aby sa
    // stránka načítala znova — bez tohto listenera by pozvánka ostala visieť v už
    // nainštalovanej appke.
    const displayMode = window.matchMedia("(display-mode: standalone)");
    displayMode.addEventListener("change", sync);

    return () => {
      subscribers.delete(sync);
      displayMode.removeEventListener("change", sync);
    };
  }, []);

  const method = resolveInstallMethod({
    hasPromptEvent,
    isInstalled,
    userAgent: typeof navigator === "undefined" ? "" : navigator.userAgent,
    maxTouchPoints: typeof navigator === "undefined" ? 0 : navigator.maxTouchPoints
  });

  const install = useCallback(async (): Promise<InstallOutcome> => {
    const event = capturedEvent;
    if (!event) return "unavailable";

    try {
      await event.prompt();
      const { outcome } = await event.userChoice;
      if (outcome === "accepted") {
        // `appinstalled` dorazí sám, ale až po dokončení inštalácie. Pozvánka má zmiznúť
        // hneď, ako človek v dialógu kývne.
        capturedEvent = null;
        wasInstalledDuringSession = true;
        notify();
      }
      return outcome;
    } catch {
      // Druhé `prompt()` na tom istom evente (dvojklik, návrat do pozvánky) hádže.
      // Pre človeka to nie je chyba appky — pozvánka len zostane, kde bola.
      return "unavailable";
    }
  }, []);

  const snooze = useCallback(() => {
    const moment = Date.now();
    const updated = nextInstallHint(readInstallHint(window.localStorage), moment);
    writeInstallHint(window.localStorage, updated);
    setHint(updated);
    setNow(moment);
  }, []);

  return {
    method,
    isInstalled,
    // `now === 0` = efekt ešte nebežal, teda ani `localStorage` sa nečítalo. Pozvánka
    // sa v tom okamihu ukázať nesmie: nevie, či ju človek nezavrel.
    canInvite: now > 0 && shouldOfferInstall({ method, hint, now }),
    install,
    snooze
  };
}
