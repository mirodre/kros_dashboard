"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { InstallSheet } from "@/components/install-sheet";
import { INSTALL_INVITE_DELAY_MS } from "@/lib/install-prompt";
import { useInstallPrompt } from "@/lib/use-install-prompt";

/**
 * Pozvánka na inštaláciu appky na plochu — namontovaná v `layout.tsx`, teda vo všetkých
 * moduloch.
 *
 * Poradie je zámerne dvojkrokové: najprv úzka lišta nad menu, a až po ťuknutí spodný
 * dialóg s tým, čo z inštalácie človek má (`InstallSheet`). Prehliadačový pásik robí
 * presne opak — vypýta si rozhodnutie skôr, než čokoľvek povie. Systémový dialóg
 * Chromu preto príde až ako tretí krok, na kliknutie „Nainštalovať".
 *
 * Lišta, nie modál: uprostred čítania grafu nemá appka čo prekrývať obsah. Modál si
 * človek vyžiada sám.
 */
export function InstallInvite() {
  const { method, canInvite, install, snooze } = useInstallPrompt();
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const [isDelayOver, setIsDelayOver] = useState(false);
  // Zavreté v tomto behu appky. Lišta zmizne hneď, aj keď `snooze()` píše až do
  // `localStorage` a stav hooku sa prepočíta o snímku neskôr.
  const [isClosed, setIsClosed] = useState(false);
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
    const timer = window.setTimeout(() => setIsDelayOver(true), INSTALL_INVITE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, []);

  const isBarVisible = isMounted && isDelayOver && canInvite && !isClosed && !isSheetOpen;

  const handleSnooze = () => {
    setIsClosed(true);
    snooze();
  };

  return (
    <>
      {isBarVisible
        ? createPortal(
            // Portál do `body` z toho istého dôvodu ako `SheetOverlay`: `.app-shell` má
            // vlastný stacking context, takže čokoľvek v ňom ostáva POD hlavným menu.
            <div className="install-bar" role="region" aria-label="Pozvánka na inštaláciu appky">
              <button
                type="button"
                className="install-bar-main"
                onClick={() => setIsSheetOpen(true)}
              >
                <span className="install-bar-icon" aria-hidden="true">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src="/icon.svg" alt="" width={30} height={30} />
                </span>
                <span className="install-bar-text">
                  <strong>Prehľad na plochu</strong>
                  {/* Krátko naschvál: podtitul je na jeden riadok s výpustkou, aby lišta
                      nenarástla do dvoch riadkov a netlačila menu. Zvyšok povie dialóg. */}
                  <span>
                    {method === "ios-share" ? "Cez Zdieľať, tri ťuknutia" : "Celá obrazovka, jeden ťuk"}
                  </span>
                </span>
                <span className="install-bar-cta" aria-hidden="true">
                  {method === "ios-share" ? "Ako?" : "Pridať"}
                </span>
              </button>
              <button
                type="button"
                className="install-bar-close"
                onClick={handleSnooze}
                aria-label="Teraz nie, skryť pozvánku"
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  aria-hidden="true"
                  focusable="false"
                >
                  {/* lucide/x */}
                  <path d="M18 6 6 18" />
                  <path d="m6 6 12 12" />
                </svg>
              </button>
            </div>,
            document.body
          )
        : null}

      {isSheetOpen ? (
        <InstallSheet
          method={method}
          onInstall={install}
          onClose={(reason) => {
            setIsSheetOpen(false);
            // Zatvorený dialóg je odpoveď „nie teraz" — bez zápisu by lišta vyskočila
            // znova pri ďalšom otvorení appky, hoci sa človek už raz rozhodol. Po
            // inštalácii sa nezapisuje nič: pozvánku aj tak vypne `appinstalled`, a keby
            // appku niekto neskôr odinštaloval, nemá si ju appka pamätať ako odmietnutú.
            if (reason === "installed") {
              setIsClosed(true);
              return;
            }
            handleSnooze();
          }}
        />
      ) : null}
    </>
  );
}
