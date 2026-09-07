"use client";

import { useState } from "react";
import Link from "next/link";
import { DonutLegend } from "@/components/donut-legend";
import { FilterIconButton } from "@/components/filter-icon-button";
import { SheetOverlay } from "@/components/sheet-overlay";
import { CHART_SLICE_COLORS } from "@/lib/chart-slice-colors";
import type { CashflowAccountPoint } from "@/lib/cashflow-live";
import { formatCurrency } from "@/lib/format";

type Props = {
  /** VŠETKY dostupné účty, nie už vyfiltrované — filter potrebuje z čoho ponúkať. */
  accounts: CashflowAccountPoint[];
  /** Id vybraných účtov. Prázdny výber = všetky. */
  selectedAccountIds: string[];
  onSelectedAccountIdsChange: (ids: string[]) => void;
  /** Je aktívny focus stĺpca z grafu Zisku? Karta ho ignoruje a musí to priznať. */
  isPeriodFocused: boolean;
};

/** Farby výsekov — rovnaké poradie ako v legende, aby sa dali spárovať očami. */
const SLICE_COLORS = CHART_SLICE_COLORS;

/** „1 účet", „2/3/4 účty", „0" aj „5+ účtov" — nula ide s väčšinovým tvarom, nie so vzorom pre 2–4. */
function accountsWord(count: number) {
  if (count === 1) return "účet";
  if (count >= 2 && count <= 4) return "účty";
  return "účtov";
}

/**
 * Lokál („na X účte/účtoch") pre aria-label donutu — iné pády ako `accountsWord`,
 * ktoré sklonuje pre vetu „Celkovo X účtov". V lokáli má množné číslo jediný tvar
 * bez ohľadu na počet, líši sa len jednotné vs. množné.
 */
function accountsWordLocative(count: number) {
  return count === 1 ? "účte" : "účtoch";
}

/**
 * Genitív („z X účtov") pre vetu o vybraných účtoch. Nominatív z `accountsWord` by tu dal
 * „z 3 účty" — po predložke „z" musí ísť genitív, a ten má v množnom čísle jediný tvar.
 */
function accountsWordGenitive(count: number) {
  return count === 1 ? "účtu" : "účtov";
}

