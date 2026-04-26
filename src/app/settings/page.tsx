"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { KrosConnectionCard } from "@/components/kros-connection-card";
import { clearPendingState, readConnections, readPendingState, savePendingState, writeConnections } from "@/lib/kros-storage";
import type { KrosConnection } from "@/lib/kros-types";
import type { KrosApiLogEntry } from "@/lib/kros-logs";

export default function SettingsPage() {
  const [connections, setConnections] = useState<KrosConnection[]>([]);
  const [pendingState, setPendingState] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState("Pre napojenie klikni na Prepojiť s KROS.");
  const [logs, setLogs] = useState<KrosApiLogEntry[]>([]);
  const [selectedLog, setSelectedLog] = useState<KrosApiLogEntry | null>(null);
  const [companyToDisconnect, setCompanyToDisconnect] = useState<KrosConnection | null>(null);

  useEffect(() => {
    setConnections(readConnections());
    setPendingState(readPendingState());
    void refreshLogs();
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (!params.get("kros_post_result")) {
      return;
    }

    const rawResult = sessionStorage.getItem("kros_post_result");
    if (!rawResult) {
      setStatusMessage("KROS vrátil prázdnu odpoveď pre POST prepojenie.");
      params.delete("kros_post_result");
      window.history.replaceState({}, "", `${window.location.pathname}${params.toString() ? `?${params.toString()}` : ""}`);
      return;
    }

    try {
      const parsed = JSON.parse(rawResult) as {
        state?: string | null;
        companies?: Array<{
          companyId: number;
          companyName: string;
          token: string;
          webhookSecret?: string;
        }>;
      };
      const storedState = readPendingState();
      if (storedState && parsed.state && storedState !== parsed.state) {
        setStatusMessage("Prepojenie odmietnuté: nesedí bezpečnostný parameter state.");
      } else {
        const mappedConnections: KrosConnection[] = Array.isArray(parsed.companies)
          ? parsed.companies
              .filter(
                (company) =>
                  typeof company.companyId === "number" &&
                  typeof company.companyName === "string" &&
                  typeof company.token === "string" &&
                  company.companyName.length > 0 &&
                  company.token.length > 0
              )
              .map((company) => ({
                companyId: company.companyId,
                companyName: company.companyName,
                token: company.token,
                webhookSecret: company.webhookSecret,
                connectedAt: new Date().toISOString()
              }))
          : [];

        setConnections(mappedConnections);
        writeConnections(mappedConnections);
        clearPendingState();
        setPendingState(null);
        setStatusMessage(`Prepojenie hotové: ${mappedConnections.length} firiem.`);
      }
    } catch {
      setStatusMessage("KROS vrátil neplatnú odpoveď pre POST prepojenie.");
    } finally {
      sessionStorage.removeItem("kros_post_result");
      params.delete("kros_post_result");
      window.history.replaceState({}, "", `${window.location.pathname}${params.toString() ? `?${params.toString()}` : ""}`);
    }
  }, []);

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

  const createIntegrationConsentUrl = (state: string) => {
    const consentBase =
      process.env.NEXT_PUBLIC_KROS_CONSENT_BASE_URL ?? "https://firma.kros.sk/integration-consent";
    const appBaseUrl = window.location.origin;
    const params = new URLSearchParams({
      plugin_name: "KrosDashboard",
      integrator_name: "KrosDashboard",
      version: "1",
      response_mode: "post",
      redirect_url: `${appBaseUrl}/kros/callback`,
      state,
      company_mode: "multiple"
    });
    return `${consentBase}?${params.toString()}`;
  };

  const handleConnectClick = () => {
    const state = crypto.randomUUID().replace(/-/g, "");
    savePendingState(state);
    setPendingState(state);
    setStatusMessage("Presmerovávam do KROS prepojenia...");
    window.location.assign(createIntegrationConsentUrl(state));
  };

  const handleDisconnectCompany = (companyId: number) => {
    const company = connections.find((connection) => connection.companyId === companyId);
    if (company) {
      setCompanyToDisconnect(company);
    }
  };

  const confirmDisconnectCompany = () => {
    if (!companyToDisconnect) return;

    const nextConnections = connections.filter(
      (connection) => connection.companyId !== companyToDisconnect.companyId
    );
    setConnections(nextConnections);
    writeConnections(nextConnections);
    setCompanyToDisconnect(null);
    if (nextConnections.length === 0) {
      clearPendingState();
      setPendingState(null);
      setStatusMessage("Prepojenie bolo odpojené.");
      return;
    }

    setStatusMessage(`Firma bola odpojená. Aktívne prepojenia: ${nextConnections.length}.`);
  };

  const handleClearLogs = async () => {
    await fetch("/api/kros/logs", { method: "DELETE" });
    await refreshLogs();
  };

  return (
    <main className="app-shell">
      <header className="app-header">
        <h1>Nastavenia</h1>
        <Link className="secondary-button" href="/">
          Späť na dashboard
        </Link>
      </header>

      <KrosConnectionCard
        connections={connections}
        statusMessage={statusMessage}
        onConnectClick={handleConnectClick}
        onDisconnectCompany={handleDisconnectCompany}
      />

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
    </main>
  );
}
