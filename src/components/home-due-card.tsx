"use client";

import type { DuePosition, DuePositions } from "@/lib/home-live";
import { formatCurrency } from "@/lib/format";
import { usePersistedCollapsed } from "@/lib/use-persisted-collapsed";

type Props = {
  positions: DuePositions;
  isPeriodFocused: boolean;
};

const BAND_CLASS: Record<string, string> = {
  due: "due",
  overdue: "overdue",
  overdue60: "overdue60"
};

function DueRow({ title, position }: { title: string; position: DuePosition }) {
  const total = position.total || 1;

  return (
    <div className="due-row">
      <div className="due-row-head">
        <span className="profit-kpi-label">{title}</span>
        <strong>{formatCurrency(position.total)}</strong>
      </div>
      <div className="due-bar" role="img" aria-label={`${title}: ${formatCurrency(position.total)}`}>
        {position.bands
          .filter((band) => band.total > 0)
          .map((band) => (
            <span
              key={band.key}
              className={`due-bar-segment ${BAND_CLASS[band.key]}`}
              style={{ width: `${(band.total / total) * 100}%` }}
            />
          ))}
      </div>
      <ul className="due-bands">
        {position.bands.map((band) => (
          <li key={band.key} className={BAND_CLASS[band.key]}>
            <span>{band.label}</span>
            <strong>{formatCurrency(band.total)}</strong>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function HomeDueCard({ positions, isPeriodFocused }: Props) {
  const [collapsed, setCollapsed] = usePersistedCollapsed("ui.collapsed.homeReceivables");

  return (
    <section className="dashboard-body">
      <article className={`panel${collapsed ? " panel-collapsed" : ""}`}>
        <header className="panel-head">
          <button
            type="button"
            className="panel-collapse-toggle"
            onClick={() => setCollapsed(!collapsed)}
            aria-expanded={!collapsed}
            aria-label={collapsed ? "Rozbaliť Pohľadávky a záväzky" : "Zbaliť Pohľadávky a záväzky"}
          >
            <span className={`panel-collapse-chevron${collapsed ? " collapsed" : ""}`} aria-hidden="true">
              ▾
            </span>
            <h3>Pohľadávky a záväzky</h3>
          </button>
        </header>

        {collapsed ? null : (
          <>
            <p className="profit-headline">{formatCurrency(positions.net)}</p>
            <p className="profit-headline-meta">
              čiastka po vyrovnaní
              {isPeriodFocused ? " · k dnešku, nezávisle od vybraného obdobia" : ""}
            </p>

            {positions.receivablesAvailable ? (
              <DueRow title="Mám dostať" position={positions.receivables} />
            ) : (
              <div className="due-row">
                <span className="profit-kpi-label">Mám dostať</span>
                {/* Chýbajúci údaj a nula sú dve rôzne správy. Pri peniazoch sa
                    zamieňať nesmú — radšej priznáme, že to nevieme. */}
                <p className="tag-filter-help">
                  Údaj z KROS nedostupný — faktúry nenesú stav úhrady.
                </p>
              </div>
            )}

            <DueRow title="Mám zaplatiť" position={positions.payables} />
          </>
        )}
      </article>
    </section>
  );
}
