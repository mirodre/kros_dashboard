import type { Granularity } from "@/lib/mock-data";

type Props = {
  value: Granularity;
  onChange: (value: Granularity) => void;
};

const options: { id: Granularity; label: string }[] = [
  { id: "week", label: "Týždeň" },
  { id: "month", label: "Mesiac" },
  { id: "year", label: "Rok" }
];

export function GranularityToggle({ value, onChange }: Props) {
  return (
    <div className="granularity-toggle" role="group" aria-label="Granularita">
      {options.map((option) => (
        <button
          type="button"
          key={option.id}
          className={value === option.id ? "toggle active" : "toggle"}
          onClick={() => onChange(option.id)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
