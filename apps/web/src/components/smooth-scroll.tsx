'use client';

import { useEffect } from 'react';
import Lenis from 'lenis';

/**
 * Wraps its children and drives smooth scrolling with Lenis.
 *
 * - Falls back to native scroll (and skips Lenis) when the user prefers
 *   reduced motion.
 * - Uses Lenis's rAF loop for buttery scrolling on the landing page.
 * - Exposes anchor-link support so in-page `#section` links glide instead of
 *   jumping.
 *
 * Render it high in the tree (inside a client page or layout) and let it be the
 * single Lenis instance for the route.
 */
export function SmoothScroll({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) {
      // Respect the OS-level preference: no artificial smoothing.
      return;
    }

    const lenis = new Lenis({
      duration: 1.1,
      easing: (t) => Math.min(1, (1 + (1 - 1.1) ** (1 - t)) / 2),
      smoothWheel: true,
      wheelMultiplier: 1,
      touchMultiplier: 1.4,
    });

    let raf = 0;
    const loop = (time: number) => {
      lenis.raf(time);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    // Keep anchor navigation (`/#section`) in sync with Lenis so in-page links
    // scroll smoothly instead of snapping.
    const onClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      const anchor = target?.closest('a[href^="#"]') as HTMLAnchorElement | null;
      if (!anchor) return;
      const id = anchor.getAttribute('href');
      if (id && id !== '#') {
        const el = document.querySelector(id);
        if (el) {
          event.preventDefault();
          lenis.scrollTo(el as HTMLElement, { offset: -72 });
        }
      }
    };
    document.addEventListener('click', onClick);

    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('click', onClick);
      lenis.destroy();
    };
  }, []);

  return <>{children}</>;
}
