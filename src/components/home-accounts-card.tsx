"use client";

import Link from "next/link";
import { DonutLegend } from "@/components/donut-legend";
import type { CashflowAccountPoint } from "@/lib/cashflow-live";
import { formatCurrency } from "@/lib/format";
import { usePersistedCollapsed } from "@/lib/use-persisted-collapsed";

type Props = {
  accounts: CashflowAccountPoint[];
  /** Je aktívny focus stĺpca z grafu Zisku? Karta ho ignoruje a musí to priznať. */
  isPeriodFocused: boolean;
};

/** Farby výsekov — rovnaké poradie ako v legende, aby sa dali spárovať očami. */
const SLICE_COLORS = ["#7b99ff", "#f6b73c", "#34d399", "#a78bfa", "#f472b6", "#38bdf8", "#fb923c"];

/** „1 účet", „2/3/4 účty", „0" aj „5+ účtov" — nula ide s väčšinovým tvarom, nie so vzorom pre 2–4. */
function accountsWord(count: number) {
  if (count === 1) return "účet";
  if (count >= 2 && count <= 4) return "účty";
  return "účtov";
}

export function HomeAccountsCard({ accounts, isPeriodFocused }: Props) {
  const [collapsed, setCollapsed] = usePersistedCollapsed("ui.collapsed.homeAccounts");

  // Headline je pravdivý súčet vrátane záporných zostatkov — prečerpaný účet sa
  // do neho počíta. Do donutu idú len kladné zostatky: záporný výsek sa nedá
  // nakresliť a tiché orezanie na nulu by zväčšilo podiel ostatných účtov na
  // koláči. Headline a donut sa preto v takom prípade zámerne rozchádzajú —
  // to je správanie, nie chyba.
  const total = accounts.reduce((sum, account) => sum + account.amount, 0);
  const positive = accounts.filter((account) => account.amount > 0);
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

  return (
    <section className="dashboard-body">
      <article className={`panel${collapsed ? " panel-collapsed" : ""}`}>
        <header className="panel-head">
          <button
            type="button"
            className="panel-collapse-toggle"
            onClick={() => setCollapsed(!collapsed)}
            aria-expanded={!collapsed}
            aria-label={collapsed ? "Rozbaliť Peniaze na účtoch" : "Zbaliť Peniaze na účtoch"}
          >
            <span className={`panel-collapse-chevron${collapsed ? " collapsed" : ""}`} aria-hidden="true">
              ▾
            </span>
            <h3>Peniaze na účtoch</h3>
          </button>
        </header>

        {collapsed ? null : (
          <>
            <p className="profit-headline">{formatCurrency(total)}</p>
            <p className="profit-headline-meta">
              Celkovo {accounts.length} {accountsWord(accounts.length)}
              {isPeriodFocused ? " · k dnešku, nezávisle od vybraného obdobia" : ""}
            </p>

            {accounts.length === 0 ? (
              <p className="tag-filter-help">Zatiaľ nemáme žiadne účty.</p>
            ) : (
              <>
                {positive.length > 0 ? (
                  <div
                    className="home-donut"
                    style={{ background: `conic-gradient(${stops.join(", ")})` }}
                    role="img"
                    aria-label={`Rozdelenie zostatkov na ${positive.length} účtoch`}
                  />
                ) : null}
                <DonutLegend ariaLabel="Zostatky na účtoch">
                  {accounts.map((account) => {
                    // Prečerpaný účet nemá výsek — dostane tlmenú sivú namiesto farby z donutu.
                    const accent = colorByAccountId.get(account.id) ?? "#5b6478";
                    return (
                      <li key={account.id}>
                        <div
                          className="cashflow-legend-item"
                          style={{ "--legend-accent": accent, cursor: "default" } as React.CSSProperties}
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
          </>
        )}
      </article>
    </section>
  );
}
