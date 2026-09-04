"use client";

/** Výšky stĺpcov sú fixné, nie náhodné — inak by sa server a prehliadač nezhodli. */
const BAR_HEIGHTS = [46, 68, 54, 82, 60, 74, 50, 66];

/**
 * Zástupný obsah modulu, kým nevieme, či ide o live alebo demo režim.
 *
 * Bez neho sa na sekundu vykreslili demo čísla a hneď ich prepísali skutočné — na
 * obrazovke to preblikávalo sumami, ktoré nikdy neplatili.
 */
export function ModuleSkeleton({ label = "Načítavam prehľad…" }: { label?: string }) {
  return (
    <section className="dashboard-body module-skeleton" aria-busy="true" aria-live="polite">
      <p className="module-skeleton-label">{label}</p>

      <article className="panel">
        <div className="skeleton-line skeleton-line-sm" />
        <div className="skeleton-line skeleton-line-xl" />
        <div className="skeleton-line skeleton-line-sm" />
      </article>

      <article className="panel">
        <div className="skeleton-chart" aria-hidden="true">
          {BAR_HEIGHTS.map((height, index) => (
            <div
              key={index}
              className="skeleton-bar"
              style={{ height: `${height}%`, animationDelay: `${index * 70}ms` }}
            />
          ))}
        </div>
      </article>

      <article className="panel">
        <div className="skeleton-line skeleton-line-md" />
        <div className="skeleton-line" />
        <div className="skeleton-line" />
        <div className="skeleton-line" />
      </article>
    </section>
  );
}
