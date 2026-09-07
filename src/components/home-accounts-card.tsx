"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AccountsDonut } from "@/components/accounts-donut";
import { FilterIconButton } from "@/components/filter-icon-button";
import { SheetOverlay } from "@/components/sheet-overlay";
import type { CashflowAccountPoint } from "@/lib/cashflow-live";

type Props = {
  /** VŠETKY dostupné účty, nie už vyfiltrované — filter potrebuje z čoho ponúkať. */
  accounts: CashflowAccountPoint[];
  /** Id vybraných účtov. Prázdny výber = všetky. */
  selectedAccountIds: string[];
  onSelectedAccountIdsChange: (ids: string[]) => void;
  /** Je aktívny focus stĺpca z grafu Zisku? Karta ho ignoruje a musí to priznať. */
  isPeriodFocused: boolean;
};

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

  // Zameraný účet z koláča. Stav drží karta, nie graf — po zmene filtra účtov sa musí
  // zahodiť, inak by v strede ostal účet, ktorý už v grafe nie je.
  const [activeAccountId, setActiveAccountId] = useState<string | "all">("all");
  const visibleKey = visible.map((account) => account.id).join("|");
  useEffect(() => {
    setActiveAccountId("all");
  }, [visibleKey]);

  // Súčet aj počet účtov ukazuje koláč v strede — meta veta preto rieši len to, čo
  // z grafu nie je vidieť: zúžený filter a to, že karta ignoruje fokus obdobia.
  const metaNote = [
    selectedAccountIds.length > 0 && !filterMissedAll
      ? `Vybrané ${visible.length} z ${accounts.length} ${accountsWordGenitive(accounts.length)}`
      : null,
    isPeriodFocused ? "k dnešku, nezávisle od vybraného obdobia" : null
  ]
    .filter(Boolean)
    .join(" · ");

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

        {metaNote ? <p className="profit-headline-meta">{metaNote}</p> : null}

        {filterMissedAll ? (
          <p className="tag-filter-help">
            Vybrané účty tu nie sú — zobrazujeme všetky. Uprav filter alebo ho zruš.
          </p>
        ) : null}

        {accounts.length === 0 ? (
          <p className="tag-filter-help">Zatiaľ nemáme žiadne účty.</p>
        ) : (
          <AccountsDonut
            accounts={visible}
            activeAccountId={activeAccountId}
            onActiveAccountChange={setActiveAccountId}
            showTrend={false}
            donutAriaLabel="Rozdelenie zostatkov na účtoch"
            legendAriaLabel="Zostatky na účtoch"
          />
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
