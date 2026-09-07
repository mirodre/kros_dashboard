"use client";

import { useEffect, useLayoutEffect, useState, type RefObject } from "react";

const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/** Minimálna medzera medzi bublinou s číslami a okrajom viditeľnej plochy grafu. */
const EDGE_GAP = 8;

type Options = {
  /** Neposúvateľný obal grafu — voči nemu sa bublina polohuje. */
  wrapRef: RefObject<HTMLElement | null>;
  /** Posúvateľný kontajner so stĺpcami. */
  scrollRef: RefObject<HTMLElement | null>;
  /** Samotná bublina; jej šírku treba odmerať, inak ju nevieme orezať na okraje. */
  tooltipRef: RefObject<HTMLElement | null>;
  /** CSS selektor jedného stĺpca vnútri `scrollRef` (v poradí, v akom sú vykreslené). */
  columnSelector: string;
  /** Poradie stĺpca, nad ktorým má bublina stáť; záporné = žiadna bublina. */
  activeIndex: number;
  /** Zmena tohto kľúča prepočíta polohu aj vtedy, keď index ostal rovnaký (iné dáta, iná granularita, …). */
  resetKey: string;
};

/**
 * Vodorovná poloha bubliny s číslami v pixeloch od ľavého okraja obalu grafu;
 * `null` znamená „ešte nemeraná“ — vtedy ju netreba ukazovať, preblikla by z odhadnutého
 * miesta na správne.
 *
 * Bublina NESMIE žiť vnútri posúvateľného kontajnera grafu. Ten kvôli `overflow-x: auto`
 * oreže aj zvislo (CSS spec: `overflow-y: visible` sa vedľa posúvateľnej osi počíta ako
 * `auto`), takže jej vrch mizne nad hranou grafu, a pri posunutom grafe ju oreže aj bočná
 * hrana viditeľnej plochy. Preto patrí do neposúvateľného obalu a `left` sa dopočíta tu:
 * stred aktívneho stĺpca, orezaný na okraje viditeľnej plochy, takže sa zmestí celá aj
 * nad krajným stĺpcom.
 *
 * Poloha sa prepočítava pri posune grafu aj pri zmene jeho šírky — okraje, na ktoré
 * bublinu orezávame, sú okraje VIDITEĽNEJ plochy, nie celého (aj posunutého) obsahu.
 */
export function useChartTooltipLeft({
  wrapRef,
  scrollRef,
  tooltipRef,
  columnSelector,
  activeIndex,
  resetKey
}: Options) {
  const [left, setLeft] = useState<number | null>(null);

  useIsomorphicLayoutEffect(() => {
    if (activeIndex < 0) {
      setLeft(null);
      return;
    }

    const wrap = wrapRef.current;
    const scroll = scrollRef.current;
    if (!wrap || !scroll) return;

    const place = () => {
      const tooltip = tooltipRef.current;
      const column = scroll.querySelectorAll<HTMLElement>(columnSelector)[activeIndex];
      if (!tooltip || !column) return;

      const wrapBox = wrap.getBoundingClientRect();
      const columnBox = column.getBoundingClientRect();
      const halfWidth = tooltip.offsetWidth / 2;
      const center = columnBox.left + columnBox.width / 2 - wrapBox.left;
      const minLeft = EDGE_GAP + halfWidth;
      const maxLeft = wrapBox.width - EDGE_GAP - halfWidth;
      // Užší graf než bublina sa orezaniu vyhnúť nedá — vtedy ju dáme aspoň na stred.
      setLeft(maxLeft < minLeft ? wrapBox.width / 2 : Math.min(Math.max(center, minLeft), maxLeft));
    };

    place();

    scroll.addEventListener("scroll", place, { passive: true });
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(place);
    observer?.observe(wrap);

    return () => {
      scroll.removeEventListener("scroll", place);
      observer?.disconnect();
    };
  }, [activeIndex, columnSelector, resetKey, scrollRef, tooltipRef, wrapRef]);

  return left;
}

/**
 * Inline štýl bubliny: kým nepoznáme nameranú polohu, ostáva skrytá na strede.
 * Držíme to na jednom mieste, nech sa grafy nerozídu v tom, čo robia pred prvým meraním.
 */
export function chartTooltipStyle(left: number | null) {
  return {
    left: left === null ? "50%" : `${left}px`,
    visibility: left === null ? ("hidden" as const) : undefined
  };
}
