"use client";

import { DashboardShell } from "@/components/dashboard-shell";

/**
 * Domov — výcuc z ostatných modulov. Zámerne nemá vlastné sťahovanie navyše:
 * číta tie isté enginy ako moduly, takže `syncMeta` v IndexedDB vylučuje, aby
 * čokoľvek stiahol druhýkrát. Sekcie dopĺňajú ďalšie úlohy plánu.
 */
export default function HomePage() {
  return (
    <DashboardShell title="Domov">
      <section className="dashboard-body">
        <article className="panel">
          <p className="tag-filter-help">Domov sa práve stavia.</p>
        </article>
      </section>
    </DashboardShell>
  );
}
