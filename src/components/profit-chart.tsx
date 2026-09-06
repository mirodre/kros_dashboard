"use client";

import type { ProfitPoint } from "@/lib/home-live";
import { formatCurrency } from "@/lib/format";

type Props = {
  points: ProfitPoint[];
  focusedPeriod: string | null;
  onFocusedPeriodChange?: (label: string | null) => void;
};

/**
 * Šírka jedného stĺpca v pixeloch. Pevná hodnota, nie percento kontajnera —
 * presne preto, aby stĺpce aj čiara zisku vždy dostali TÚ ISTÚ šírku obsahu
 * (pozri `contentWidth` nižšie) a nemohli sa navzájom rozísť, keď je stĺpcov
 * viac, než sa zmestí na obrazovku (viď `.profit-chart-scroll` v globals.css).
 */
const COLUMN_WIDTH = 44;

/**
 * Stĺpce sú príjmy a výdavky toho istého obdobia, čiara nad nimi je zisk.
 *
 * Všetko na JEDNEJ škále v eurách. Dve osi pre rovnaké jednotky by boli spôsob,
 * ako číslami klamať — čiara zisku by mohla vyzerať vysoko nad stĺpcami, aj keby
 * bol zisk zlomok príjmov. Cena za poctivosť je, že pri zápornom zisku sa nulová
 * čiara odlepí od spodku grafu; presne to je aj zmysel: stratový mesiac má byť
 * vidieť na prvý pohľad.
 */
export function ProfitChart({ points, focusedPeriod, onFocusedPeriodChange }: Props) {
  if (points.length === 0) {
    return <p className="tag-filter-help">Pre toto obdobie nemáme žiadne doklady.</p>;
  }

  const values = points.flatMap((point) => [point.income, point.expense, point.profit]);
  // Nula je vždy v škále, aj keď sú všetky hodnoty kladné — inak by stĺpce
  // začínali „odniekiaľ" a ich výška by nič neznamenala.
  const max = Math.max(0, ...values);
  const min = Math.min(0, ...values);
  const rawSpan = max - min;
  /**
   * Všetko na nule (firma bez dokladov, filter, ktorý nič neprepustí): stupnica
   * nemá rozpätie. `|| 1` by nestačilo — posunulo by nulovú čiaru na vrch grafu,
   * kým stĺpce by ostali dole, a os by si so stĺpcami protirečila. Nula preto ide
   * naprostred a nulové stĺpce z nej vyrastú nulovou výškou.
   *
   * Invariant, ktorý musí platiť vždy: `100 - lineY(0) === zeroPct`.
   */
  const isFlat = rawSpan === 0;
  const span = isFlat ? 1 : rawSpan;
  /** Kde leží nula, merané odspodu grafu. */
  const zeroPct = isFlat ? 50 : ((0 - min) / span) * 100;

  const heightPct = (value: number) => (Math.abs(value) / span) * 100;
  const bottomPct = (value: number) => (value >= 0 ? zeroPct : zeroPct - heightPct(value));

  // Čiara zisku je jedno SVG cez celú mriežku. `preserveAspectRatio="none"` ju
  // roztiahne presne na šírku stĺpcov, takže body sedia na stredy stĺpcov bez
  // ohľadu na to, koľko ich je.
  const stepX = 100;
  const viewBoxWidth = points.length * stepX;
  const lineY = (value: number) => (isFlat ? 50 : ((max - value) / span) * 100);
  const linePoints = points
    .map((point, index) => `${index * stepX + stepX / 2},${lineY(point.profit)}`)
    .join(" ");

  /**
   * Obsah v pixeloch — SVG aj stĺpce dostanú TÚTO ISTÚ šírku (pozri `.profit-chart-track`
   * v globals.css), takže sa neposúvajú nezávisle: `width: N%` kdekoľvek v tomto strome
   * by mieril na inú základňu podľa toho, či je stĺpcov viac či menej, ako sa zmestí
   * na obrazovku, a presne to čiaru od stĺpcov rozhodilo predtým.
   */
  const contentWidth = points.length * COLUMN_WIDTH;

  return (
    <div className="profit-chart-wrap">
      <div className="profit-chart-scroll">
        <div className="profit-chart-track" style={{ width: `${contentWidth}px` }}>
          <svg
            className="profit-chart-line"
            viewBox={`0 0 ${viewBoxWidth} 100`}
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            <line
              className="profit-chart-zero"
              x1="0"
              x2={viewBoxWidth}
              y1={lineY(0)}
              y2={lineY(0)}
              vectorEffect="non-scaling-stroke"
            />
            <polyline points={linePoints} vectorEffect="non-scaling-stroke" />
            {points.map((point, index) => (
              <circle
                key={point.label}
                cx={index * stepX + stepX / 2}
                cy={lineY(point.profit)}
                r="2"
                vectorEffect="non-scaling-stroke"
              />
            ))}
          </svg>

          <div
            className={focusedPeriod ? "profit-chart has-period-focus" : "profit-chart"}
            role="group"
            aria-label="Príjmy, výdavky a zisk po obdobiach"
          >
            {points.map((point, index) => {
              const isFocused = focusedPeriod === point.label;
              const tooltipEdgeClass =
                index === 0 ? "edge-start" : index === points.length - 1 ? "edge-end" : "";
              return (
                <button
                  type="button"
                  key={point.label}
                  className={`profit-bar-item${isFocused ? " is-period-focused" : ""}`}
                  style={{ "--bar-index": index } as React.CSSProperties}
                  aria-pressed={isFocused}
                  aria-label={`${point.label}: zisk ${formatCurrency(point.profit)}`}
                  onClick={() => onFocusedPeriodChange?.(isFocused ? null : point.label)}
                >
                  {isFocused ? (
                    <div
                      className={`chart-tooltip chart-tooltip-inline ${tooltipEdgeClass}`}
                      aria-live="polite"
                    >
                      <p className="tooltip-label">{point.label}</p>
                      <div className="tooltip-values">
                        <span>Príjmy: {formatCurrency(point.income)}</span>
                        <span>Výdavky: {formatCurrency(point.expense)}</span>
                        <span>Zisk: {formatCurrency(point.profit)}</span>
                        <span className="profit-tooltip-previous">
                          Vlani: {formatCurrency(point.previousProfit)}
                        </span>
                      </div>
                    </div>
                  ) : null}

                  <div className="profit-bar-stack">
                    <div
                      className="profit-bar income"
                      style={{
                        height: `${heightPct(point.income)}%`,
                        bottom: `${bottomPct(point.income)}%`
                      }}
                    />
                    <div
                      className="profit-bar expense"
                      style={{
                        height: `${heightPct(point.expense)}%`,
                        bottom: `${bottomPct(point.expense)}%`
                      }}
                    />
                  </div>
                  <p>{point.label}</p>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <ul className="profit-chart-legend">
        <li className="income">Príjmy</li>
        <li className="expense">Výdavky</li>
        <li className="profit">Zisk</li>
      </ul>
    </div>
  );
}
