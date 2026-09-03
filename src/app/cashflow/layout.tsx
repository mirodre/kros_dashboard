import type { Metadata } from "next";

export const metadata: Metadata = {
  // Len názov modulu — prefix „KROS" dopĺňa `title.template` v koreňovom layoute.
  title: "Financie"
};

export default function CashflowLayout({ children }: { children: React.ReactNode }) {
  return children;
}
