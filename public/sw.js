/*
 * Servisný worker prehľadu.
 *
 * Je tu z dvoch dôvodov a oba sú o inštalácii na plochu:
 *
 * 1. Chromium appku vôbec NEPONÚKNE nainštalovať, kým na stránke nebeží servisný worker
 *    s `fetch` obsluhou. Bez tohto súboru `beforeinstallprompt` nikdy nepríde a v menu
 *    prehliadača ostane len „Pridať na plochu", čo vyrobí obyčajnú záložku s ikonou
 *    prehliadača v rohu — presne to škaredé, čo appka nechce.
 * 2. Appka nainštalovaná na ploche sa spúšťa ako appka, teda aj bez signálu. Bez
 *    workera by z ikony na ploche vyskočila chybová stránka prehliadača; takto vyskočí
 *    `offline.html`, ktoré vysvetlí, čo sa deje.
 *
 * Čo sa NEKEŠUJE a prečo:
 *   - `/api/*` — sú to dáta firmy za prihlásením. Odpovede patria do IndexedDB, kam ich
 *     ukladá `src/lib/sync/`, nie do cache, z ktorej by ich prečítal aj ďalší človek,
 *     čo si appku na tom istom zariadení otvorí po odhlásení.
 *   - HTML stránok modulov — z rovnakého dôvodu. Naviguje sa vždy zo siete; keď sieť
 *     nie je, príde `offline.html`.
 * Kešuje sa len to, čo je nemenné a neosobné: `/_next/static/*` (URL nesie hash buildu)
 * a ikony s offline stránkou.
 *
 * Registráciu robí `src/components/service-worker-boot.tsx`. Verzia nižšie je ručná:
 * po zmene tohto súboru ju treba zvýšiť, inak si prehliadače ponechajú staré cache.
 */

const VERSION = "v1";
const SHELL_CACHE = `kros-shell-${VERSION}`;
const ASSET_CACHE = `kros-assets-${VERSION}`;
const OFFLINE_URL = "/offline.html";

/** Čo musí byť v cache ešte pred prvým výpadkom siete. */
const SHELL_FILES = [OFFLINE_URL, "/icon.svg", "/icon-192.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      await cache.addAll(SHELL_FILES);
      // Nová verzia workera preberá riadenie hneď. Je to bezpečné práve preto, že sa
      // nekešuje žiadne HTML ani JS appky okrem hashovaných `/_next/static/*` — nemôže
      // tak vzniknúť miešanina starej stránky a nových chunkov.
      await self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([SHELL_CACHE, ASSET_CACHE]);
      const names = await caches.keys();
      await Promise.all(names.filter((name) => !keep.has(name)).map((name) => caches.delete(name)));
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;

  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  // Navigácia: vždy zo siete, pri výpadku offline stránka. Odpoveď sa nikdy neukladá —
  // HTML modulov je za prihlásením.
  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          return await fetch(request);
        } catch {
          const cache = await caches.open(SHELL_CACHE);
          const offline = await cache.match(OFFLINE_URL);
          return (
            offline ??
            new Response("Prehľad je offline.", {
              status: 503,
              headers: { "Content-Type": "text/plain; charset=utf-8" }
            })
          );
        }
      })()
    );
    return;
  }

  // Statické assety buildu: URL nesie hash, takže obsah pod ňou sa nikdy nemení a
  // cache-first je bezpečné aj naveky.
  const isImmutableAsset = url.pathname.startsWith("/_next/static/");
  const isShellFile = SHELL_FILES.includes(url.pathname);
  if (!isImmutableAsset && !isShellFile) return;

  event.respondWith(
    (async () => {
      const cacheName = isImmutableAsset ? ASSET_CACHE : SHELL_CACHE;
      const cache = await caches.open(cacheName);
      const hit = await cache.match(request);
      if (hit) return hit;

      const response = await fetch(request);
      // Kešuje sa len úspešná odpoveď, ktorá nikam neputovala. `response.redirected`
      // je to podstatné: keby sa niekedy stalo, že cesta k assetu skončí presmerovaním
      // na prihlásenie, uložila by sa prihlasovacia stránka pod URL skriptu — a appka
      // by z cache dostávala HTML namiesto JavaScriptu, dokedy by sa cache nezmazala.
      if (response.ok && !response.redirected) {
        await cache.put(request, response.clone());
      }
      return response;
    })()
  );
});
