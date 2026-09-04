"use client";

import { useEffect, useState } from "react";
import { signOutAction } from "@/app/actions/sign-out";
import { DashboardShell } from "@/components/dashboard-shell";
import { KrosConnectionCard } from "@/components/kros-connection-card";
import { SheetOverlay } from "@/components/sheet-overlay";
import { TenantDefaultsCard } from "@/components/tenant-defaults-card";
import { clearLocalDataCacheKeys } from "@/lib/cache-clear";
import { clearCashflowCache } from "@/lib/cashflow-cache";
import { clearExpenseCache } from "@/lib/expense-cache";
import { clearInvoiceCache } from "@/lib/invoice-cache";
import { startKrosConnect } from "@/lib/kros-connect";
import { useKrosConnections } from "@/lib/use-kros-connections";
import type { KrosConnection } from "@/lib/kros-types";

/** Dôvody, s ktorými sa `/kros/callback` vracia, preložené do vety pre človeka. */
function connectErrorMessage(reason: string | null): string {
  if (reason === "state") return "Prepojenie vypršalo alebo bolo prerušené. Skús to prosím znova.";
  if (reason === "empty") return "KROS nevrátil žiadnu firmu — v súhlase treba vybrať aspoň jednu.";
  if (reason === "db") return "Server nemá pripojenú databázu, prepojenie sa nemá kam uložiť.";
  if (reason === "save") return "Prepojenie sa nepodarilo uložiť. Podrobnosť je v zázname servera.";
  return "Prepojenie sa nepodarilo dokončiť. Skús to znova.";
}

export default function SettingsPage() {
  const { connections, isLoading: isLoadingConnections, error: connectionsError, refresh, disconnect } =
    useKrosConnections();
  const [statusMessage, setStatusMessage] = useState("Pre napojenie klikni na Prepojiť s KROS.");
  const [companyToDisconnect, setCompanyToDisconnect] = useState<KrosConnection | null>(null);
  const [isCacheClearOpen, setIsCacheClearOpen] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const result = params.get("kros_post_result");
    if (!result) return;

    // Prepojenie zapísal `/kros/callback` rovno do databázy — prehliadač už žiadny zoznam
    // firiem ani token nedostáva, len správu, ako to dopadlo. Dôvod zlyhania nesie URL,
    // aby sa nemusel hľadať v logu servera.
    setStatusMessage(result === "error" ? connectErrorMessage(params.get("reason")) : "Prepojenie hotové. Firmy vidia všetci vo firme.");
    void refresh();

    params.delete("kros_post_result");
    params.delete("reason");
    window.history.replaceState({}, "", `${window.location.pathname}${params.toString() ? `?${params.toString()}` : ""}`);
  }, [refresh]);

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
        <SheetOverlay onClose={() => setCompanyToDisconnect(null)}>
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
        </SheetOverlay>
      ) : null}

      {isCacheClearOpen ? (
        <SheetOverlay onClose={() => setIsCacheClearOpen(false)}>
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
        </SheetOverlay>
      ) : null}
    </DashboardShell>
  );
}
