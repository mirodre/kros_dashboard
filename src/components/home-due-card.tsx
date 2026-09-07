"use client";

import { useMemo, useState } from "react";
import type { DueBandKey, DueDocument, DuePosition, DuePositions } from "@/lib/home-live";
import { parseDocumentDate } from "@/lib/document-date";
import { formatCurrency, formatCurrencyPrecise } from "@/lib/format";
import { SheetOverlay } from "@/components/sheet-overlay";

type Props = {
  positions: DuePositions;
  isPeriodFocused: boolean;
};

const BAND_CLASS: Record<string, string> = {
  due: "due",
  overdue: "overdue",
  overdue60: "overdue60"
};

/** Ktorú stranu má otvorený zoznam dokladov. `null` = zoznam je zavretý. */
type DueSide = "receivables" | "payables";

const SIDE_TITLE: Record<DueSide, string> = {
  receivables: "Mám dostať",
  payables: "Mám zaplatiť"
};

function documentsWord(count: number) {
  if (count === 1) return "doklad";
  return count < 5 ? "doklady" : "dokladov";
}

function daysWord(days: number) {
  if (days === 1) return "deň";
  return days < 5 ? "dni" : "dní";
}

/** Zoznam dokladov ako ikona: tri riadky s odrážkami, v štýle ostatných ikon appky. */
function DocumentListIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
      <path
        d="M4.6 6.5h.01M4.6 12h.01M4.6 17.5h.01M9 6.5h10.4M9 12h10.4M9 17.5h10.4"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  );
}

function DueRow({
  title,
  position,
  onOpenBand,
  onOpenAll
}: {
  title: string;
  position: DuePosition;
  /** `undefined` = pásma sa nedajú rozkliknúť (niet čo ukázať). */
  onOpenBand?: (band: DueBandKey) => void;
  /** `undefined` = ikona zoznamu sa nekreslí, niet čo vypísať. */
  onOpenAll?: () => void;
}) {
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
      {/* Pásma a ikona zoznamu v jednom riadku: ikona sadne na voľné miesto vpravo
          vedľa čísel, nie do hlavičky karty, kde z nej muselo byť celé tlačidlo. */}
      <div className="due-bands-row">
        <ul className="due-bands">
          {position.bands.map((band) => (
            <li key={band.key} className={BAND_CLASS[band.key]}>
            {/* Rozklik pásma je tá istá cesta ako klik do grafu vo Výdavkoch: číslo
                v legende otvorí práve tie doklady, z ktorých vzniklo. Pásmo bez
                dokladov ostáva obyčajným textom — tlačidlo, ktoré otvorí prázdny
                zoznam, je len sľub, čo sa nedodrží. */}
              {onOpenBand && band.count > 0 ? (
                <button
                  type="button"
                  className="due-band-button"
                  onClick={() => onOpenBand(band.key)}
                  aria-label={`${title} — ${band.label}: ${formatCurrency(band.total)}, ${band.count} ${documentsWord(band.count)}`}
                >
                  <span>{band.label}</span>
                  <strong>{formatCurrency(band.total)}</strong>
                </button>
              ) : (
                <>
                  <span>{band.label}</span>
                  <strong>{formatCurrency(band.total)}</strong>
                </>
              )}
            </li>
          ))}
        </ul>

        {onOpenAll ? (
          <button
            type="button"
            className="due-docs-button"
            onClick={onOpenAll}
            aria-label={`${title} — zoznam dokladov (${position.count} ${documentsWord(position.count)})`}
            title="Zoznam dokladov"
          >
            <DocumentListIcon />
          </button>
        ) : null}
      </div>
    </div>
  );
}

