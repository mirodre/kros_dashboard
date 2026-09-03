"use client";

import { useState } from "react";

import { PREFERENCE_KEY_LIST, isTenantKey, type PreferenceKey } from "@/lib/preferences/registry";
import { usePreferences, preferenceStore } from "@/lib/use-preference";
import { useViewerSub } from "./preferences-boot";

/** Kľúče, ktoré sa dajú zdieľať firme. Zbalenie panelov a granularita medzi ne nepatria. */
const SHAREABLE_KEYS = PREFERENCE_KEY_LIST.filter((key): key is PreferenceKey => isTenantKey(key));

function formatMoment(iso: string): string {
  const value = new Date(iso);
  return Number.isNaN(value.getTime()) ? "" : value.toLocaleString("sk-SK");
}

/**
 * Firemné predvolené filtre. Zdieľanie je VÝSLOVNÁ akcia — bežná zmena filtra sa ukladá len
 * pre mňa. Keby každá zmena prepisovala firemné nastavenie, ľudia by sa filtre naučili
 * nemeniť.
 *
 * Rolu nekontrolujeme (rozhodnutie z 3.9.2026): zdieľať smie ktokoľvek v tenante. Preto je
 * dôležité aspoň ukázať, kto to naposledy urobil.
 */
export function TenantDefaultsCard() {
  const { personalKeys, tenantMeta, isLoaded, isPersonalFallback } = usePreferences();
  const viewerSub = useViewerSub();
  const [status, setStatus] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  // Bez firmy nie je s kým zdieľať — nastavenia si aj tak žijú len pre tohto človeka.
  if (isPersonalFallback) return null;

  const overridden = personalKeys.filter((key) => isTenantKey(key));

  const run = async (action: () => Promise<boolean>, done: string) => {
    setIsBusy(true);
    setStatus(null);
    const ok = await action();
    setIsBusy(false);
    setStatus(ok ? done : "Nepodarilo sa uložiť. Skús to znova.");
  };

  return (
    <section className="dashboard-body">
      <article className="panel">
        <header className="panel-head">
          <h3>Firemné filtre</h3>
          <button
            type="button"
            className="secondary-button"
            disabled={isBusy || !isLoaded}
            onClick={() =>
              run(() => preferenceStore().shareWithTenant(SHAREABLE_KEYS), "Filtre platia pre celú firmu.")
            }
          >
            Nastaviť pre celú firmu
          </button>
        </header>

        <p className="tag-sub">
          Uloží tvoje aktuálne filtre firiem a štítkov ako predvolené pre všetkých vo firme.
          Kto si ich potom zmení, mení len svoje zobrazenie.
        </p>

        {tenantMeta ? (
          <p className="tag-sub">
            Naposledy nastavené:{" "}
            {viewerSub && tenantMeta.updatedBySub === viewerSub ? "tebou" : "iným členom firmy"}
            {formatMoment(tenantMeta.updatedAt) ? ` — ${formatMoment(tenantMeta.updatedAt)}` : ""}.
          </p>
        ) : (
          <p className="tag-sub">Firma zatiaľ nemá vlastné predvolené filtre.</p>
        )}

        {overridden.length > 0 ? (
          <button
            type="button"
            className="secondary-button"
            disabled={isBusy}
            onClick={() => run(() => preferenceStore().resetToTenant(overridden), "Zobrazujú sa firemné filtre.")}
          >
            Vrátiť sa na firemné filtre
          </button>
        ) : null}

        {!isLoaded ? (
          <p className="tag-sub">Nastavenia sa práve nedajú načítať zo servera — platí, čo máš v tomto prehliadači.</p>
        ) : null}

        {status ? <p className="tag-sub">{status}</p> : null}
      </article>
    </section>
  );
}
