"use client";

import { KpiCarousel } from "@/components/kpi-carousel";
import { ProfitChart } from "@/components/profit-chart";
import type { ProfitPoint } from "@/lib/home-live";
import type { KpiCard } from "@/lib/mock-data";

type Props = {
  /** Swipovateľné karty nad panelom — to isté miesto, aké majú Príjmy a Výdavky. */
  kpiCards: KpiCard[];
  points: ProfitPoint[];
  focusedPeriod: string | null;
  onFocusedPeriodChange?: (label: string | null) => void;
};

export function ProfitDashboard({
  kpiCards,
  points,
  focusedPeriod,
  onFocusedPeriodChange
}: Props) {
  return (
    <section className="dashboard-body">
      <KpiCarousel items={kpiCards} />

      {/* Panel bez hlavičky aj bez čísel: čo je to za číslo, hovoria KPI karty
          nad grafom, ktoré obdobie, hovorí os grafu, a čo je ktorá farba, hovorí
          bublina po rozkliknutí stĺpca. Nadpis „Zisk firmy" by to len zopakoval
          tretí raz. */}
      <article className="panel">
        <ProfitChart
          points={points}
          focusedPeriod={focusedPeriod}
          onFocusedPeriodChange={onFocusedPeriodChange}
        />
      </article>
    </section>
  );
}
