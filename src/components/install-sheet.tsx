"use client";

import { useEffect, useState } from "react";

import { SheetOverlay } from "@/components/sheet-overlay";
import type { InstallMethod, InstallOutcome } from "@/lib/install-prompt";

/**
 * Ikony sú prebrané z Lucide (https://lucide.dev) — to isté pravidlo ako v `app-nav.tsx`:
 * presná geometria zo setu, nie kreslená napodobenina, a bez novej závislosti.
 *
 * Lucide ISC License. Copyright (c) for portions of Lucide are held by Cole Bemis
 * 2013-2022 as part of Feather (MIT). All other copyright (c) for Lucide are held by
 * Lucide Contributors 2022.
 */
function Glyph({ children }: { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

/** lucide/maximize */
const MaximizeIcon = (
  <Glyph>
    <path d="M8 3H5a2 2 0 0 0-2 2v3" />
    <path d="M21 8V5a2 2 0 0 0-2-2h-3" />
    <path d="M3 16v3a2 2 0 0 0 2 2h3" />
    <path d="M16 21h3a2 2 0 0 0 2-2v-3" />
  </Glyph>
);

/** lucide/zap */
const ZapIcon = (
  <Glyph>
    <path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z" />
  </Glyph>
);

/** lucide/wifi-off */
const WifiOffIcon = (
  <Glyph>
    <path d="M12 20h.01" />
    <path d="M8.5 16.429a5 5 0 0 1 7 0" />
    <path d="M5 12.859a10 10 0 0 1 5.17-2.69" />
    <path d="M19 12.859a10 10 0 0 0-2.007-1.523" />
    <path d="M2 8.82a15 15 0 0 1 4.177-2.643" />
    <path d="M22 8.82a15 15 0 0 0-11.288-3.764" />
    <path d="m2 2 20 20" />
  </Glyph>
);

/** lucide/share — ten istý motív, aký má tlačidlo Zdieľať v Safari. */
const ShareIcon = (
  <Glyph>
    <path d="M12 2v13" />
    <path d="m16 6-4-4-4 4" />
    <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
  </Glyph>
);

/** lucide/square-plus — v iOS menu je to riadok „Pridať na plochu". */
const SquarePlusIcon = (
  <Glyph>
    <rect width="18" height="18" x="3" y="3" rx="2" />
    <path d="M8 12h8" />
    <path d="M12 8v8" />
  </Glyph>
);

/** lucide/check */
const CheckIcon = (
  <Glyph>
    <path d="M20 6 9 17l-5-5" />
  </Glyph>
);

const BENEFITS = [
  {
    icon: MaximizeIcon,
    title: "Celá obrazovka",
    detail: "Bez adresného riadka a panelov prehliadača — grafy dostanú celý displej."
  },
  {
    icon: ZapIcon,
    title: "Jedno ťuknutie z plochy",
    detail: "Vlastná ikona medzi ostatnými appkami, otvorí sa rovno v Domove."
  },
  {
    icon: WifiOffIcon,
    title: "Ide aj bez signálu",
    detail: "Naposledy stiahnuté čísla appka ukáže aj offline."
  }
] as const;

/** Kroky pre iOS. Apple `beforeinstallprompt` neimplementuje, takže inštaluje človek sám. */
const IOS_STEPS = [
  {
    icon: ShareIcon,
    title: "Ťukni na Zdieľať",
    detail: "V Safari je v paneli dole, v Chrome vpravo hore."
  },
  {
    icon: SquarePlusIcon,
    title: "Vyber „Pridať na plochu“",
    detail: "V zozname treba zvyčajne kúsok posunúť nižšie."
  },
  {
    icon: CheckIcon,
    title: "Potvrď „Pridať“",
    detail: "Prehľad pribudne medzi ikony a otvorí sa už bez panelov prehliadača."
  }
] as const;

/**
 * Ukážka toho, čo z inštalácie vznikne: ikona s popiskom tak, ako bude sedieť na ploche.
 * Je to obrázok, nie ovládací prvok — pre čítačku obrazovky preto `aria-hidden`.
 */
function HomeScreenPreview() {
  return (
    <div className="install-preview" aria-hidden="true">
      <div className="install-preview-tile">
        {/* Zámerne `img`, nie `next/image`: ikona je statické SVG z `public/`,
            optimalizátor by pri vektore nemal čo zlepšiť. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/icon.svg" alt="" width={72} height={72} />
      </div>
      <span className="install-preview-label">Prehľad</span>
    </div>
  );
}

type Props = {
  method: InstallMethod;
  /** Vyvolá systémový dialóg. Na iOS sa nevolá — tam sheet ukazuje kroky. */
  onInstall: () => Promise<InstallOutcome>;
  /**
   * Dôvod zatvorenia rozlišuje, či sa appka nainštalovala, alebo človek povedal „nie
   * teraz". Odklad pozvánky patrí len tomu druhému — po inštalácii nie je čo odkladať.
   */
  onClose: (reason: "installed" | "dismissed") => void;
};

/**
 * Spodný dialóg s pozvánkou. Toto je to „pekné" namiesto prehliadačového pásika:
 * povie, čo z inštalácie človek má, a systémový dialóg vyvolá až na jeho kliknutie.
 */
export function InstallSheet({ method, onInstall, onClose }: Props) {
  const [isWorking, setIsWorking] = useState(false);
  const isIos = method === "ios-share";

  // Esc zatvára. Ostatné dialógy appky to nerobia, ale tento vie vyskočiť sám —
  // o to viac musí byť ľahké sa ho zbaviť.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose("dismissed");
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const handleInstall = async () => {
    setIsWorking(true);
    const outcome = await onInstall();
    setIsWorking(false);
    // Zamietnutie v systémovom dialógu sheet nezatvára: človek sa doň vracia a vidí,
    // odkiaľ prišiel. Zatvorí ho „Teraz nie" alebo klik mimo.
    if (outcome === "accepted") onClose("installed");
  };

  return (
    <SheetOverlay onClose={() => onClose("dismissed")}>
      <div
        className="tag-filter-sheet install-sheet"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Pridať prehľad na plochu"
      >
        <span className="install-grip" aria-hidden="true" />

        <header className="install-hero">
          <HomeScreenPreview />
          <div>
            <h4>Prehľad na plochu</h4>
            <p className="tag-sub">
              {isIos
                ? "iOS na to nemá tlačidlo — pridá sa cez menu Zdieľať. Sú to tri ťuknutia:"
                : "Appka pribudne medzi ikony telefónu a otvorí sa ako každá iná."}
            </p>
          </div>
        </header>

        {isIos ? (
          <ol className="install-steps">
            {IOS_STEPS.map((step, index) => (
              <li key={step.title}>
                <span className="install-step-number" aria-hidden="true">
                  {index + 1}
                </span>
                <span className="install-step-icon" aria-hidden="true">
                  {step.icon}
                </span>
                <span className="install-step-text">
                  <strong>{step.title}</strong>
                  <span className="tag-sub">{step.detail}</span>
                </span>
              </li>
            ))}
          </ol>
        ) : (
          <ul className="install-benefits">
            {BENEFITS.map((benefit) => (
              <li key={benefit.title}>
                <span className="install-benefit-icon" aria-hidden="true">
                  {benefit.icon}
                </span>
                <span className="install-step-text">
                  <strong>{benefit.title}</strong>
                  <span className="tag-sub">{benefit.detail}</span>
                </span>
              </li>
            ))}
          </ul>
        )}

        <div className="install-actions">
          <button type="button" className="secondary-button" onClick={() => onClose("dismissed")}>
            {isIos ? "Rozumiem" : "Teraz nie"}
          </button>
          {isIos ? null : (
            <button
              type="button"
              className="install-primary-button"
              onClick={handleInstall}
              disabled={isWorking}
            >
              {isWorking ? "Inštalujem…" : "Nainštalovať"}
            </button>
          )}
        </div>

        {isIos ? null : (
          <p className="install-footnote">
            Nič sa nesťahuje z obchodu s appkami — je to tá istá appka, len bez panelov
            prehliadača.
          </p>
        )}
      </div>
    </SheetOverlay>
  );
}
