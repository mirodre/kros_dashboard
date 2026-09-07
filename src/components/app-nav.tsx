"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

/**
 * Hlavné menu appky. Zámerne žije v `layout.tsx`, teda NAD stránkami modulov:
 * pri prechode na iný modul sa neodmontuje, neprekryje ho obrazovka sťahovania
 * a neprestane reagovať, kým sa nový modul dokresľuje. Menu musí byť živé vždy —
 * aj uprostred načítavania sa musí dať prekliknúť inam.
 */
/**
 * Ikony sú prebrané z Lucide (https://lucide.dev), teda presná geometria
 * z ikonového setu, nie kreslená napodobenina — pri štandardných motívoch
 * (dom, banka, bloček) je rozdiel vidieť. Cesty sú tu inline zámerne: appka
 * kvôli piatim ikonám nepotrebuje závislosť a `.mobile-liquid-icon svg`
 * v globals.css im dá jednotný `stroke`, hrúbku aj zaoblenia.
 *
 * Lucide ISC License. Copyright (c) for portions of Lucide are held by
 * Cole Bemis 2013-2022 as part of Feather (MIT). All other copyright (c)
 * for Lucide are held by Lucide Contributors 2022.
 *
 * Keď sa pridáva ďalšia ikona, patrí sem tá istá cesta, akú má Lucide —
 * nie vlastný tvar, ktorý by v rade vedľa ostatných vyzeral inak.
 */
const NAV_ITEMS = [
  {
    href: "/",
    label: "Domov",
    // lucide/house
    icon: (
      <>
        <path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8" />
        <path d="M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      </>
    )
  },
  {
    href: "/prijmy",
    label: "Príjmy",
    // lucide/trending-up
    icon: (
      <>
        <path d="M16 7h6v6" />
        <path d="m22 7-8.5 8.5-5-5L2 17" />
      </>
    )
  },
  {
    href: "/expenses",
    label: "Výdavky",
    // lucide/receipt
    icon: (
      <>
        <path d="M12 17V7" />
        <path d="M16 8h-6a2 2 0 0 0 0 4h4a2 2 0 0 1 0 4H8" />
        <path d="M4 3a1 1 0 0 1 1-1 1.3 1.3 0 0 1 .7.2l.933.6a1.3 1.3 0 0 0 1.4 0l.934-.6a1.3 1.3 0 0 1 1.4 0l.933.6a1.3 1.3 0 0 0 1.4 0l.933-.6a1.3 1.3 0 0 1 1.4 0l.934.6a1.3 1.3 0 0 0 1.4 0l.933-.6A1.3 1.3 0 0 1 19 2a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1 1.3 1.3 0 0 1-.7-.2l-.933-.6a1.3 1.3 0 0 0-1.4 0l-.934.6a1.3 1.3 0 0 1-1.4 0l-.933-.6a1.3 1.3 0 0 0-1.4 0l-.933.6a1.3 1.3 0 0 1-1.4 0l-.934-.6a1.3 1.3 0 0 0-1.4 0l-.933.6a1.3 1.3 0 0 1-.7.2 1 1 0 0 1-1-1z" />
      </>
    )
  },
  {
    href: "/cashflow",
    label: "Financie",
    // lucide/landmark — banka s tympanónom a stĺpmi, ten istý motív, aký má
    // Financie hlavné menu KROSu.
    icon: (
      <>
        <path d="M10 18v-7" />
        <path d="M11.119 2.205a2 2 0 0 1 1.762 0l7.84 3.846A.5.5 0 0 1 20.5 7h-17a.5.5 0 0 1-.22-.949z" />
        <path d="M14 18v-7" />
        <path d="M18 18v-7" />
        <path d="M3 22h18" />
        <path d="M6 18v-7" />
      </>
    )
  },
  {
    href: "/settings",
    label: "Nastavenia",
    // lucide/settings
    icon: (
      <>
        <path d="M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915" />
        <circle cx="12" cy="12" r="3" />
      </>
    )
  }
] as const;

export function AppNav() {
  const pathname = usePathname();
  // Kam sa práve klikalo. Zvýraznenie tak preskočí na novú položku hneď pri
  // dotyku a nečaká, kým sa modul načíta — inak to pôsobí, že menu nereaguje.
  const [pendingHref, setPendingHref] = useState<string | null>(null);

  useEffect(() => {
    setPendingHref(null);
  }, [pathname]);

  const activeHref = pendingHref ?? pathname;

  return (
    <nav className="mobile-liquid-nav" aria-label="Hlavná navigácia">
      {NAV_ITEMS.map((item) => {
        const isActive = activeHref === item.href;
        const isPending = pendingHref === item.href && pathname !== item.href;

        return (
          <Link
            key={item.href}
            href={item.href}
            className={isActive ? "mobile-liquid-link active" : "mobile-liquid-link"}
            aria-current={pathname === item.href ? "page" : undefined}
            data-pending={isPending ? "true" : undefined}
            onClick={() => setPendingHref(item.href)}
          >
            <span className="mobile-liquid-orb" aria-hidden="true">
              <span className="mobile-liquid-icon">
                <svg viewBox="0 0 24 24" fill="none">{item.icon}</svg>
              </span>
            </span>
            <span className="mobile-liquid-label">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
