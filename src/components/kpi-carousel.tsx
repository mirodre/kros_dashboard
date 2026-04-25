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
  const [touchStartY, setTouchStartY] = useState<number | null>(null);

  const handleTouchStart = (event: React.TouchEvent<HTMLElement>) => {
    setTouchStartX(event.touches[0]?.clientX ?? null);
    setTouchStartY(event.touches[0]?.clientY ?? null);
  };

  const handleTouchMove = (event: React.TouchEvent<HTMLElement>) => {
    if (touchStartX === null || touchStartY === null) return;

    const touch = event.touches[0];
    if (!touch) return;

    const deltaX = Math.abs(touchStartX - touch.clientX);
    const deltaY = Math.abs(touchStartY - touch.clientY);
    if (deltaX > deltaY && deltaX > 8) {
      event.preventDefault();
    }
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
    setTouchStartY(null);
  };

  return (
    <section className="kpi-stage" aria-label="Kľúčové KPI">
      <div
        className="kpi-carousel"
        style={{ transform: `translateX(-${activeIndex * 100}%)` }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
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
