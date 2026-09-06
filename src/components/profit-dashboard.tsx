"use client";

import { ProfitChart } from "@/components/profit-chart";
import type { ProfitKpiValue, ProfitKpis, ProfitPoint } from "@/lib/home-live";
import { formatCurrency, formatDelta } from "@/lib/format";

type Props = {
  kpis: ProfitKpis;
  points: ProfitPoint[];
  focusedPeriod: string | null;
  onFocusedPeriodChange?: (label: string | null) => void;
};

function DeltaBadge({ value }: { value: ProfitKpiValue }) {
  // Bez vlaňajška percento neexistuje. Prázdny odznak je lepší než „+100 %",
  // ktoré by tvrdilo rast tam, kde sa nie je s čím porovnať.
  if (value.deltaPct === null) return null;
  return (
    <span className={value.deltaPct >= 0 ? "delta up" : "delta down"}>
      {formatDelta(value.deltaPct)}
    </span>
  );
}

export function ProfitDashboard({ kpis, points, focusedPeriod, onFocusedPeriodChange }: Props) {
  return (
    <section className="dashboard-body">
      <article className="panel">
        <header className="panel-head">
          <h3>Zisk firmy</h3>
        </header>

        <p className="profit-headline">{formatCurrency(kpis.profit.current)}</p>
        <p className="profit-headline-meta">
          {kpis.periodLabel ?? "—"} <DeltaBadge value={kpis.profit} />
        </p>

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
            <DeltaBadge value={kpis.expense} />
          </div>
        </div>
      </article>
    </section>
  );
}
