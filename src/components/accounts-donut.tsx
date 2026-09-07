"use client";

import { useMemo } from "react";
import { CHART_SLICE_COLORS } from "@/lib/chart-slice-colors";
import type { CashflowAccountPoint } from "@/lib/cashflow-mock-data";
import { formatCurrency } from "@/lib/format";
import { useDonutEntrance } from "@/lib/use-donut-entrance";
import { DonutLegend } from "./donut-legend";

type Props = {
  /** Účty, ktoré majú byť v grafe — filtrovanie si rieši volajúci. */
  accounts: CashflowAccountPoint[];
  /** Zameraný účet, alebo `"all"` pre celkový zostatok v strede. */
  activeAccountId: string | "all";
  onActiveAccountChange: (id: string | "all") => void;
  /**
   * Trend oproti minulému obdobiu v dlaždici legendy. Domov ho zámerne nechce —
   * priniesol by závislosť na období, ktorej sa tá karta vyhýba (ukazuje zostatok
   * k dnešku). Bez trendu má dlaždica o riadok nižšiu mriežku (`no-trend`).
   */
  showTrend?: boolean;
  donutAriaLabel?: string;
  legendAriaLabel?: string;
};

/** „1 účet“, „2/3/4 účty“, „0“ aj „5+ účtov“ — nula ide s väčšinovým tvarom, nie so vzorom pre 2–4. */
function accountsWord(count: number) {
  if (count === 1) return "účet";
  if (count >= 2 && count <= 4) return "účty";
  return "účtov";
}

/** Účet bez výseku (nulový či prečerpaný) nemá v koláči čo zafarbiť — v legende dostane tlmenú sivú. */
const NO_SLICE_ACCENT = "#5b6478";

/**
 * Koláč zostatkov na účtoch — zdieľaný medzi Financiami a kartou „Peniaze na účtoch“
 * na Domove, aby mali rovnaké farby, hrúbku prstenca, číslo v strede aj zameranie
 * výseku. Stav zamerania drží volajúci: vo Financiách filtruje aj ostatné panely,
 * na Domove len prepína, čo je v strede.
 */
