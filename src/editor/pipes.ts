import { EPSILON } from '../model/geometry';
import type { Point, Wall } from '../model/types';

/** Gap between a wall surface and a pipe running along it, in meters. */
export const PIPE_WALL_CLEARANCE = 0.05;

/** Constrain `p` so the segment from `origin` is horizontal or vertical (the longer axis wins). */
export function orthoPoint(origin: Point, p: Point): Point {
  return Math.abs(p.x - origin.x) >= Math.abs(p.y - origin.y) ? { x: p.x, y: origin.y } : { x: origin.x, y: p.y };
}

const cross = (a: Point, b: Point) => a.x * b.y - a.y * b.x;

/**
 * Snap a pipe point to run along a wall face: the line parallel to each wall at
 * `thickness / 2 + radius + PIPE_WALL_CLEARANCE` on either side. Without `from`, `p` moves straight
 * onto the nearest face line; with `from` (the previous point), it slides along the segment
 * `from → p` to where that segment meets a face line, so the segment keeps its direction. Returns the
 * point and the face's unit direction, or null when no face line is within `tolerance`.
 */
export function snapToWallFace(
  p: Point,
  from: Point | undefined,
  walls: readonly Wall[],
  radius: number,
  tolerance: number,
): { point: Point; direction: Point } | null {
  let best: { point: Point; direction: Point } | null = null;
  let bestDist = tolerance;
  for (const wall of walls) {
    const dx = wall.end.x - wall.start.x;
    const dy = wall.end.y - wall.start.y;
    const len = Math.hypot(dx, dy);
    if (len < EPSILON) continue;
    const u = { x: dx / len, y: dy / len };
    const n = { x: -u.y, y: u.x };
    const offset = wall.thickness / 2 + radius + PIPE_WALL_CLEARANCE;
    for (const side of [1, -1]) {
      const base = { x: wall.start.x + n.x * offset * side, y: wall.start.y + n.y * offset * side };
      let q: Point;
      if (!from) {
        const t = (p.x - base.x) * u.x + (p.y - base.y) * u.y;
        q = { x: base.x + u.x * t, y: base.y + u.y * t };
      } else {
        const d = { x: p.x - from.x, y: p.y - from.y };
        const denom = cross(d, u);
        if (Math.abs(denom) < EPSILON) continue; // running parallel to this wall
        const s = cross({ x: base.x - from.x, y: base.y - from.y }, u) / denom;
        if (s <= 0) continue;
        q = { x: from.x + d.x * s, y: from.y + d.y * s };
      }
      // Stay within the wall's length, extended by the offset so outside corners work too.
      const t = (q.x - base.x) * u.x + (q.y - base.y) * u.y;
      if (t < -offset || t > len + offset) continue;
      const dist = Math.hypot(q.x - p.x, q.y - p.y);
      if (dist <= bestDist) {
        // Rounded to µm so offsets like 0.125 + 0.025 + 0.05 serialize as 0.2.
        best = { point: { x: Math.round(q.x * 1e6) / 1e6 + 0, y: Math.round(q.y * 1e6) / 1e6 + 0 }, direction: u };
        bestDist = dist;
      }
    }
  }
  return best;
}
