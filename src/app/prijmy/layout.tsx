import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Príjmy"
};

export default function PrijmyLayout({ children }: { children: React.ReactNode }) {
  return children;
}
