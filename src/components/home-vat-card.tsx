"use client";

import type { VatEstimate, VatMonthEstimate } from "@/lib/home-live";
import { formatCurrencyPrecise } from "@/lib/format";
import { formatMonthKeyLabel } from "@/lib/use-sync-progress";

type Props = {
  estimate: VatEstimate;
  /**
   * Je naokolo zapnutý nejaký filter alebo rozklik (obdobie, firma, štítok)? Karta ich
   * všetky ignoruje — a práve preto to musí priznať: bez hlášky by čísla vyzerali, akoby
   * sa s ostatnými kartami rozchádzali bez dôvodu.
   */
  hasIgnoredFilters: boolean;
  /**
   * Koľko firiem drží uložený filter. Nie kozmetika: firmy mimo neho sa vôbec nesťahujú,
   * takže odhad nie je z celého účtovníctva a karta to nesmie tvrdiť.
   */
  limitedToCompanyCount: number;
};

/** Nula by tvrdila, že firma nemá čo odviesť. To je iná veta než „nevieme". */
const MISSING_NOTE = "Údaj z KROS nedostupný — doklady nenesú sumu DPH.";

/**
 * Dve strany odhadu vedľa seba, na jednej škále. Číslo v hlavičke je ich ROZDIEL, takže
 * dvojica prúžkov nie je ozdoba: ukazuje, z čoho vznikol, a rozdiel v ich dĺžkach je
 * presne to, čo firma odvedie. Modrá/oranžová sedí s grafom Zisku nad kartou
 * (`.profit-bar`) — na jednej obrazovke nesmie príjem raz svietiť modro a raz inak.
 */
function VatSides({ month }: { month: VatMonthEstimate }) {
  // Bez oboch strán nie je čo porovnávať a prázdna dvojica koľajníc by len tvrdila, že
  // sme namerali nuly. Škála je maximum z dvojice, nie ich súčet: prúžky si majú merať
  // dĺžku navzájom, nie ukrajovať si z jedného celku.
  const scale = Math.max(month.outputVat, month.inputVat);
  if (scale <= 0) return null;

  const sides = [
    { key: "output", label: "DPH z príjmov", amount: month.outputVat },
    { key: "input", label: "DPH z výdavkov", amount: month.inputVat }
  ] as const;

  return (
    <ul className="vat-sides">
      {sides.map((side) => (
        <li key={side.key} className={`vat-side ${side.key}`}>
          <span className="vat-side-label">{side.label}</span>
          <span className="vat-side-value">{formatCurrencyPrecise(side.amount)}</span>
          <span className="vat-side-track">
            <span className="vat-side-fill" style={{ width: `${(side.amount / scale) * 100}%` }} />
          </span>
        </li>
      ))}
    </ul>
  );
}

export function HomeVatCard({ estimate, hasIgnoredFilters, limitedToCompanyCount }: Props) {
  const current = estimate.currentMonth;
  const previous = estimate.previousMonth;

  return (
    <section className="dashboard-body">
      <article className="panel">
        <header className="panel-head">
          <h3>Predpokladaný odhad DPH</h3>
        </header>

        {/* Tento mesiac je to, čo firmu ešte len čaká — dostane hlavičku karty. */}
        <p className="vat-eyebrow">Tento mesiac · {formatMonthKeyLabel(current.monthKey)}</p>
        <p className="profit-headline">
          {current.amount === null ? "—" : formatCurrencyPrecise(current.amount)}
        </p>
        <p className="profit-headline-meta">
          {current.amount === null
            ? MISSING_NOTE
            : // Záporný odhad nie je „mínus na odvod": vtedy firma naopak žiada vrátiť.
              // Bez tohto slova sa smer sumy dá prečítať len zo znamienka.
              current.amount < 0
              ? "nadmerný odpočet"
              : "na odvod"}
        </p>

        <VatSides month={current} />

        {/* Minulý mesiac je už uzavretý — patrí mu tichý riadok pod čiarou, nie druhý blok. */}
        <div className="vat-previous">
          <span className="vat-previous-label">
            Minulý mesiac · {formatMonthKeyLabel(previous.monthKey)}
          </span>
          {previous.amount === null ? (
            <span className="vat-previous-missing">údaj nedostupný</span>
          ) : (
            <span className="vat-previous-value">{formatCurrencyPrecise(previous.amount)}</span>
          )}
        </div>

        {hasIgnoredFilters ? (
          <p className="tag-filter-help">
            {limitedToCompanyCount > 0
              ? // „Zo všetkých dokladov" by tu bola lož: firmy mimo uloženého filtra sa
                // nesťahujú, takže ich doklady appka nemá z čoho započítať.
                "Odhad počíta zo všetkých dokladov vybraných firiem — rozkliknuté obdobie, firma ani štítok sa sem neprenášajú."
              : "Odhad počíta zo všetkých dokladov — filtre ani rozkliknuté obdobie sa sem neprenášajú."}
          </p>
        ) : null}
      </article>
    </section>
  );
}
