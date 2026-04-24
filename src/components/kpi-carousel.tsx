"use client";

import { useState } from "react";
import type { KpiCard } from "@/lib/mock-data";
import { formatCurrency, formatDelta } from "@/lib/format";

type Props = {
  items: KpiCard[];
};

export function KpiCarousel({ items }: Props) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [touchStartX, setTouchStartX] = useState<number | null>(null);

  const handleTouchStart = (event: React.TouchEvent<HTMLElement>) => {
    setTouchStartX(event.touches[0]?.clientX ?? null);
  };

  const handleTouchEnd = (event: React.TouchEvent<HTMLElement>) => {
    if (touchStartX === null) return;
    const touchEndX = event.changedTouches[0]?.clientX ?? touchStartX;
    const delta = touchStartX - touchEndX;

    if (Math.abs(delta) > 45) {
      if (delta > 0) {
        setActiveIndex((prev) => Math.min(prev + 1, items.length - 1));
      } else {
        setActiveIndex((prev) => Math.max(prev - 1, 0));
      }
    }

    setTouchStartX(null);
  };

  return (
    <section className="kpi-stage" aria-label="Kľúčové KPI">
      <div
        className="kpi-carousel"
        style={{ transform: `translateX(-${activeIndex * 100}%)` }}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        {items.map((item) => (
          <article className="kpi-card" key={item.title}>
            <p className="kpi-title">{item.title}</p>
            <p className="kpi-current">{formatCurrency(item.currentValue)}</p>
            <div className="kpi-row">
              <span>vlani {formatCurrency(item.previousValue)}</span>
              <span className={item.deltaPct >= 0 ? "delta up" : "delta down"}>
                {formatDelta(item.deltaPct)}
              </span>
            </div>
          </article>
        ))}
      </div>

      <div className="kpi-dots" aria-label="Stránkovanie KPI">
        {items.map((item, index) => (
          <button
            type="button"
            key={item.title}
            className={index === activeIndex ? "kpi-dot active" : "kpi-dot"}
            onClick={() => setActiveIndex(index)}
            aria-label={`Zobraziť kartu ${index + 1}`}
          />
        ))}
      </div>
    </section>
  );
}
