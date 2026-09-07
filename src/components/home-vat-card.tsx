"use client";

import type { VatEstimate, VatMonthEstimate } from "@/lib/home-live";
import { formatCurrencyPrecise } from "@/lib/format";
import { formatMonthKeyLabel } from "@/lib/use-sync-progress";
import { usePersistedCollapsed } from "@/lib/use-persisted-collapsed";

type Props = {
  estimate: VatEstimate;
  /** Je aktívny focus stĺpca? Karta ho ignoruje a musí to priznať. */
  isPeriodFocused: boolean;
};

function VatMonth({ title, month }: { title: string; month: VatMonthEstimate }) {
  return (
    <div className="vat-month">
      <span className="profit-kpi-label">
        {title} · {formatMonthKeyLabel(month.monthKey)}
      </span>
      {month.amount === null ? (
        // Nula by tvrdila, že firma nemá čo odviesť. To je iná veta než „nevieme".
        <p className="tag-filter-help">Údaj z KROS nedostupný — doklady nenesú sumu DPH.</p>
      ) : (
        <strong>{formatCurrencyPrecise(month.amount)}</strong>
      )}
    </div>
  );
}

export function HomeVatCard({ estimate, isPeriodFocused }: Props) {
  const [collapsed, setCollapsed] = usePersistedCollapsed("ui.collapsed.homeVat");

  return (
    <section className="dashboard-body">
      <article className={`panel${collapsed ? " panel-collapsed" : ""}`}>
        <header className="panel-head">
          <button
            type="button"
            className="panel-collapse-toggle"
            onClick={() => setCollapsed(!collapsed)}
            aria-expanded={!collapsed}
            aria-label={collapsed ? "Rozbaliť Odhad DPH" : "Zbaliť Odhad DPH"}
          >
            <span className={`panel-collapse-chevron${collapsed ? " collapsed" : ""}`} aria-hidden="true">
              ▾
            </span>
            <h3>Predpokladaný odhad DPH</h3>
          </button>
        </header>

        {collapsed ? null : (
          <>
            <VatMonth title="Minulý mesiac" month={estimate.previousMonth} />
            <VatMonth title="Tento mesiac" month={estimate.currentMonth} />
            {/*
              Stav podania appka nevie a vymyslený odznak „Neuhradené / Prebieha"
              pri sume dane by bol horší než žiadny. Namiesto neho veta, ktorá
              povie presne, čo to číslo je a čo nie je.
            */}
            <p className="tag-filter-help">
              Predpokladaná DPH vypočítaná z dokladov v systéme, vždy za kalendárne mesiace.
              Skutočnú sumu potvrdí účtovníčka po spracovaní.
              {isPeriodFocused ? " Vybrané obdobie z grafu sa sem neprenáša." : ""}
            </p>
          </>
        )}
      </article>
    </section>
  );
}
