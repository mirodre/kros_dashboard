import type { Metadata, Viewport } from "next";
import "./globals.css";

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
  themeColor: "#111420"
};

export default function RootLayout({
  children
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="sk">
      <body>
        {children}
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