function DueDocumentRow({ document }: { document: DueDocument }) {
  const due = document.dueDate ? parseDocumentDate(document.dueDate) : null;

  return (
    <li>
      <div className="invoice-item-head">
        <div className="invoice-item-text">
          <p className="tag-name invoice-title-line">{document.partnerName}</p>
          <p className="tag-sub">
            {document.documentLabel}
            {document.documentNumber ? ` • ${document.documentNumber}` : ""}
            {due ? ` • splatnosť ${due.toLocaleDateString("sk-SK")}` : " • bez splatnosti"}
          </p>
          {/* Firma je vlastný riadok, nie prívesok k typu dokladu: pri viacerých
              firmách je to jediné, čo dva inak rovnaké riadky rozlíši. */}
          <p className="tag-sub due-doc-company">{document.companyName}</p>
        </div>
        <div className="invoice-item-amount">
          <strong>{formatCurrencyPrecise(document.amount)}</strong>
          {document.daysOverdue !== null ? (
            <span className={`due-doc-badge ${BAND_CLASS[document.band]}`}>
              {document.daysOverdue} {daysWord(document.daysOverdue)} po splatnosti
            </span>
          ) : null}
          {document.documentTotal !== undefined ? (
            <span className="tag-sub">z {formatCurrencyPrecise(document.documentTotal)}</span>
          ) : null}
        </div>
      </div>
    </li>
  );
}

