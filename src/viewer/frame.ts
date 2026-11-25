import type { FloorPlan, Point } from '../model/types';
import { resolveFocus, type FocusOptions, type FocusTarget, type PointLookup, type ResolvedFocus } from './focus';

export interface FrameOptions {
  /** Free space kept around the targets, in CSS px. Default 48. */
  padding?: number;
  /**
   * The smallest stretch of plan, in meters, the view keeps across its shorter side, so a single
   * small target never fills the screen and its surroundings stay visible. Default 8.
   */
  minSpan?: number;
  /** Ease there (pan and zoom together). Default true; always false under `prefers-reduced-motion: reduce`. */
  animate?: boolean;
  /** Animation length in ms. Default 700. */
  duration?: number;
  /** Highlight the first target, as `focus()` does. Default false. */
  highlight?: FocusOptions['highlight'];
  /**
   * The 3D camera angle at the end of the move. `'keep'` (default) keeps the current angle and
   * moves along the line of sight. `'auto'` picks a view for the targets: preferably from outside
   * them, looking across them toward the middle of their level, `AUTO_FRAME_ELEVATION` degrees
   * above the floor, so the room is the background; when a 3D model (or a wall drawn at full
   * height) stands between that camera and a target, the nearest side with a clear view instead,
   * and from higher up when no side is clear (see `autoFrameCandidates`). A `FrameAngle` sets it.
   * Ignored in 2D.
   */
  angle?: 'keep' | 'auto' | FrameAngle;
}

/**
 * A 3D camera angle, in degrees. `azimuth` is the plan direction from the targets to the camera
 * (0 = +x, 90 = +y of the plan); `elevation` is the angle above the floor (0 to 90 = top down).
 */
export interface FrameAngle {
  azimuth: number;
  elevation: number;
}

/** Elevation of the `'auto'` frame angle, in degrees. */
export const AUTO_FRAME_ELEVATION = 35;
/** The higher elevation `'auto'` tries when no side is clear at `AUTO_FRAME_ELEVATION`. */
export const AUTO_FRAME_HIGH_ELEVATION = 55;
/** How many sides around the targets `'auto'` tries per elevation. */
const AUTO_FRAME_SIDES = 12;
/** Azimuth of the `'auto'` angle when the targets sit in the middle of their level: the default 3D view's side. */
const AUTO_FRAME_FALLBACK_AZIMUTH = (Math.atan2(0.9, 0.55) * 180) / Math.PI;

export const DEFAULT_FRAME_PADDING = 48;
export const DEFAULT_FRAME_MIN_SPAN = 8;
export const DEFAULT_FRAME_DURATION = 700;

/** What `frame()` fits into the view: the targets on one level and their bounds (plan meters). */
export interface ResolvedFrame {
  levelId: string;
  /** The first target that exists (the one `highlight` marks). */
  first: FocusTarget;
  /** The resolved targets on `levelId`, the first one first. */
  targets: ResolvedFocus[];
  min: Point;
  max: Point;
  /** Highest target above the level floor. */
  height: number;
}

/**
 * Resolves the targets of `frame()`. The first target that exists picks the level; targets on
 * other levels are left out, so a pair split across levels frames the first one. Each target
 * counts with its highlight shape (a ring's radius, an outline's points). Null when none exists.
 */
export function resolveFrame(plan: FloorPlan, targets: readonly FocusTarget[], points: PointLookup): ResolvedFrame | null {
  let frame: ResolvedFrame | null = null;
  for (const target of targets) {
    const resolved = resolveFocus(plan, target, points);
    if (!resolved || (frame && resolved.levelId !== frame.levelId)) continue;
    frame ??= { levelId: resolved.levelId, first: target, targets: [], min: { x: Infinity, y: Infinity }, max: { x: -Infinity, y: -Infinity }, height: 0 };
    frame.targets.push(resolved);
    frame.height = Math.max(frame.height, resolved.height);
    const shape = resolved.shape;
    const extent: Point[] =
      shape.type === 'ring'
        ? [
            { x: resolved.center.x - shape.radius, y: resolved.center.y - shape.radius },
            { x: resolved.center.x + shape.radius, y: resolved.center.y + shape.radius },
          ]
        : shape.points;
    for (const p of extent) {
      frame.min = { x: Math.min(frame.min.x, p.x), y: Math.min(frame.min.y, p.y) };
      frame.max = { x: Math.max(frame.max.x, p.x), y: Math.max(frame.max.y, p.y) };
    }
  }
  return frame;
}