export function HomeAccountsCard({
  accounts,
  selectedAccountIds,
  onSelectedAccountIdsChange,
  isPeriodFocused
}: Props) {
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  // Výber sa potvrdzuje až tlačidlom — priebežné prepisovanie by pri každom ťuknutí
  // preblikávalo donut pod otvoreným panelom.
  const [pendingSelection, setPendingSelection] = useState<string[]>(selectedAccountIds);

  // Účet vypadnutý z KROSu drží uložený výber ďalej: prienik ho ticho obíde, ale keby
  // z výberu nezostal ani jeden dostupný účet, tichá nula by tvrdila „nemáš peniaze".
  // Vtedy karta radšej ukáže všetko a povie prečo.
  const wanted = new Set(selectedAccountIds);
  const matching = selectedAccountIds.length === 0 ? accounts : accounts.filter((account) => wanted.has(account.id));
  const filterMissedAll = matching.length === 0 && accounts.length > 0;
  const visible = filterMissedAll ? accounts : matching;

  // Headline je pravdivý súčet vrátane záporných zostatkov — prečerpaný účet sa
  // do neho počíta. Do donutu idú len kladné zostatky: záporný výsek sa nedá
  // nakresliť a tiché orezanie na nulu by zväčšilo podiel ostatných účtov na
  // koláči. Headline a donut sa preto v takom prípade zámerne rozchádzajú —
  // to je správanie, nie chyba.
  const total = visible.reduce((sum, account) => sum + account.amount, 0);
  const positive = visible.filter((account) => account.amount > 0);
  const positiveTotal = positive.reduce((sum, account) => sum + account.amount, 0);

  // Farba sa priraďuje len účtom vo výseku a podľa id, nie podľa indexu v
  // `accounts` — keby pred kladným účtom stál v zozname záporný, index by sa
  // rozišiel s poradím výsekov a legenda by ukazovala inú farbu ako donut.
  const colorByAccountId = new Map(
    positive.map((account, index) => [account.id, SLICE_COLORS[index % SLICE_COLORS.length]])
  );

  let cursor = 0;
  const stops = positive.map((account) => {
    const start = (cursor / positiveTotal) * 100;
    cursor += account.amount;
    const end = (cursor / positiveTotal) * 100;
    return `${colorByAccountId.get(account.id)} ${start}% ${end}%`;
  });

  const openFilter = () => {
    setPendingSelection(selectedAccountIds);
    setIsFilterOpen(true);
  };

  const togglePendingAccount = (id: string) => {
    setPendingSelection((prev) =>
      prev.includes(id) ? prev.filter((selected) => selected !== id) : [...prev, id]
    );
  };

  return (
    <section className="dashboard-body">
      <article className="panel">
        <header className="panel-head">
          <h3>Peniaze na účtoch</h3>
          <FilterIconButton
            label="Filter účtov"
            activeCount={selectedAccountIds.length}
            onClick={openFilter}
          />
        </header>

        <p className="profit-headline">{formatCurrency(total)}</p>
        <p className="profit-headline-meta">
          {selectedAccountIds.length > 0 && !filterMissedAll
            ? `Vybrané ${visible.length} z ${accounts.length} ${accountsWordGenitive(accounts.length)}`
            : `Celkovo ${visible.length} ${accountsWord(visible.length)}`}
          {isPeriodFocused ? " · k dnešku, nezávisle od vybraného obdobia" : ""}
        </p>

        {filterMissedAll ? (
          <p className="tag-filter-help">
            Vybrané účty tu nie sú — zobrazujeme všetky. Uprav filter alebo ho zruš.
          </p>
        ) : null}

        {accounts.length === 0 ? (
          <p className="tag-filter-help">Zatiaľ nemáme žiadne účty.</p>
        ) : (
          <>
            {positive.length > 0 ? (
              <div
                className="home-donut"
                style={{ background: `conic-gradient(${stops.join(", ")})` }}
                role="img"
                aria-label={`Rozdelenie zostatkov na ${positive.length} ${accountsWordLocative(positive.length)}`}
              />
            ) : null}
            <DonutLegend ariaLabel="Zostatky na účtoch">
              {visible.map((account) => {
                // Prečerpaný účet nemá výsek — dostane tlmenú sivú namiesto farby z donutu.
                const accent = colorByAccountId.get(account.id) ?? "#5b6478";
                return (
                  <li key={account.id}>
                    <div
                      className="cashflow-legend-item home-legend-item"
                      style={{ "--legend-accent": accent } as React.CSSProperties}
                    >
                      <span className="cashflow-legend-label">{account.name}</span>
                      <span className="cashflow-legend-value">{formatCurrency(account.amount)}</span>
                    </div>
                  </li>
                );
              })}
            </DonutLegend>
          </>
        )}

        <Link href="/cashflow" className="home-card-link">
          Financie →
        </Link>
      </article>

      {isFilterOpen ? (
        <SheetOverlay onClose={() => setIsFilterOpen(false)}>
          <div
            className="tag-filter-sheet"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Filter účtov"
          >
            <header className="tag-filter-head">
              <h4>Filter účtov</h4>
              <button type="button" className="filter-close" onClick={() => setIsFilterOpen(false)}>
                Zavrieť
              </button>
            </header>

            <div className="tag-filter-options">
              {accounts.map((account) => {
                const checked = pendingSelection.includes(account.id);
                return (
                  <button
                    type="button"
                    key={account.id}
                    className={checked ? "filter-chip active" : "filter-chip"}
                    onClick={() => togglePendingAccount(account.id)}
                  >
                    {account.name}
                  </button>
                );
              })}
            </div>

            <footer className="tag-filter-actions">
              <button
                type="button"
                className="secondary-button"
                onClick={() => {
                  setPendingSelection([]);
                  onSelectedAccountIdsChange([]);
                  setIsFilterOpen(false);
                }}
              >
                Reset
              </button>
              <button
                type="button"
                className="sync-button"
                onClick={() => {
                  onSelectedAccountIdsChange(pendingSelection);
                  setIsFilterOpen(false);
                }}
              >
                Použiť filter
              </button>
            </footer>
          </div>
        </SheetOverlay>
      ) : null}
    </section>
  );
}