export function HomeDueCard({ positions, isPeriodFocused }: Props) {
  const [openSide, setOpenSide] = useState<DueSide | null>(null);
  // Pásmo, na ktoré sa kliklo v legende. Drží sa mimo `openSide`, aby prepnutie
  // strany v zozname nezhodilo zvolené pásmo, keď ho druhá strana tiež má.
  const [bandFilter, setBandFilter] = useState<DueBandKey | "all">("all");

  const openList = (side: DueSide, band: DueBandKey | "all") => {
    setOpenSide(side);
    setBandFilter(band);
  };

  const position = openSide === "receivables" ? positions.receivables : positions.payables;

  // Prepnutie strany nesmie ostať na pásme, ktoré druhá strana nemá: záväzky
  // nepoznajú „nad 60 dní", takže zoznam by po prepnutí ukázal prázdno a chip,
  // ktorý v ňom nie je. Vtedy padá filter na „Všetko".
  const availableBands = position.bands.filter((band) => band.count > 0);
  const activeBand =
    bandFilter !== "all" && availableBands.some((band) => band.key === bandFilter)
      ? bandFilter
      : "all";

  const documents = useMemo(
    () =>
      activeBand === "all"
        ? position.documents
        : position.documents.filter((document) => document.band === activeBand),
    [position, activeBand]
  );
  const documentsTotal = documents.reduce((sum, document) => sum + document.amount, 0);

  // Zoznam otvárame len tam, kde je čo otvoriť. Pri chýbajúcom stave úhrady
  // faktúr nevieme, ktoré pohľadávky sú neuhradené — prázdny zoznam by tvrdil,
  // že nie je čo dostať.
  const canOpenReceivables = positions.receivablesAvailable && positions.receivables.count > 0;
  const canOpenPayables = positions.payables.count > 0;

  return (
    <section className="dashboard-body">
      <article className="panel">
        <header className="panel-head">
          <h3>Pohľadávky a záväzky</h3>
        </header>

        {/* Popis vedľa čísla, nie pod ním: dva riadky brali na výšku toľko, že
            pruhy pod nimi odchádzali z prvého pohľadu. Počet neuhradených dokladov
            odtiaľ odišiel celý — koľko ich je, povie zoznam, ktorý sa otvára
            ikonou pri pásmach. */}
        <p className="profit-headline due-headline">
          {positions.receivablesAvailable ? (
            <>
              <span>{formatCurrency(positions.net)}</span>
              <span className="due-headline-note">
                čiastka po vyrovnaní
                {isPeriodFocused ? " · k dnešku, nezávisle od vybraného obdobia" : ""}
              </span>
            </>
          ) : (
            <>
              {/* Bez stavu úhrady faktúr nevieme, koľko máme dostať — a bez toho
                  sa „čiastka po vyrovnaní" nedá spočítať. Pomlčka namiesto čísla:
                  chýbajúci údaj a nula sú dve rôzne správy, hlavičku to nesmie
                  zamlčať tak, ako to takmer urobilo odčítanie v computeDuePositions. */}
              <span>—</span>
              <span className="due-headline-note">
                čiastka po vyrovnaní sa nedá spočítať — chýba stav úhrady faktúr
              </span>
            </>
          )}
        </p>

        {/* Pruhy patria karte vždy, nie len keď stav úhrady chýba: hlavička
            povie jedno číslo, pruhy povedia, z akých splatností vzniklo. Keď
            sa odtiaľto zbalenie odstraňovalo, spadli omylom do vetvy „údaj
            nedostupný" a v bežnom prípade sa vôbec nenakreslili. */}
        {positions.receivablesAvailable ? (
          <DueRow
            title="Mám dostať"
            position={positions.receivables}
            onOpenBand={
              canOpenReceivables ? (band) => openList("receivables", band) : undefined
            }
            onOpenAll={canOpenReceivables ? () => openList("receivables", "all") : undefined}
          />
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

        <DueRow
          title="Mám zaplatiť"
          position={positions.payables}
          onOpenBand={canOpenPayables ? (band) => openList("payables", band) : undefined}
          onOpenAll={canOpenPayables ? () => openList("payables", "all") : undefined}
        />
      </article>

      {openSide ? (
        <SheetOverlay onClose={() => setOpenSide(null)}>
          <div
            className="tag-filter-sheet unsettled-payments-sheet"
            role="dialog"
            aria-modal="true"
            aria-label="Zoznam neuhradených dokladov"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="tag-filter-head">
              <div>
                <h4>Zoznam dokladov</h4>
                <p className="tag-filter-help">Neuhradené k dnešku.</p>
              </div>
              <button type="button" className="filter-close" onClick={() => setOpenSide(null)}>
                Zavrieť
              </button>
            </header>

            <div className="invoice-detail-tabs">
              {canOpenReceivables ? (
                <button
                  type="button"
                  className={openSide === "receivables" ? "filter-chip active" : "filter-chip"}
                  onClick={() => setOpenSide("receivables")}
                >
                  {SIDE_TITLE.receivables} ({positions.receivables.count})
                </button>
              ) : null}
              {canOpenPayables ? (
                <button
                  type="button"
                  className={openSide === "payables" ? "filter-chip active" : "filter-chip"}
                  onClick={() => setOpenSide("payables")}
                >
                  {SIDE_TITLE.payables} ({positions.payables.count})
                </button>
              ) : null}
            </div>

            {/* Pásma sú druhá úroveň filtra, nie ďalšie taby — preto vlastný riadok.
                Ukazujeme len tie, ktoré na tejto strane niečo majú. */}
            {availableBands.length > 1 ? (
              <div className="invoice-detail-tabs due-band-chips">
                <button
                  type="button"
                  className={activeBand === "all" ? "filter-chip active" : "filter-chip"}
                  onClick={() => setBandFilter("all")}
                >
                  Všetko ({position.count})
                </button>
                {availableBands.map((band) => (
                  <button
                    key={band.key}
                    type="button"
                    className={activeBand === band.key ? "filter-chip active" : "filter-chip"}
                    onClick={() => setBandFilter(band.key)}
                  >
                    {band.label} ({band.count})
                  </button>
                ))}
              </div>
            ) : null}

            <div className="invoice-detail-summary">
              <span>
                {documents.length} {documentsWord(documents.length)}
              </span>
              <strong>{formatCurrencyPrecise(documentsTotal)}</strong>
            </div>

            {documents.length === 0 ? (
              <p className="tag-sub">
                {openSide === "receivables"
                  ? "Skvelé, všetko je uhradené."
                  : "Nič nečaká na úhradu."}
              </p>
            ) : (
              <ul className="invoice-list">
                {documents.map((document) => (
                  <DueDocumentRow key={document.key} document={document} />
                ))}
              </ul>
            )}
          </div>
        </SheetOverlay>
      ) : null}
    </section>
  );
}