/**
 * Pixels per plan meter that fit a box of `size` meters into a view of `view` CSS px with
 * `padding` px on every side, never closer than `minSpan` meters across the view's shorter side.
 */
export function framePixelsPerMeter(size: { width: number; height: number }, view: { width: number; height: number }, padding: number, minSpan: number): number {
  const fit = (pixels: number, meters: number) => (meters > 0 ? Math.max(pixels - 2 * padding, 1) / meters : Infinity);
  const byBox = Math.min(fit(view.width, size.width), fit(view.height, size.height));
  const bySpan = minSpan > 0 ? Math.min(view.width, view.height) / minSpan : Infinity;
  const ppm = Math.min(byBox, bySpan);
  return Number.isFinite(ppm) ? ppm : Math.min(view.width, view.height) / DEFAULT_FRAME_MIN_SPAN;
}

/** Interpolate a zoom factor on a log scale, so zooming in and out looks equally fast. */
export function lerpZoom(from: number, to: number, t: number): number {
  return from * (to / from) ** t;
}

/**
 * The `'auto'` frame angle: the camera stands on the far side of the targets from the middle of
 * their level and looks across them toward it, `AUTO_FRAME_ELEVATION` degrees above the floor.
 * Targets less than half a meter from the middle get the default 3D view's side.
 */
export function autoFrameAngle(levelCenter: Point, targetCenter: Point): FrameAngle {
  const dx = targetCenter.x - levelCenter.x;
  const dy = targetCenter.y - levelCenter.y;
  const azimuth = Math.hypot(dx, dy) < 0.5 ? AUTO_FRAME_FALLBACK_AZIMUTH : (Math.atan2(dy, dx) * 180) / Math.PI;
  return { azimuth, elevation: AUTO_FRAME_ELEVATION };
}

/**
 * The camera offset from the orbit target for a frame angle at `distance` meters, in world
 * coordinates (y up, plan y along world z).
 */
export function frameAngleOffset(angle: FrameAngle, distance: number): { x: number; y: number; z: number } {
  const az = (angle.azimuth * Math.PI) / 180;
  const el = (Math.min(Math.max(angle.elevation, 1), 89.9) * Math.PI) / 180;
  const flat = Math.cos(el) * distance;
  return { x: Math.cos(az) * flat, y: Math.sin(el) * distance, z: Math.sin(az) * flat };
}

/**
 * Interpolate between two camera offsets on a sphere: the distance on a log scale (as `lerpZoom`),
 * the elevation linearly and the azimuth the short way around. So a change of angle swings
 * around the target and never cuts through it.
 */
export function lerpOffset(
  from: { x: number; y: number; z: number },
  to: { x: number; y: number; z: number },
  t: number,
): { x: number; y: number; z: number } {
  const polar = (v: { x: number; y: number; z: number }) => {
    const r = Math.max(Math.hypot(v.x, v.y, v.z), 1e-6);
    return { r, el: Math.asin(Math.min(Math.max(v.y / r, -1), 1)), az: Math.atan2(v.z, v.x) };
  };
  const a = polar(from);
  const b = polar(to);
  let dAz = b.az - a.az;
  if (dAz > Math.PI) dAz -= 2 * Math.PI;
  if (dAz < -Math.PI) dAz += 2 * Math.PI;
  const r = lerpZoom(a.r, b.r, t);
  const el = a.el + (b.el - a.el) * t;
  const az = a.az + dAz * t;
  return { x: Math.cos(az) * Math.cos(el) * r, y: Math.sin(el) * r, z: Math.sin(az) * Math.cos(el) * r };
}

/**
 * The angles `'auto'` tries, best first: the preferred angle, then the other sides every
 * 360 / 12 degrees, nearest to it first (alternating left and right), all at the preferred
 * elevation; then the same sides at `AUTO_FRAME_HIGH_ELEVATION`. The viewer takes the first one
 * with a clear view of every target, or the one that hides the fewest.
 */
export function autoFrameCandidates(preferred: FrameAngle): FrameAngle[] {
  const step = 360 / AUTO_FRAME_SIDES;
  const offsets = [0];
  for (let i = 1; i <= AUTO_FRAME_SIDES / 2; i++) {
    offsets.push(i * step);
    if (i < AUTO_FRAME_SIDES / 2) offsets.push(-i * step);
  }
  const elevations = preferred.elevation < AUTO_FRAME_HIGH_ELEVATION ? [preferred.elevation, AUTO_FRAME_HIGH_ELEVATION] : [preferred.elevation];
  return elevations.flatMap((elevation) => offsets.map((offset) => ({ azimuth: preferred.azimuth + offset, elevation })));
}
