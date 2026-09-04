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
      <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
        <path
          d="M3.4 4.6h13.2a.75.75 0 0 1 .58 1.23l-4.83 5.79v4.03a.75.75 0 0 1-1.12.65l-2.6-1.5a.75.75 0 0 1-.37-.65v-2.53L2.82 5.83A.75.75 0 0 1 3.4 4.6z"
          fill="currentColor"
        />
      </svg>
      {isActive ? <span className="filter-icon-badge">{activeCount}</span> : null}
    </button>
  );
}
