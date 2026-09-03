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
const NAV_ITEMS = [
  {
    href: "/",
    label: "Príjmy",
    icon: (
      <>
        <path d="M4.5 10.4 12 4l7.5 6.4V20a1 1 0 0 1-1 1H5.5a1 1 0 0 1-1-1v-9.6Z" />
        <path d="M9.5 21v-5.2a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1V21" />
      </>
    )
  },
  {
    href: "/expenses",
    label: "Výdavky",
    icon: (
      <>
        <path d="M6 3.5h12v17l-2.4-1.6-2.4 1.6-1.2-.8-1.2.8-2.4-1.6L6 20.5v-17Z" />
        <path d="M9 8h6" />
        <path d="M9 11.5h6" />
        <path d="M9 15h3.6" />
      </>
    )
  },
  {
    href: "/cashflow",
    label: "Financie",
    icon: (
      <>
        <path d="M4 19.5h16" />
        <rect x="5.2" y="12.2" width="3.2" height="5.6" rx="1.1" />
        <rect x="10.4" y="8.6" width="3.2" height="9.2" rx="1.1" />
        <rect x="15.6" y="5.6" width="3.2" height="12.2" rx="1.1" />
      </>
    )
  },
  {
    href: "/settings",
    label: "Nastavenia",
    icon: (
      <>
        <path d="m19.2 12.9.1-.9-.1-.9 2-1.5-1.9-3.3-2.4 1a7.8 7.8 0 0 0-1.6-.9L15 3.7h-6l-.3 2.7a7.8 7.8 0 0 0-1.6.9l-2.4-1L2.8 9.6l2 1.5-.1.9.1.9-2 1.5 1.9 3.3 2.4-1a7.8 7.8 0 0 0 1.6.9l.3 2.7h6l.3-2.7a7.8 7.8 0 0 0 1.6-.9l2.4 1 1.9-3.3-2-1.5Z" />
        <circle cx="12" cy="12" r="2.8" />
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
