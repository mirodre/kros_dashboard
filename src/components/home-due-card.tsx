"use client";

import type { DuePosition, DuePositions } from "@/lib/home-live";
import { formatCurrency } from "@/lib/format";

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
  const positiveBands = position.bands.filter((band) => band.total > 0);
  // Menovateľ NESMIE byť position.total: dobropis (záporná suma) urobí niektoré
  // pásmo záporným, takže podpísaný súčet potom nemá nič spoločné so šírkami,
  // ktoré sa reálne kreslia — vie vyjsť nula alebo záporné číslo, hoci v pruhu
  // svieti plná farba. Prirodzený menovateľ je súčet len kladných pásiem, teda
  // presne tých, čo sa do pruhu vôbec kreslia; `|| 1` chráni pred delením nulou,
  // keď sú kladné pásma prázdne.
  const positiveTotal = positiveBands.reduce((sum, band) => sum + band.total, 0) || 1;

  return (
    <div className="due-row">
      <div className="due-row-head">
        <span className="profit-kpi-label">{title}</span>
        <strong>{formatCurrency(position.total)}</strong>
      </div>
      <div className="due-bar" role="img" aria-label={`${title}: ${formatCurrency(position.total)}`}>
        {positiveBands.map((band) => (
          <span
            key={band.key}
            className={`due-bar-segment ${BAND_CLASS[band.key]}`}
            style={{ width: `${Math.min(100, (band.total / positiveTotal) * 100)}%` }}
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
  return (
    <section className="dashboard-body">
      <article className="panel">
        <header className="panel-head">
          <h3>Pohľadávky a záväzky</h3>
        </header>

        {positions.receivablesAvailable ? (
          <>
            <p className="profit-headline">{formatCurrency(positions.net)}</p>
            <p className="profit-headline-meta">
              čiastka po vyrovnaní
              {isPeriodFocused ? " · k dnešku, nezávisle od vybraného obdobia" : ""}
            </p>
          </>
        ) : (
          <>
            {/* Bez stavu úhrady faktúr nevieme, koľko máme dostať — a bez toho
                sa „čiastka po vyrovnaní" nedá spočítať. Pomlčka namiesto čísla:
                chýbajúci údaj a nula sú dve rôzne správy, hlavičku to nesmie
                zamlčať tak, ako to takmer urobilo odčítanie v computeDuePositions. */}
            <p className="profit-headline">—</p>
            <p className="profit-headline-meta">
              čiastka po vyrovnaní sa nedá spočítať — chýba stav úhrady faktúr
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
