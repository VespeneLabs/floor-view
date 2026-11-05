/** The `prefers-reduced-motion: reduce` media query, or null where `matchMedia` is unavailable (SSR, tests). */
export function reducedMotionQuery(): MediaQueryList | null {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
}

/** True when the user asked the OS/browser to minimize animation. */
export function prefersReducedMotion(): boolean {
  return reducedMotionQuery()?.matches ?? false;
}

/** Where `centerOn` should look: a position on a level (plan meters). */
export interface CenterOnTarget {
  levelId: string;
  position: { x: number; y: number };
}

export interface CenterOnOptions {
  /** Ease to the target. Default true; always false under `prefers-reduced-motion: reduce`. */
  animate?: boolean;
  /** Animation length in ms. Default 300. */
  duration?: number;
}

export const DEFAULT_CENTER_DURATION = 300;

/** Whether `centerOn` should animate, and for how long (0: jump). */
export function centerDuration(options: CenterOnOptions): number {
  const duration = options.duration ?? DEFAULT_CENTER_DURATION;
  if (options.animate === false || !(duration > 0) || prefersReducedMotion() || typeof requestAnimationFrame !== 'function') return 0;
  return duration;
}

/** Ease-out cubic: fast start, gentle stop. */
export const easeOutCubic = (t: number): number => 1 - (1 - t) ** 3;
