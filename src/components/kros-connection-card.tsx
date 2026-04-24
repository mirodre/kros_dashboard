"use client";

import type { KrosConnection } from "@/lib/kros-types";

const DEFAULT_CONNECTION_HINT = "Pre napojenie klikni na Prepojiť s KROS.";

type Props = {
  connections: KrosConnection[];
  statusMessage: string;
  onConnectClick: () => void;
  onDisconnectCompany: (companyId: number) => void;
};

export function KrosConnectionCard({
  connections,
  statusMessage,
  onConnectClick,
  onDisconnectCompany
}: Props) {
  return (
    <section className="dashboard-body">
      <article className="panel">
        <header className="panel-head">
          <h3>KROS prepojenie</h3>
          <div className="filters-inline">
            <button type="button" className="secondary-button" onClick={onConnectClick}>
              Prepojiť s KROS
            </button>
          </div>
        </header>

        {statusMessage !== DEFAULT_CONNECTION_HINT ? <p className="tag-sub">{statusMessage}</p> : null}

        {connections.length > 0 ? (
          <ul className="tag-list connection-list">
            {connections.map((connection) => (
              <li key={connection.companyId} className="connection-item">
                <div>
                  <p className="tag-name">{connection.companyName}</p>
                  <p className="tag-sub">ID: {connection.companyId}</p>
                </div>
                <div className="tag-values">
                  <p>Aktívne</p>
                  <p className="tag-sub">{new Date(connection.connectedAt).toLocaleString("sk-SK")}</p>
                </div>
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`Odpojiť firmu ${connection.companyName}`}
                  onClick={() => onDisconnectCompany(connection.companyId)}
                >
                  <span aria-hidden="true">✕</span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="tag-sub">Zatiaľ nie je pripojená žiadna firma.</p>
        )}
      </article>
    </section>
  );
}
