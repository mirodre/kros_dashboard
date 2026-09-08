"use client";

import { useState } from "react";

import { InstallSheet } from "@/components/install-sheet";
import { useInstallPrompt } from "@/lib/use-install-prompt";

/**
 * Karta „Appka na plochu" v Nastaveniach.
 *
 * Existuje presne preto, aby pozvánka mohla byť slušná: lišta v moduloch sa po dvoch
 * zavretiach viac neukáže (`INSTALL_SNOOZE_STEPS_MS`), takže inštalácia musí mať aj
 * miesto, kde si ju človek nájde sám. Karta nič neponúka sama od seba — je to zásuvka,
 * nie pozvánka.
 */
export function InstallAppCard() {
  const { method, isInstalled, install } = useInstallPrompt();
  const [isSheetOpen, setIsSheetOpen] = useState(false);

  return (
    <section className="dashboard-body">
      <article className="panel">
        <header className="panel-head">
          <h3>Appka na plochu</h3>
          {method === "unavailable" ? null : (
            <button type="button" className="secondary-button" onClick={() => setIsSheetOpen(true)}>
              {method === "ios-share" ? "Ako na to" : "Nainštalovať"}
            </button>
          )}
        </header>
        <p className="tag-sub">
          {isInstalled
            ? "Appka je na tomto zariadení nainštalovaná — beží z plochy, nie z prehliadača."
            : method === "unavailable"
              ? "Tento prehliadač inštaláciu na plochu nepodporuje. Na telefóne to ide v Chrome (Android) a v Safari (iPhone, iPad)."
              : "Prehľad sa dá pridať medzi ikony zariadenia: otvorí sa na celú obrazovku, bez adresného riadka a s vlastnou ikonou."}
        </p>
      </article>

      {isSheetOpen ? (
        <InstallSheet method={method} onInstall={install} onClose={() => setIsSheetOpen(false)} />
      ) : null}
    </section>
  );
}
