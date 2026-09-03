import type { Metadata, Viewport } from "next";
import "./globals.css";
import { AppNav } from "@/components/app-nav";

import { auth } from "@/auth";
import { PreferencesBoot } from "@/components/preferences-boot";

export const metadata: Metadata = {
  title: "KROS tržbový prehľad",
  description: "Mobile-first prehľad tržieb a štítkov pre dáta z KROS",
  manifest: "/manifest.webmanifest",
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
  // Session sa tu číta len kvôli názvu firmy v hlavičke — nastavenia sú kľúčované tenantom
  // a človek musí vidieť, ktorej firmy filtre práve mení. Middleware session aj tak overuje
  // pri každom requeste, takže tu nepribúda žiadne nové rozhodnutie o prístupe.
  const session = await auth();

  return (
    <html lang="sk">
      <body>
        <PreferencesBoot
          tenantName={session?.claims?.organizationName ?? null}
          viewerSub={session?.claims?.sub ?? null}
        >
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
