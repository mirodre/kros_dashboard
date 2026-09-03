"use client";

import Link from "next/link";

/**
 * Uložený filter obsahuje firmy, ktoré tu nie sú prepojené. Odkedy filtre nasledujú človeka
 * na iné zariadenie, je to bežný stav — a bez tejto hlášky vyzerá ako prázdny prehľad, teda
 * ako keby firma nemala tržby.
 */
export function FilterMismatchNotice({ onShowAll }: { onShowAll: () => void }) {
  return (
    <section className="dashboard-body">
      <article className="panel" role="status" aria-live="polite">
        <header className="panel-head">
          <h3>Filter sem nesedí</h3>
          <button type="button" className="secondary-button" onClick={onShowAll}>
            Zobraziť všetky
          </button>
        </header>
        <p className="tag-sub">
          Uložený filter obsahuje firmy, ktoré na tomto zariadení nie sú prepojené s KROS.
          Prepoj ich v <Link href="/settings">Nastaveniach</Link>, alebo zobraz všetky dostupné firmy.
        </p>
      </article>
    </section>
  );
}
