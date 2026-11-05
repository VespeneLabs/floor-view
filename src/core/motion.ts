/** The `prefers-reduced-motion: reduce` media query, or null where `matchMedia` is unavailable (SSR, tests). */
export function reducedMotionQuery(): MediaQueryList | null {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
}

/** True when the user asked the OS/browser to minimize animation. */
export function prefersReducedMotion(): boolean {
  return reducedMotionQuery()?.matches ?? false;
}
