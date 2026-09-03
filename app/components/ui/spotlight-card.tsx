'use client';

import { useEffect, useRef, type PointerEvent, type ReactNode } from 'react';

/**
 * An original, lightweight implementation of the Card Spotlight interaction:
 * https://ui.aceternity.com/components/card-spotlight
 * Optional depth follows Aceternity's 3D Card pattern. Only the illustration
 * moves; the link's hit area and its text remain stationary.
 */
export function SpotlightCard({ children, className = '', depth = false }: {
  children: ReactNode;
  className?: string;
  depth?: boolean;
}) {
  const cardRef = useRef<HTMLElement>(null);
  const frameRef = useRef<number | null>(null);
  const enabledRef = useRef(false);

  useEffect(() => {
    const preference = window.matchMedia('(hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)');
    function syncPreference() {
      enabledRef.current = preference.matches;
      if (!preference.matches) {
        if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
        cardRef.current?.style.setProperty('--spotlight-active', '0');
        cardRef.current?.style.setProperty('--card-rotate-x', '0deg');
        cardRef.current?.style.setProperty('--card-rotate-y', '0deg');
      }
    }
    syncPreference();
    preference.addEventListener('change', syncPreference);
    return () => {
      preference.removeEventListener('change', syncPreference);
      if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
    };
  }, []);

  function moveSpotlight(event: PointerEvent<HTMLElement>) {
    if (!enabledRef.current || event.pointerType !== 'mouse') return;
    const { clientX, clientY } = event;
    if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = null;
      const card = cardRef.current;
      if (!card || !enabledRef.current) return;
      const bounds = card.getBoundingClientRect();
      card.style.setProperty('--spotlight-x', `${clientX - bounds.left}px`);
      card.style.setProperty('--spotlight-y', `${clientY - bounds.top}px`);
      card.style.setProperty('--spotlight-active', '1');
      if (depth && bounds.width && bounds.height) {
        const x = Math.max(-1, Math.min(1, (clientX - bounds.left) / bounds.width * 2 - 1));
        const y = Math.max(-1, Math.min(1, (clientY - bounds.top) / bounds.height * 2 - 1));
        card.style.setProperty('--card-rotate-x', `${-y * 5}deg`);
        card.style.setProperty('--card-rotate-y', `${x * 7}deg`);
      }
    });
  }

  function clearSpotlight() {
    if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
    cardRef.current?.style.setProperty('--spotlight-active', '0');
    cardRef.current?.style.setProperty('--card-rotate-x', '0deg');
    cardRef.current?.style.setProperty('--card-rotate-y', '0deg');
  }

  return (
    <article
      className={`boli-spotlight-card ${className}`}
      data-depth={depth || undefined}
      ref={cardRef}
      onPointerMove={moveSpotlight}
      onPointerLeave={clearSpotlight}
      onPointerCancel={clearSpotlight}
    >
      {children}
    </article>
  );
}
