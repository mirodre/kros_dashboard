import type { Metadata, Viewport } from "next";
import "./globals.css";
import { AppNav } from "@/components/app-nav";

import { auth } from "@/auth";
import { PreferencesBoot } from "@/components/preferences-boot";

export const metadata: Metadata = {
  // Názov záložky si každý modul určuje vo svojom layoute (`src/app/expenses/layout.tsx`
  // a spol.) a `template` mu dopredu dá „KROS", aby sa prefix nepísal v každom module
  // znova a nerozišel sa. `default` je pre koreňovú route `/`, čo je modul Príjmy —
  // a zároveň slúži ako fallback pre route bez vlastného titulku.
  title: {
    default: "KROS Príjmy",
    template: "KROS %s"
  },
  description: "Mobile-first prehľad tržieb a štítkov pre dáta z KROS",
  manifest: "/manifest.webmanifest",
  // SVG je prvé naschvál: prehliadače, ktoré ho zvládnu, si vezmú ostrú vektorovú verziu,
  // ostatné spadnú na `favicon.ico` (16/32/48 px). Apple touch icon musí byť PNG — iOS
  // SVG na domovskej obrazovke ignoruje.
  icons: {
    icon: [
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/favicon.ico", sizes: "48x48", type: "image/x-icon" }
    ],
    apple: { url: "/apple-icon.png", sizes: "180x180", type: "image/png" }
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "KROS Prehľad"
  },
  other: {
    "mobile-web-app-capable": "yes",
    "apple-mobile-web-app-capable": "yes",
    "apple-mobile-web-app-status-bar-style": "black-translucent"
  }
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  // Zakladna farba pozadia. Rovnaka je aj vrch presvetlovacieho gradientu,
  // takze stavovy riadok (ktory iOS maluje podla theme-color) plynulo splyva
  // s vrchom dashboardu - presvetlenie sa rozjasnuje az nizsie.
  themeColor: "#111420"
};

export default async function RootLayout({
  children
}: Readonly<{ children: React.ReactNode }>) {
  // Session sa tu číta len kvôli `sub` prihláseného človeka — nastavenia potrebujú rozlíšiť
  // „toto som nastavil ja" od „nastavil kolega". Middleware session aj tak overuje pri každom
  // requeste, takže tu nepribúda žiadne nové rozhodnutie o prístupe.
  const session = await auth();

  return (
    <html lang="sk">
      <body>
        <PreferencesBoot viewerSub={session?.claims?.sub ?? null}>
          {children}
          {/*
            Menu je v layoute, nie v stránke modulu: pri prechode medzi modulmi sa
            neodmontuje, takže ostáva klikateľné aj počas načítavania nového modulu.
          */}
          <AppNav />
        </PreferencesBoot>
        <div className="orientation-lock" aria-hidden="true">
          <div>
            <strong>Otoč telefón naspäť na výšku</strong>
            <span>Prehľad je optimalizovaný iba pre zobrazenie na výšku.</span>
          </div>
        </div>
      </body>
    </html>
  );
}
