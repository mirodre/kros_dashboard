"use client";

import { useState } from "react";
import { startKrosConnect } from "@/lib/kros-connect";

export function DemoDataBanner() {
  const [isConnecting, setIsConnecting] = useState(false);

  const handleConnect = async () => {
    setIsConnecting(true);
    const started = await startKrosConnect();
    if (!started) {
      setIsConnecting(false);
    }
  };

  return (
    <section className="dashboard-body">
      <article className="demo-banner" role="status" aria-live="polite">
        <span className="demo-banner-badge">Demo</span>
        <div className="demo-banner-text">
          <p className="demo-banner-title">Zobrazujú sa ukážkové dáta</p>
          <p className="demo-banner-sub">
            Aplikácia nie je prepojená so živým KROS API. Prepoj ju a uvidíš reálne čísla svojej firmy.
          </p>
        </div>
        <button
          type="button"
          className="demo-banner-cta"
          onClick={handleConnect}
          disabled={isConnecting}
        >
          {isConnecting ? "Pripájam..." : "Prepojiť so živým KROS API"}
        </button>
      </article>
    </section>
  );
}
