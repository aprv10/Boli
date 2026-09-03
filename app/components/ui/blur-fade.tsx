'use client';

import { useEffect, useRef, type ReactNode } from 'react';

/**
 * Adapted from Magic UI's Blur Fade (MIT), discovered through 21st.dev.
 * See THIRD_PARTY_NOTICES.md. Native animation replaces Motion; content stays
 * visible before hydration and if animation/observer support is unavailable.
 */
export function BlurFade({ children, className = '', delay = 0 }: {
  children: ReactNode;
  className?: string;
  /** Stagger in seconds. */
  delay?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element || !('IntersectionObserver' in window) || !element.animate) return;
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (preference.matches) return;

    let animation: Animation | undefined;
    let revealed = false;
    const observer = new IntersectionObserver(entries => {
      if (revealed || !entries.some(entry => entry.isIntersecting)) return;
      revealed = true;
      observer.disconnect();
      if (preference.matches || element.contains(document.activeElement)) return;
      animation = element.animate([
        { opacity: 0.2, transform: 'translateY(12px)', filter: 'blur(3px)' },
        { opacity: 1, transform: 'translateY(0)', filter: 'blur(0px)' },
      ], {
        duration: 560,
        delay: Math.min(Math.max(delay, 0), 0.3) * 1000,
        easing: 'cubic-bezier(.22, .75, .25, 1)',
        fill: 'backwards',
      });
    }, { threshold: 0, rootMargin: '0px 0px -24px 0px' });

    // Keyboard navigation and a changed motion preference reveal content now.
    function finish() {
      revealed = true;
      observer.disconnect();
      animation?.cancel();
    }
    function syncPreference() { if (preference.matches) finish(); }
    observer.observe(element);
    element.addEventListener('focusin', finish);
    preference.addEventListener('change', syncPreference);
    return () => {
      observer.disconnect();
      animation?.cancel();
      element.removeEventListener('focusin', finish);
      preference.removeEventListener('change', syncPreference);
    };
  }, [delay]);

  return <div ref={ref} className={`boli-blur-fade ${className}`}>{children}</div>;
}
