"use client";

import { useState } from "react";
import type { DueBandKey, DueDocument, DuePosition, DuePositions } from "@/lib/home-live";
import { parseDocumentDate } from "@/lib/document-date";
import { formatCurrency, formatCurrencyPrecise } from "@/lib/format";

type Props = {
  positions: DuePositions;
  isPeriodFocused: boolean;
};

const BAND_CLASS: Record<string, string> = {
  due: "due",
  overdue: "overdue",
  overdue60: "overdue60"
};

/** Koľko pixelov musí prst prejsť, aby to bol swipe a nie ťuknutie. */
const SWIPE_THRESHOLD = 45;

function documentsWord(count: number) {
  if (count === 1) return "doklad";
  return count < 5 ? "doklady" : "dokladov";
}

function daysWord(days: number) {
  if (days === 1) return "deň";
  return days < 5 ? "dni" : "dní";
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

/**
 * Jedna strana — pohľadávky alebo záväzky — ako dvojstránková karta: prvá strana
 * je pruh so pásmami, druhá zoznam dokladov, z ktorých pruh vznikol. Swipe medzi
 * nimi nahradil tlačidlo v hlavičke karty, ktoré na to bolo priveľké.
 *
 * Vykresľuje sa VŽDY len aktívna strana, nie obe vedľa seba pod `translateX`.
 * Dôvod je výška: zoznam dokladov je oveľa vyšší než pruh, takže spoločná dráha
 * by bola vysoká ako zoznam a pod pruhom by zostala prázdna diera.
 */
function DueDeck({
  title,
  position,
  hasDocuments
}: {
  title: string;
  position: DuePosition;
  /** `false` = niet čo listovať, karta zostane jednostránková. */
  hasDocuments: boolean;
}) {
  const [showDocuments, setShowDocuments] = useState(false);
  const [bandFilter, setBandFilter] = useState<DueBandKey | "all">("all");
  const [touchStart, setTouchStart] = useState<{ x: number; y: number } | null>(null);

  const positiveBands = position.bands.filter((band) => band.total > 0);
  // Menovateľ NESMIE byť position.total: dobropis (záporná suma) urobí niektoré
  // pásmo záporným, takže podpísaný súčet potom nemá nič spoločné so šírkami,
  // ktoré sa reálne kreslia — vie vyjsť nula alebo záporné číslo, hoci v pruhu
  // svieti plná farba. Prirodzený menovateľ je súčet len kladných pásiem, teda
  // presne tých, čo sa do pruhu vôbec kreslia; `|| 1` chráni pred delením nulou,
  // keď sú kladné pásma prázdne.
  const positiveTotal = positiveBands.reduce((sum, band) => sum + band.total, 0) || 1;

  const availableBands = position.bands.filter((band) => band.count > 0);
  const documents =
    bandFilter === "all"
      ? position.documents
      : position.documents.filter((document) => document.band === bandFilter);
  const documentsTotal = documents.reduce((sum, document) => sum + document.amount, 0);

  const openDocuments = (band: DueBandKey | "all") => {
    if (!hasDocuments) return;
    setBandFilter(band);
    setShowDocuments(true);
  };

  const handleTouchStart = (event: React.TouchEvent<HTMLDivElement>) => {
    const touch = event.touches[0];
    setTouchStart(touch ? { x: touch.clientX, y: touch.clientY } : null);
  };

  const handleTouchMove = (event: React.TouchEvent<HTMLDivElement>) => {
    if (!touchStart) return;
    const touch = event.touches[0];
    if (!touch) return;
    // Vodorovné gesto si zoberieme, svislé pustíme ďalej — inak by sa na karte
    // nedala rolovať stránka.
    const deltaX = Math.abs(touchStart.x - touch.clientX);
    const deltaY = Math.abs(touchStart.y - touch.clientY);
    if (deltaX > deltaY && deltaX > 8) {
      event.preventDefault();
    }
  };

  const handleTouchEnd = (event: React.TouchEvent<HTMLDivElement>) => {
    if (!touchStart) return;
    const endX = event.changedTouches[0]?.clientX ?? touchStart.x;
    const delta = touchStart.x - endX;
    setTouchStart(null);
    if (Math.abs(delta) <= SWIPE_THRESHOLD) return;
    // Doľava dopredu na zoznam, doprava späť na pruh. Pri návrate padá filter
    // pásma, aby swipe tam a zase sem neskončil na inom zozname, než z akého odišiel.
    if (delta > 0) {
      openDocuments("all");
    } else {
      setShowDocuments(false);
      setBandFilter("all");
    }
  };

  return (
    <div
      className="due-row"
      onTouchStart={hasDocuments ? handleTouchStart : undefined}
      onTouchMove={hasDocuments ? handleTouchMove : undefined}
      onTouchEnd={hasDocuments ? handleTouchEnd : undefined}
    >
      <div className="due-row-head">
        <span className="profit-kpi-label">{title}</span>
        <strong>{formatCurrency(position.total)}</strong>
      </div>

      {showDocuments ? (
        <div className="due-deck-page" key="documents">
          {/* Pásma ako filter zoznamu — len tie, ktoré na tejto strane niečo majú. */}
          {availableBands.length > 1 ? (
            <div className="due-band-chips">
              <button
                type="button"
                className={bandFilter === "all" ? "filter-chip active" : "filter-chip"}
                onClick={() => setBandFilter("all")}
              >
                Všetko ({position.count})
              </button>
              {availableBands.map((band) => (
                <button
                  key={band.key}
                  type="button"
                  className={bandFilter === band.key ? "filter-chip active" : "filter-chip"}
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

          <ul className="invoice-list due-doc-list">
            {documents.map((document) => (
              <DueDocumentRow key={document.key} document={document} />
            ))}
          </ul>
        </div>
      ) : (
        <div className="due-deck-page" key="bands">
          <div
            className="due-bar"
            role="img"
            aria-label={`${title}: ${formatCurrency(position.total)}`}
          >
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
                {/* Ťuknutie na pásmo je skratka k swipe: otvorí zoznam už zúžený
                    na to pásmo. Pásmo bez dokladov ostáva textom — tlačidlo, ktoré
                    otvorí prázdny zoznam, je len sľub, čo sa nedodrží. */}
                {hasDocuments && band.count > 0 ? (
                  <button
                    type="button"
                    className="due-band-button"
                    onClick={() => openDocuments(band.key)}
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
        </div>
      )}

      {/* Bodky sú aj ovládanie, aj jediný signál, že sa karta dá listovať —
          samotné gesto na obrazovke nie je vidieť, a na myši ho ani nemá kto urobiť. */}
      {hasDocuments ? (
        <div className="due-deck-dots" role="group" aria-label={`${title} — prepnutie zobrazenia`}>
          <button
            type="button"
            className={showDocuments ? "due-deck-dot" : "due-deck-dot active"}
            aria-pressed={!showDocuments}
            aria-label="Podľa splatnosti"
            onClick={() => {
              setShowDocuments(false);
              setBandFilter("all");
            }}
          />
          <button
            type="button"
            className={showDocuments ? "due-deck-dot active" : "due-deck-dot"}
            aria-pressed={showDocuments}
            aria-label="Zoznam dokladov"
            onClick={() => openDocuments("all")}
          />
        </div>
      ) : null}
    </div>
  );
}

export function HomeDueCard({ positions, isPeriodFocused }: Props) {
  // Zoznam sa dá listovať len tam, kde je čo listovať. Pri chýbajúcom stave úhrady
  // faktúr nevieme, ktoré pohľadávky sú neuhradené — prázdny zoznam by tvrdil, že
  // nie je čo dostať.
  const canListReceivables = positions.receivablesAvailable && positions.receivables.count > 0;
  const totalCount =
    (positions.receivablesAvailable ? positions.receivables.count : 0) + positions.payables.count;

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
              {totalCount > 0 ? ` · ${totalCount} neuhradených ${documentsWord(totalCount)}` : ""}
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
          </>
        )}

        {/* Pruhy patria karte vždy, nie len keď stav úhrady chýba: hlavička
            povie jedno číslo, pruhy povedia, z akých splatností vzniklo. Keď
            sa odtiaľto zbalenie odstraňovalo, spadli omylom do vetvy „údaj
            nedostupný" a v bežnom prípade sa vôbec nenakreslili. */}
        {positions.receivablesAvailable ? (
          <DueDeck
            title="Mám dostať"
            position={positions.receivables}
            hasDocuments={canListReceivables}
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

        <DueDeck
          title="Mám zaplatiť"
          position={positions.payables}
          hasDocuments={positions.payables.count > 0}
        />
      </article>
    </section>
  );
}
