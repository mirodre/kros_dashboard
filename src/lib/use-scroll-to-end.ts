"use client";

import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";

const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/**
 * Ak sa obsah kontajnera nezmestí na šírku, nascrolluje ho úplne vpravo —
 * najnovšie obdobia sú tak viditeľné hneď po otvorení, bez ručného scrollovania.
 * `resetKey` opätovne spustí doskrolovanie pri zmene dát (granularita, počet stĺpcov, …).
 */
export function useScrollToEnd<T extends HTMLElement>(ref: RefObject<T | null>, resetKey: string) {
  const userScrolledRef = useRef(false);

  useIsomorphicLayoutEffect(() => {
    userScrolledRef.current = false;
  }, [resetKey]);

  useIsomorphicLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;

    const scrollToEnd = () => {
      const maxScrollLeft = node.scrollWidth - node.clientWidth;
      if (maxScrollLeft <= 0) return;
      node.scrollLeft = maxScrollLeft;
    };

    scrollToEnd();
    // Stĺpce sa dorenderujú s animáciou, takže finálnu šírku poznáme až po prvom frame.
    const frame = window.requestAnimationFrame(scrollToEnd);

    const markUserScrolled = () => {
      userScrolledRef.current = true;
    };
    const interactionEvents = ["pointerdown", "wheel", "touchstart", "keydown"] as const;
    interactionEvents.forEach((eventName) =>
      node.addEventListener(eventName, markUserScrolled, { passive: true })
    );

    // Kým používateľ sám neposunul graf, držíme ho na pravom okraji aj pri zmene rozmerov.
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(() => {
            if (userScrolledRef.current) return;
            scrollToEnd();
          });
    observer?.observe(node);
    Array.from(node.children).forEach((child) => observer?.observe(child));

    return () => {
      window.cancelAnimationFrame(frame);
      interactionEvents.forEach((eventName) => node.removeEventListener(eventName, markUserScrolled));
      observer?.disconnect();
    };
  }, [ref, resetKey]);
}
