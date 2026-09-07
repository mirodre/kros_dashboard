import type { Metadata } from "next";

export const metadata: Metadata = {
  // Len názov modulu — prefix „KROS" dopĺňa `title.template` v koreňovom layoute.
  title: "Nastavenia"
};

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