export function AccountsDonut({
  accounts,
  activeAccountId,
  onActiveAccountChange,
  showTrend = true,
  donutAriaLabel = "Zostatok podľa účtov",
  legendAriaLabel = "Účty v grafe zostatkov"
}: Props) {
  const chartData = useMemo(() => {
    // Largest slices get rank 0,1,… — paleta je zdieľaná so všetkými grafmi.
    const palette = CHART_SLICE_COLORS;
    const total = accounts.reduce((sum, account) => sum + Math.max(account.amount, 0), 0);

    const valueById = new Map(
      accounts.map((account) => [account.id, Math.max(account.amount, 0)])
    );
    const rankById = new Map<string, number>();
    [...valueById.entries()]
      .sort((a, b) => b[1] - a[1])
      .forEach(([id], rank) => {
        rankById.set(id, rank);
      });

    let cumulative = -Math.PI / 2;
    return accounts.map((account, index) => {
      const value = Math.max(account.amount, 0);
      const share = total === 0 ? 0 : value / total;
      const startAngle = cumulative;
      const endAngle = cumulative + share * Math.PI * 2;
      cumulative = endAngle;
      const colorRank = rankById.get(account.id) ?? index;
      return {
        ...account,
        value,
        share,
        // Nulové a prečerpané účty sedia v poradí až za kladnými, takže tlmená sivá
        // neposunie farby ostatným výsekom.
        color: value > 0 ? palette[colorRank % palette.length] : NO_SLICE_ACCENT,
        startAngle,
        endAngle
      };
    });
  }, [accounts]);

  const totalBalance = useMemo(
    () => chartData.reduce((sum, item) => sum + item.amount, 0),
    [chartData]
  );

  const activeSlice = useMemo(
    () => chartData.find((item) => item.id === activeAccountId),
    [chartData, activeAccountId]
  );

  /** Share of real aggregate balance (signed); falls back to pie share when total ≈ 0. */
  const activeAccountSharePercent = useMemo(() => {
    if (!activeSlice) return null;
    const t = totalBalance;
    if (Math.abs(t) < 1e-9) return activeSlice.share * 100;
    return (activeSlice.amount / t) * 100;
  }, [activeSlice, totalBalance]);

  // Podpis výsekov, nie identita poľa: prekreslenie s tými istými zostatkami (klik na
  // výsek, dorovnané nastavenia po štarte) vstupnú animáciu nespustí.
  const donutShapeKey = useMemo(
    () => chartData.map((slice) => `${slice.id}:${slice.amount}`).join("|"),
    [chartData]
  );

  const isPieAnimated = useDonutEntrance(donutShapeKey);

  const toggleAccount = (id: string) => {
    onActiveAccountChange(activeAccountId === id ? "all" : id);
  };

  return (
    <div className="cashflow-donut-wrap">
      <div className="cashflow-donut-card">
        <svg className="cashflow-donut-svg" viewBox="0 0 320 320" role="img" aria-label={donutAriaLabel}>
          {chartData.map((slice, sliceIndex) => {
            const isActive = activeAccountId === slice.id;
            const outerRadius = isActive ? 136 : 126;
            const innerRadius = 90;
            const center = 160;
            // Math.sin/cos sa líšia v poslednom bite medzi Node a prehliadačom —
            // bez zaokrúhlenia by sa atribút `d` nezhodoval pri SSR hydratácii.
            const coord = (value: number) => value.toFixed(2);
            const startOuterX = coord(center + outerRadius * Math.cos(slice.startAngle));
            const startOuterY = coord(center + outerRadius * Math.sin(slice.startAngle));
            const endOuterX = coord(center + outerRadius * Math.cos(slice.endAngle));
            const endOuterY = coord(center + outerRadius * Math.sin(slice.endAngle));
            const startInnerX = coord(center + innerRadius * Math.cos(slice.startAngle));
            const startInnerY = coord(center + innerRadius * Math.sin(slice.startAngle));
            const endInnerX = coord(center + innerRadius * Math.cos(slice.endAngle));
            const endInnerY = coord(center + innerRadius * Math.sin(slice.endAngle));
            const isLargeArc = slice.endAngle - slice.startAngle > Math.PI ? 1 : 0;
            const path = [
              `M ${startOuterX} ${startOuterY}`,
              `A ${outerRadius} ${outerRadius} 0 ${isLargeArc} 1 ${endOuterX} ${endOuterY}`,
              `L ${endInnerX} ${endInnerY}`,
              `A ${innerRadius} ${innerRadius} 0 ${isLargeArc} 0 ${startInnerX} ${startInnerY}`,
              "Z"
            ].join(" ");
            const isDimmed = activeAccountId !== "all" && !isActive;
            return (
              <path
                key={slice.id}
                d={path}
                className={`cashflow-donut-slice ${isPieAnimated ? "is-animated" : ""} ${isActive ? "is-active" : ""} ${isDimmed ? "is-dimmed" : ""}`}
                style={
                  {
                    fill: slice.color,
                    "--slice-index": sliceIndex
                  } as React.CSSProperties
                }
                onClick={() => toggleAccount(slice.id)}
              />
            );
          })}
          <circle
            cx="160"
            cy="160"
            r="84"
            className={isPieAnimated ? "cashflow-donut-hole is-animated" : "cashflow-donut-hole"}
          />
        </svg>
        <div className="cashflow-donut-center">
          <p className="cashflow-donut-title">{activeSlice ? activeSlice.name : "Všetky účty"}</p>
          <strong>{formatCurrency(activeSlice ? activeSlice.amount : totalBalance)}</strong>
          <span>
            {activeSlice && activeAccountSharePercent !== null
              ? `${activeAccountSharePercent.toFixed(1)} %`
              : `${accounts.length} ${accountsWord(accounts.length)}`}
          </span>
        </div>
      </div>

      <DonutLegend ariaLabel={legendAriaLabel}>
        {chartData.map((slice) => (
          <li key={slice.id}>
            <button
              type="button"
              className={[
                "cashflow-legend-item",
                showTrend ? "" : "no-trend",
                activeAccountId === slice.id ? "active" : ""
              ]
                .filter(Boolean)
                .join(" ")}
              style={{ "--legend-accent": slice.color } as React.CSSProperties}
              onClick={() => toggleAccount(slice.id)}
            >
              <span className="cashflow-legend-label">{slice.name}</span>
              <span className="cashflow-legend-value">{formatCurrency(slice.amount)}</span>
              {showTrend
                ? (() => {
                    const deltaValue = slice.amount - slice.previousAmount;
                    return (
                      <span className={deltaValue >= 0 ? "cashflow-legend-trend up" : "cashflow-legend-trend down"}>
                        {deltaValue >= 0 ? "+" : "-"}
                        {formatCurrency(Math.abs(deltaValue))}
                      </span>
                    );
                  })()
                : null}
            </button>
          </li>
        ))}
      </DonutLegend>
    </div>
  );
}
