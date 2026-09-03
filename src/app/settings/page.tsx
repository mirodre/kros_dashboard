"use client";

import { useEffect, useState } from "react";
import { signOutAction } from "@/app/actions/sign-out";
import { DashboardShell } from "@/components/dashboard-shell";
import { KrosConnectionCard } from "@/components/kros-connection-card";
import { clearCashflowCache } from "@/lib/cashflow-cache";
import { clearExpenseCache } from "@/lib/expense-cache";
import { clearInvoiceCache } from "@/lib/invoice-cache";
import { clearPendingState, readConnections, readPendingState, writeConnections } from "@/lib/kros-storage";
import { startKrosConnect } from "@/lib/kros-connect";
import type { KrosConnection } from "@/lib/kros-types";

const LAST_SYNC_STORAGE_KEY = "kros_dashboard_last_sync_at";

export default function SettingsPage() {
  const [connections, setConnections] = useState<KrosConnection[]>([]);
  const [, setPendingState] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState("Pre napojenie klikni na Prepojiť s KROS.");
  const [companyToDisconnect, setCompanyToDisconnect] = useState<KrosConnection | null>(null);
  const [isCacheClearOpen, setIsCacheClearOpen] = useState(false);

  useEffect(() => {
    setConnections(readConnections());
    setPendingState(readPendingState());
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

  const handleConnectClick = async () => {
    await startKrosConnect({
      onStatus: (message) => {
        setStatusMessage(message);
        setPendingState(readPendingState());
      }
    });
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

  const handleClearInvoiceCache = async () => {
    await clearInvoiceCache();
    await clearCashflowCache();
    await clearExpenseCache();
    localStorage.removeItem(LAST_SYNC_STORAGE_KEY);
    setIsCacheClearOpen(false);
    setStatusMessage(
      "Lokálna cache faktúr (Príjmy), dokladov (Výdavky) a platieb (Financie) bola vymazaná. Prehľady sa pri ďalšom otvorení načítajú odznova."
    );
  };

  return (
    <DashboardShell title="Nastavenia">
      <KrosConnectionCard
        connections={connections}
        statusMessage={statusMessage}
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

      <section className="dashboard-body mobile-only-settings">
        <article className="panel">
          <header className="panel-head">
            <h3>Účet</h3>
            <form action={signOutAction}>
              <button type="submit" className="danger-button">
                Odhlásiť sa
              </button>
            </form>
          </header>
          <p className="tag-sub">
            Odhlási ťa z prehľadov aj z prihlasovacej služby KROS na tomto zariadení. Lokálne uložené dáta v prehliadači
            zostanú, prihlásiť sa môžeš kedykoľvek znova.
          </p>
        </article>
      </section>

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
