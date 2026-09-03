import type { Metadata } from "next";

export const metadata: Metadata = {
  // Len názov modulu — prefix „KROS" dopĺňa `title.template` v koreňovom layoute.
  // Layout je tu iba pre tento titulok: page.tsx je klientský komponent, a ten
  // metadata exportovať nemôže.
  title: "Výdavky"
};

export default function ExpensesLayout({ children }: { children: React.ReactNode }) {
  return children;
}
