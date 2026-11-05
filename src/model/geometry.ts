import type { Point } from './types';

export const EPSILON = 1e-9;

export function distance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

export function pointsEqual(a: Point, b: Point, tolerance = 1e-6): boolean {
  return Math.abs(a.x - b.x) <= tolerance && Math.abs(a.y - b.y) <= tolerance;
}

/** Signed area (shoelace). Positive when the points wind clockwise in plan (y-down) space. */
export function signedArea(points: readonly Point[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    sum += a.x * b.y - b.x * a.y;
  }
  return sum / 2;
}

export function polygonArea(points: readonly Point[]): number {
  return Math.abs(signedArea(points));
}

/** Area-weighted centroid; falls back to the vertex average for degenerate polygons. */
export function polygonCentroid(points: readonly Point[]): Point {
  if (points.length === 0) return { x: 0, y: 0 };
  const area = signedArea(points);
  if (Math.abs(area) < EPSILON) {
    const sx = points.reduce((s, p) => s + p.x, 0);
    const sy = points.reduce((s, p) => s + p.y, 0);
    return { x: sx / points.length, y: sy / points.length };
  }
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    const cross = a.x * b.y - b.x * a.y;
    cx += (a.x + b.x) * cross;
    cy += (a.y + b.y) * cross;
  }
  return { x: cx / (6 * area), y: cy / (6 * area) };
}

/** Even-odd ray casting test. Points exactly on an edge may return either value. */
export function pointInPolygon(p: Point, polygon: readonly Point[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]!;
    const b = polygon[j]!;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

/** Closest point on segment ab to p. */
export function closestPointOnSegment(p: Point, a: Point, b: Point): Point {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < EPSILON) return { x: a.x, y: a.y };
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq));
  return { x: a.x + t * dx, y: a.y + t * dy };
}

export function distanceToSegment(p: Point, a: Point, b: Point): number {
  return distance(p, closestPointOnSegment(p, a, b));
}

export function snapToGrid(p: Point, grid: number): Point {
  if (grid <= 0) return { x: p.x, y: p.y };
  // `+ 0` normalizes -0 to 0 so snapped values serialize cleanly.
  return { x: Math.round(p.x / grid) * grid + 0, y: Math.round(p.y / grid) * grid + 0 };
}

/** Constrain `p` so the segment from `origin` is horizontal, vertical or diagonal (45° steps). */
export function constrainAngle(origin: Point, p: Point, stepRadians = Math.PI / 4): Point {
  const dx = p.x - origin.x;
  const dy = p.y - origin.y;
  const len = Math.hypot(dx, dy);
  if (len < EPSILON) return { x: p.x, y: p.y };
  const angle = Math.round(Math.atan2(dy, dx) / stepRadians) * stepRadians;
  return { x: origin.x + Math.cos(angle) * len, y: origin.y + Math.sin(angle) * len };
}

export interface SnapOptions {
  /** Grid size in meters; 0 disables grid snapping. */
  grid: number;
  /** Points to snap to (e.g. wall endpoints, room vertices). */
  targets?: readonly Point[];
  /** Max distance (meters) to snap to a target. */
  tolerance: number;
}

export interface SnapResult {
  point: Point;
  /** True when the point snapped to one of `targets` rather than the grid. */
  snappedToTarget: boolean;
}

/** Snap to the nearest target within tolerance, else to the grid. */
export function snapPoint(p: Point, options: SnapOptions): SnapResult {
  let best: Point | null = null;
  let bestDist = options.tolerance;
  for (const t of options.targets ?? []) {
    const d = distance(p, t);
    if (d <= bestDist) {
      best = t;
      bestDist = d;
    }
  }
  if (best) return { point: { x: best.x, y: best.y }, snappedToTarget: true };
  return { point: snapToGrid(p, options.grid), snappedToTarget: false };
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function boundsOf(points: Iterable<Point>): Bounds | null {
  let b: Bounds | null = null;
  for (const p of points) {
    if (!b) b = { minX: p.x, minY: p.y, maxX: p.x, maxY: p.y };
    else {
      b.minX = Math.min(b.minX, p.x);
      b.minY = Math.min(b.minY, p.y);
      b.maxX = Math.max(b.maxX, p.x);
      b.maxY = Math.max(b.maxY, p.y);
    }
  }
  return b;
}
