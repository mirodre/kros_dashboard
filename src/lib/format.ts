export function formatCurrency(value: number): string {
  return new Intl.NumberFormat("sk-SK", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0
  }).format(value);
}

export function formatCurrencyPrecise(value: number): string {
  return new Intl.NumberFormat("sk-SK", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(value);
}

export function formatDelta(value: number): string {
  if (!Number.isFinite(value)) return "";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(1)} %`;
}

/** Percentuálna zmena; `null` ak nie je minulo-ročné porovnanie (delenie nulou). */
export function getDeltaPct(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}
