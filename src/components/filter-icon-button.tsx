"use client";

type Props = {
  /** Text pre čítačku obrazovky aj tooltip — napr. „Filter štítkov“. */
  label: string;
  /** Počet zvolených položiek; 0 = filter je vypnutý a bublinka sa nekreslí. */
  activeCount?: number;
  onClick: () => void;
};

/**
 * Filter v hlavičke sekcie ako ikona s bublinkou počtu. Textové tlačidlo („Filter
 * štítkov (5)“) bralo v hlavičke priveľa miesta a pri každej sekcii ťahalo oko na seba.
 */
export function FilterIconButton({ label, activeCount = 0, onClick }: Props) {
  const isActive = activeCount > 0;
  const title = isActive ? `${label} (${activeCount})` : label;

  return (
    <button
      type="button"
      className={isActive ? "filter-icon-button is-active" : "filter-icon-button"}
      onClick={onClick}
      aria-label={title}
      title={title}
    >
      {/* Nevyplnený lievik: filter je pomocná akcia, nemá v hlavičke ťahať oko na seba.
          lucide/funnel — pozri app-nav.tsx, ikony berieme z Lucide. */}
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
        <path
          d="M10 20a1 1 0 0 0 .553.895l2 1A1 1 0 0 0 14 21v-7a2 2 0 0 1 .517-1.341L21.74 4.67A1 1 0 0 0 21 3H3a1 1 0 0 0-.742 1.67l7.225 7.989A2 2 0 0 1 10 14z"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      {isActive ? <span className="filter-icon-badge">{activeCount}</span> : null}
    </button>
  );
}
