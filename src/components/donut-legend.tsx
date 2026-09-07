"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

type Props = {
  ariaLabel: string;
  /** `<li>` karty legendy — obsah si rieši každý modul sám. */
  children: ReactNode;
};

/**
 * Vodorovná legenda donutu. Na mobile sa posúva swipom, na desktope tahom myšou —
 * a keď sa karty nezmestia, ešte aj šípkami: bez nich sa na desktope k štítkom za
 * hranou nedalo dostať, lebo koliesko myši vodorovný kontejner neposúva a scrollbar
 * je skrytý.
 */
export function DonutLegend({ ariaLabel, children }: Props) {
  const listRef = useRef<HTMLUListElement | null>(null);
  const lastDragEndedAtRef = useRef(0);
  const animationRef = useRef<number | null>(null);
  const fallbackRef = useRef<number | null>(null);
  const dragStateRef = useRef<{
    isPointerDown: boolean;
    isDragging: boolean;
    startX: number;
    startScrollLeft: number;
  }>({
    isPointerDown: false,
    isDragging: false,
    startX: 0,
    startScrollLeft: 0
  });
  const [isDragging, setIsDragging] = useState(false);
  const [canScroll, setCanScroll] = useState({ start: false, end: false });
  const lastScrollStateRef = useRef<{ start: boolean; end: boolean } | null>(null);

  const syncScrollState = useCallback(() => {
    const container = listRef.current;
    if (!container) return;
    const maxScrollLeft = container.scrollWidth - container.clientWidth;
    const start = container.scrollLeft > 4;
    const end = maxScrollLeft > 4 && container.scrollLeft < maxScrollLeft - 4;

    // Porovnanie drží ref, nie `setCanScroll(prev => …)`: aj zápis tej istej hodnoty
    // React ešte raz vykreslí, efekt nižšie beží po každom rendere a vzniklo by z toho
    // nekonečné kolo („Maximum update depth exceeded“).
    const previous = lastScrollStateRef.current;
    if (previous && previous.start === start && previous.end === end) return;
    lastScrollStateRef.current = { start, end };
    setCanScroll({ start, end });
  }, []);

  // Zámerne bez zoznamu závislostí: šípky musia zmiznúť aj vtedy, keď sa počet kariet
  // zmení filtrom — teda pri každom rendere, nie len po zmene šírky kontejnera.
  useEffect(() => {
    syncScrollState();
  });

  useEffect(() => {
    const container = listRef.current;
    if (!container) return;
    const observer = new ResizeObserver(syncScrollState);
    observer.observe(container);
    return () => observer.disconnect();
  }, [syncScrollState]);

  useEffect(() => {
    return () => {
      if (animationRef.current !== null) cancelAnimationFrame(animationRef.current);
      if (fallbackRef.current !== null) window.clearTimeout(fallbackRef.current);
    };
  }, []);

  const handlePointerDown = (event: React.PointerEvent<HTMLUListElement>) => {
    const container = listRef.current;
    if (!container) return;
    dragStateRef.current = {
      isPointerDown: true,
      isDragging: false,
      startX: event.clientX,
      startScrollLeft: container.scrollLeft
    };
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLUListElement>) => {
    const container = listRef.current;
    const dragState = dragStateRef.current;
    if (!container || !dragState.isPointerDown) return;
    const deltaX = event.clientX - dragState.startX;
    if (!dragState.isDragging && Math.abs(deltaX) > 6) {
      dragState.isDragging = true;
      setIsDragging(true);
    }
    if (!dragState.isDragging) return;
    container.scrollLeft = dragState.startScrollLeft - deltaX;
  };

  const stopDragging = () => {
    if (dragStateRef.current.isDragging) {
      lastDragEndedAtRef.current = Date.now();
    }
    dragStateRef.current.isPointerDown = false;
    dragStateRef.current.isDragging = false;
    setIsDragging(false);
  };

  const handleClickCapture = (event: React.MouseEvent<HTMLUListElement>) => {
    // Zahodíme len duchový klik hneď po ťahaní, nie normálne kliknutie na kartu.
    if (Date.now() - lastDragEndedAtRef.current > 90) return;
    event.preventDefault();
    event.stopPropagation();
  };

  /**
   * Posun o stranu kariet. Zámerne vlastná animácia, nie `scrollBy({behavior:"smooth"})`:
   * `scroll-snap-type: x mandatory` programové plynulé posunutie zruší (snap stiahne
   * kontejner na pôvodnú kartu) a v niektorých prostrediach sa plynulé posunutie neurobí
   * vôbec. Snap je preto na čas animácie vypnutý a po dojazde sa vráti, aby swipe na
   * mobile ostal snapovaný na karty.
   */
  const scrollByPage = (direction: 1 | -1) => {
    const container = listRef.current;
    if (!container) return;

    const maxScrollLeft = container.scrollWidth - container.clientWidth;
    const from = container.scrollLeft;
    const to = Math.max(0, Math.min(from + direction * Math.max(container.clientWidth * 0.8, 140), maxScrollLeft));
    if (to === from) return;

    if (animationRef.current !== null) cancelAnimationFrame(animationRef.current);

    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (prefersReducedMotion) {
      container.scrollLeft = to;
      syncScrollState();
      return;
    }

    const duration = 260;
    const startedAt = performance.now();
    container.style.scrollSnapType = "none";

    // Keď snímky prestanú chodiť (skrytá karta prehliadača rAF pozastaví), posun dokončíme
    // skokom — inak by legenda ostala v polovici a bez snapu.
    const finish = () => {
      if (animationRef.current !== null) cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
      if (fallbackRef.current !== null) window.clearTimeout(fallbackRef.current);
      fallbackRef.current = null;
      container.scrollLeft = to;
      container.style.scrollSnapType = "";
      syncScrollState();
    };

    if (fallbackRef.current !== null) window.clearTimeout(fallbackRef.current);
    fallbackRef.current = window.setTimeout(finish, duration + 400);

    const step = (now: number) => {
      const progress = Math.min((now - startedAt) / duration, 1);
      const eased = 1 - (1 - progress) ** 3;
      container.scrollLeft = from + (to - from) * eased;

      if (progress < 1) {
        animationRef.current = requestAnimationFrame(step);
        return;
      }

      finish();
    };

    animationRef.current = requestAnimationFrame(step);
  };

  return (
    <div className="cashflow-donut-legend-wrap">
      <ul
        ref={listRef}
        className={isDragging ? "cashflow-donut-legend is-dragging" : "cashflow-donut-legend"}
        aria-label={ariaLabel}
        onScroll={syncScrollState}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={stopDragging}
        onPointerCancel={stopDragging}
        onPointerLeave={stopDragging}
        onClickCapture={handleClickCapture}
      >
        {children}
      </ul>
      {canScroll.start ? (
        <button
          type="button"
          className="cashflow-legend-nav prev"
          onClick={() => scrollByPage(-1)}
          aria-label="Posunúť legendu vľavo"
        >
          <span aria-hidden="true">‹</span>
        </button>
      ) : null}
      {canScroll.end ? (
        <button
          type="button"
          className="cashflow-legend-nav next"
          onClick={() => scrollByPage(1)}
          aria-label="Posunúť legendu vpravo"
        >
          <span aria-hidden="true">›</span>
        </button>
      ) : null}
    </div>
  );
}
