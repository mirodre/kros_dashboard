import { SILENT_VIDEO_MP4 } from "@/lib/silent-video";

/**
 * Drží displej zapnutý, kým beží dlhá práca (sťahovanie z KROS). Bez toho sa
 * telefón po chvíli nečinnosti zamkne, systém appku uspí a rozrobené spojenie
 * spadne.
 *
 * Dve cesty naraz:
 *  1. Wake Lock API — čistá cesta, stačí všade okrem iOS.
 *  2. Na iOS navyše tiché video v slučke. Wake Lock tam v appke pridanej na
 *     plochu nie je spoľahlivý (zámok sa „udelí", a displej zhasne aj tak),
 *     kým prehrávané video drží displej vždy.
 *
 * Video má háčik: iOS ho dovolí spustiť len z dotyku. Preto si ho pri prvom
 * dotyku kdekoľvek v appke „odomkneme" (krátke play + pause) — odvtedy sa dá
 * spustiť aj samo. Ak sťahovanie začne skôr, než sa človek appky dotkol,
 * `needsTap` je true a obrazovka sťahovania o dotyk poprosí.
 */

type Listener = () => void;

let holders = 0;
let sentinel: WakeLockSentinel | null = null;
let video: HTMLVideoElement | null = null;
let videoPlaying = false;
let needsTap = false;
let installed = false;
const listeners = new Set<Listener>();

function isIos() {
  if (typeof navigator === "undefined") return false;
  return (
    /iP(hone|ad|od)/.test(navigator.userAgent) ||
    // iPadOS sa hlási ako Mac; odlíši ho dotykový displej.
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

function setNeedsTap(next: boolean) {
  if (needsTap === next) return;
  needsTap = next;
  for (const listener of listeners) listener();
}

function getVideo() {
  if (video) return video;
  const element = document.createElement("video");
  element.setAttribute("title", "KROS Dashboard");
  element.setAttribute("playsinline", "");
  element.src = SILENT_VIDEO_MP4;
  // Atribút `loop` displej nedrží — iOS berie zacyklené video ako nečinné.
  // Skok na náhodné miesto ho udrží „živé".
  element.addEventListener("timeupdate", () => {
    if (element.currentTime > 0.5) element.currentTime = Math.random();
  });
  element.addEventListener("playing", () => {
    videoPlaying = true;
    setNeedsTap(false);
  });
  element.addEventListener("pause", () => {
    videoPlaying = false;
  });
  video = element;
  return element;
}

async function playVideo() {
  try {
    await getVideo().play();
    if (holders === 0) video?.pause();
  } catch {
    // Bez dotyku iOS prehrávanie odmietne — poprosíme oň.
    if (holders > 0 && !videoPlaying) setNeedsTap(true);
  }
}

async function requestWakeLock() {
  if (!("wakeLock" in navigator) || sentinel || document.visibilityState !== "visible") return;
  try {
    const next = await navigator.wakeLock.request("screen");
    if (holders === 0) {
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
}

function acquire() {
  if (holders === 0 || document.visibilityState !== "visible") return;
  void requestWakeLock();
  if (isIos() && !videoPlaying) void playVideo();
}

function release() {
  const current = sentinel;
  sentinel = null;
  void current?.release().catch(() => {});
  video?.pause();
  setNeedsTap(false);
}

/** Dotyk: buď video rovno pustí (beží sťahovanie), alebo ho odomkne na neskôr. */
function onUserGesture() {
  if (!isIos() || videoPlaying) return;
  void playVideo();
}

function install() {
  if (installed || typeof document === "undefined") return;
  installed = true;
  // Zámok aj prehrávanie padnú vždy, keď stránka zmizne z obrazovky.
  document.addEventListener("visibilitychange", acquire);
  document.addEventListener("touchend", onUserGesture, { capture: true, passive: true });
  document.addEventListener("click", onUserGesture, { capture: true, passive: true });
}

// Odomknutie videa musí stihnúť dotyk ešte PRED sťahovaním, preto už pri načítaní modulu.
install();

/** Drží displej zapnutý; vracia funkciu, ktorá ho pustí. */
export function holdScreenAwake(): () => void {
  if (typeof document === "undefined") return () => {};
  install();
  holders += 1;
  acquire();

  let released = false;
  return () => {
    if (released) return;
    released = true;
    holders -= 1;
    if (holders === 0) release();
  };
}

export function subscribeToScreenAwakeNeedsTap(listener: Listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** True, keď displej nevieme udržať bez dotyku človeka. */
export function getScreenAwakeNeedsTap() {
  return needsTap;
}
