"use client";

import { useEffect } from "react";

/**
 * Zaregistruje `public/sw.js`.
 *
 * Prečo appka servisný worker vôbec má, je popísané v samotnom `sw.js` — v skratke: bez
 * neho Chromium inštaláciu na plochu neponúkne a z ikony na ploche by pri výpadku siete
 * vyskočila chybová stránka prehliadača.
 *
 * Registruje sa LEN v produkčnom builde. `next dev` servíruje `/_next/static/*` bez
 * hashu v URL, takže cache-first pravidlo z `sw.js` by pri vývoji podávalo staré chunky
 * a človek by hľadal chybu, ktorú už opravil. Inštalácia na plochu sa preto testuje na
 * `npm run build && npm start` (alebo na nasadenej appke), nie na `next dev`.
 */
export function ServiceWorkerBoot() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;

    // Až po `load`: registrácia inak súperí o linku s prvým načítaním dát dashboardu.
    const register = () => {
      void navigator.serviceWorker.register("/sw.js").catch(() => {
        // Zlyhanie registrácie nesmie appku zhodiť ani vypísať chybu do konzoly človeku,
        // ktorý s tým nič neurobí: bez workera appka funguje, len sa nedá nainštalovať
        // na plochu a nemá offline stránku.
      });
    };

    if (document.readyState === "complete") {
      register();
      return;
    }

    window.addEventListener("load", register, { once: true });
    return () => window.removeEventListener("load", register);
  }, []);

  return null;
}
