"use client";

import { useEffect, useState } from "react";
import { DashboardShell } from "@/components/dashboard-shell";
import { KrosConnectionCard } from "@/components/kros-connection-card";
import { TenantDefaultsCard } from "@/components/tenant-defaults-card";
import { clearLocalDataCacheKeys } from "@/lib/cache-clear";
import { clearCashflowCache } from "@/lib/cashflow-cache";
import { clearExpenseCache } from "@/lib/expense-cache";
import { clearInvoiceCache } from "@/lib/invoice-cache";
import { startKrosConnect } from "@/lib/kros-connect";
import { useKrosConnections } from "@/lib/use-kros-connections";
import type { KrosConnection } from "@/lib/kros-types";
import type { KrosApiLogEntry } from "@/lib/kros-logs";



export default function SettingsPage() {
  const { connections, isLoading: isLoadingConnections, error: connectionsError, refresh, disconnect } =
    useKrosConnections();
  const [statusMessage, setStatusMessage] = useState("Pre napojenie klikni na Prepojiť s KROS.");
  const [logs, setLogs] = useState<KrosApiLogEntry[]>([]);
  const [selectedLog, setSelectedLog] = useState<KrosApiLogEntry | null>(null);
  const [companyToDisconnect, setCompanyToDisconnect] = useState<KrosConnection | null>(null);
  const [isCacheClearOpen, setIsCacheClearOpen] = useState(false);

  useEffect(() => {
    void refreshLogs();
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const result = params.get("kros_post_result");
    if (!result) return;

    // Prepojenie zapísal `/kros/callback` rovno do databázy — prehliadač už žiadny zoznam
    // firiem ani token nedostáva, len správu, ako to dopadlo.
    setStatusMessage(
      result === "error"
        ? "Prepojenie sa nepodarilo dokončiť. Skús to znova."
        : "Prepojenie hotové. Firmy vidia všetci vo firme."
    );
    void refresh();

    params.delete("kros_post_result");
    window.history.replaceState({}, "", `${window.location.pathname}${params.toString() ? `?${params.toString()}` : ""}`);
  }, [refresh]);

  const refreshLogs = async () => {
    const response = await fetch("/api/kros/logs");
    const payload = await response.json();
    const raw = Array.isArray(payload?.data) ? payload.data : [];
    setLogs(
      [...raw].sort(
        (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      )
    );
  };

  const handleConnectClick = async () => {
    await startKrosConnect({ onStatus: setStatusMessage });
  };

  const handleDisconnectCompany = (companyId: number) => {
    const company = connections.find((connection) => connection.companyId === companyId);
    if (company) {
      setCompanyToDisconnect(company);
    }
  };

  const confirmDisconnectCompany = async () => {
    if (!companyToDisconnect) return;

    const company = companyToDisconnect;
    setCompanyToDisconnect(null);

    // Odpojenie platí pre celú firmu, nielen pre toto zariadenie — preto to potvrdzovací
    // dialóg hovorí a preto sa výsledok načíta zo servera, nie z lokálneho stavu.
    const ok = await disconnect(company.companyId);
    setStatusMessage(
      ok
        ? `Firma ${company.companyName} bola odpojená pre všetkých vo firme.`
        : "Odpojenie sa nepodarilo. Skús to znova."
    );
  };

  const handleClearLogs = async () => {
    await fetch("/api/kros/logs", { method: "DELETE" });
    await refreshLogs();
  };

  const handleClearInvoiceCache = async () => {
    await clearInvoiceCache();
    await clearCashflowCache();
    await clearExpenseCache();
    // Zoznam mazaných kľúčov je v `src/lib/cache-clear.ts` a stráži ho test: filtre sa tu
    // mazať nesmú, hoci ležia v tom istom `localStorage` ako stav synchronizácie.
    clearLocalDataCacheKeys(localStorage);
    setIsCacheClearOpen(false);
    setStatusMessage(
      "Lokálna cache faktúr (Príjmy), dokladov (Výdavky) a platieb (Financie) bola vymazaná. Prehľady sa pri ďalšom otvorení načítajú odznova."
    );
  };

  return (
    <DashboardShell title="Nastavenia">
      <TenantDefaultsCard />

      <KrosConnectionCard
        connections={connections}
        statusMessage={connectionsError ?? (isLoadingConnections ? "Načítavam prepojenia..." : statusMessage)}
        onConnectClick={handleConnectClick}
        onDisconnectCompany={handleDisconnectCompany}
      />

      <section className="dashboard-body">
        <article className="panel">
          <header className="panel-head">
            <h3>Lokálna cache</h3>
            <button type="button" className="danger-button" onClick={() => setIsCacheClearOpen(true)}>
              Vymazať cache dát
            </button>
          </header>
          <p className="tag-sub">
            Vymaže lokálne uložené faktúry, výdavkové doklady, stav synchronizácie a dočasnú cache platobného prehľadu
            (Financie) v tomto prehliadači. Prepojenie na KROS zostane zachované.
          </p>
        </article>
      </section>

      <section className="dashboard-body">
        <article className="panel">
          <header className="panel-head">
            <h3>Záznamy API</h3>
            <div className="filters-inline">
              <button type="button" className="secondary-button" onClick={handleClearLogs}>
                Vymazať záznamy
              </button>
            </div>
          </header>

          {logs.length === 0 ? (
            <p className="tag-sub">Zatiaľ nie sú dostupné žiadne záznamy API komunikácie.</p>
          ) : (
            <ul className="tag-list">
              {logs.map((log) => (
                <li key={log.id}>
                  <div>
                    <p className="tag-name">
                      [{log.direction.toUpperCase()}] {log.method} {log.endpoint}
                    </p>
                    <p className="tag-sub">
                      {new Date(log.timestamp).toLocaleString("sk-SK")}
                      {log.companyName ? ` • Firma: ${log.companyName}` : ""}
                      {typeof log.status === "number" ? ` • HTTP ${log.status}` : ""}
                    </p>
                  </div>
                  <div className="tag-values">
                    <p className="log-message">{log.message ?? "-"}</p>
                    <button type="button" className="secondary-button" onClick={() => setSelectedLog(log)}>
                      Detail
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </article>
      </section>

      {selectedLog ? (
        <div className="tag-filter-overlay" onClick={() => setSelectedLog(null)} role="presentation">
          <div
            className="tag-filter-sheet"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Detail záznamu"
          >
            <header className="tag-filter-head">
              <h4>Detail záznamu</h4>
              <button type="button" className="filter-close" onClick={() => setSelectedLog(null)}>
                Zavrieť
              </button>
            </header>
            <p className="tag-sub">
              {new Date(selectedLog.timestamp).toLocaleString("sk-SK")} • {selectedLog.method}{" "}
              {selectedLog.endpoint}
            </p>
            <pre className="log-detail-pre">
              {JSON.stringify(
                {
                  direction: selectedLog.direction,
                  status: selectedLog.status,
                  companyName: selectedLog.companyName,
                  message: selectedLog.message,
                  payload: selectedLog.payload ?? null
                },
                null,
                2
              )}
            </pre>
          </div>
        </div>
      ) : null}

      {companyToDisconnect ? (
        <div className="tag-filter-overlay" onClick={() => setCompanyToDisconnect(null)} role="presentation">
          <div
            className="confirm-sheet"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Potvrdenie odpojenia firmy"
          >
            <h4>Zrušiť prepojenie?</h4>
            <p className="tag-sub">
              Naozaj chceš zrušiť prepojenie firmy <strong>{companyToDisconnect.companyName}</strong>?
              Odpojíš ju <strong>všetkým vo firme</strong> a späť sa dá len novým súhlasom v KROS.
            </p>
            <div className="tag-filter-actions">
              <button type="button" className="secondary-button" onClick={() => setCompanyToDisconnect(null)}>
                Nie, ponechať
              </button>
              <button type="button" className="danger-button" onClick={confirmDisconnectCompany}>
                Áno, odpojiť
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {isCacheClearOpen ? (
        <div className="tag-filter-overlay" onClick={() => setIsCacheClearOpen(false)} role="presentation">
          <div
            className="confirm-sheet"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Potvrdenie vymazania lokálnej cache"
          >
            <h4>Vymazať lokálnu cache?</h4>
            <p className="tag-sub">
              Vymažú sa lokálne uložené faktúry, stav synchronizácie a cache platobných údajov pre prehľad Financie. Pri
              ďalšom otvorení prehľadov sa dáta natiahnu odznova z KROS.
            </p>
            <div className="tag-filter-actions">
              <button type="button" className="secondary-button" onClick={() => setIsCacheClearOpen(false)}>
                Nie, ponechať
              </button>
              <button type="button" className="danger-button" onClick={handleClearInvoiceCache}>
                Áno, vymazať cache
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </DashboardShell>
  );
}
