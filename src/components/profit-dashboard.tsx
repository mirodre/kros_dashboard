"use client";

import { KpiCarousel } from "@/components/kpi-carousel";
import { ProfitChart } from "@/components/profit-chart";
import type { ProfitKpiValue, ProfitKpis, ProfitPoint } from "@/lib/home-live";
import type { KpiCard } from "@/lib/mock-data";
import { formatCurrency, formatDelta } from "@/lib/format";

type Props = {
  kpis: ProfitKpis;
  /** Swipovateľné karty nad panelom — to isté miesto, aké majú Príjmy a Výdavky. */
  kpiCards: KpiCard[];
  points: ProfitPoint[];
  focusedPeriod: string | null;
  onFocusedPeriodChange?: (label: string | null) => void;
};

function DeltaBadge({ value, invert = false }: { value: ProfitKpiValue; invert?: boolean }) {
  // Bez vlaňajška percento neexistuje. Prázdny odznak je lepší než „+100 %",
  // ktoré by tvrdilo rast tam, kde sa nie je s čím porovnať.
  if (value.deltaPct === null) return null;
  // Pri výdavkoch je pokles dobrá správa — `invert` otočí farby, aby menej
  // minutých peňazí nesvietilo červeno (zisk a príjmy ostávajú bez otočenia).
  const isGood = invert ? value.deltaPct <= 0 : value.deltaPct >= 0;
  return (
    <span className={isGood ? "delta up" : "delta down"}>
      {formatDelta(value.deltaPct)}
    </span>
  );
}

export function ProfitDashboard({
  kpis,
  kpiCards,
  points,
  focusedPeriod,
  onFocusedPeriodChange
}: Props) {
  return (
    <section className="dashboard-body">
      <KpiCarousel items={kpiCards} />

      <article className="panel">
        <header className="panel-head">
          <h3>Zisk firmy</h3>
        </header>

        {/* Hlavné číslo zisku nesú KPI karty nad panelom — tu by bolo to isté
            druhýkrát o pár pixelov nižšie. Ostáva len štítok obdobia: bez neho
            by riadok Príjmy/Výdavky pod grafom nepovedal, za ktoré obdobie je. */}
        <p className="profit-headline-meta">{kpis.periodLabel ?? "—"}</p>

        <ProfitChart
          points={points}
          focusedPeriod={focusedPeriod}
          onFocusedPeriodChange={onFocusedPeriodChange}
        />

        <div className="profit-kpi-row">
          <div>
            <span className="profit-kpi-label">Príjmy</span>
            <strong>{formatCurrency(kpis.income.current)}</strong>
            <DeltaBadge value={kpis.income} />
          </div>
          <div>
            <span className="profit-kpi-label">Výdavky</span>
            <strong>{formatCurrency(kpis.expense.current)}</strong>
            <DeltaBadge value={kpis.expense} invert />
          </div>
        </div>
      </article>
    </section>
  );
}
