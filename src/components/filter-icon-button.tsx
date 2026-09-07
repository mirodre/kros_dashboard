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
      {/* Nevyplnený lievik: filter je pomocná akcia, nemá v hlavičke ťahať oko na seba. */}
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
        <path
          d="M4 5.5h16l-6.4 7.6v5.2l-3.2-1.8v-3.4L4 5.5z"
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
