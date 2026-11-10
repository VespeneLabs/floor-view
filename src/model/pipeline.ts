import { distance, EPSILON } from './geometry';
import type { Level, PipePoint, Pipeline, Point } from './types';

/** Distance between two pipeline points in 3D (m). */
export function pipeDistance(a: PipePoint, b: PipePoint): number {
  return Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
}

/** Total length of a pipeline in 3D, risers included (m). */
export function pipelineLength(pipeline: Pipeline): number {
  let sum = 0;
  for (let i = 1; i < pipeline.points.length; i++) sum += pipeDistance(pipeline.points[i - 1]!, pipeline.points[i]!);
  return sum;
}

/** True when the segment is vertical (same plan position, different z). */
export function isRiser(a: PipePoint, b: PipePoint, tolerance = 1e-6): boolean {
  return Math.abs(a.x - b.x) <= tolerance && Math.abs(a.y - b.y) <= tolerance && Math.abs(a.z - b.z) > tolerance;
}

/**
 * Rotation in degrees (clockwise in plan view, 0–360) that lines a model's x axis up with the
 * segment from `a` to `b`, e.g. for a valve marker placed on a pipe. 0 for a riser.
 */
export function segmentRotation(a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (Math.hypot(dx, dy) < EPSILON) return 0;
  // Plan y grows down, so atan2 already measures clockwise.
  const deg = (Math.atan2(dy, dx) * 180) / Math.PI;
  return ((deg % 360) + 360) % 360 + 0;
}

/** Closest point on the 3D segment ab to p, with its parameter t (0 at a, 1 at b). */
function closestOnSegment3(p: PipePoint, a: PipePoint, b: PipePoint): { point: PipePoint; t: number } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dz = b.z - a.z;
  const lenSq = dx * dx + dy * dy + dz * dz;
  const t = lenSq < EPSILON ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy + (p.z - a.z) * dz) / lenSq));
  return { point: { x: a.x + t * dx, y: a.y + t * dy, z: a.z + t * dz }, t };
}

export interface PipelineProjection {
  /** Closest point on the pipeline, with z interpolated along the segment. */
  point: PipePoint;
  /** Index of the segment (from `points[segment]` to `points[segment + 1]`). */
  segment: number;
  /** Position along the segment, 0 at its start and 1 at its end. */
  t: number;
  /** Plan (2D) distance from the query point to `point`. */
  distance: number;
}

/**
 * The point on a pipeline closest to `p` in plan view, e.g. to snap a fitting onto a pipe. Risers
 * project to their plan position; on a tie the first segment wins. Null for a pipeline with fewer
 * than 2 points.
 */
export function nearestPointOnPipeline(pipeline: Pipeline, p: Point): PipelineProjection | null {
  let best: PipelineProjection | null = null;
  for (let i = 1; i < pipeline.points.length; i++) {
    const a = pipeline.points[i - 1]!;
    const b = pipeline.points[i]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lenSq = dx * dx + dy * dy;
    const t = lenSq < EPSILON ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq));
    const point = { x: a.x + t * dx, y: a.y + t * dy, z: a.z + t * (b.z - a.z) };
    const d = distance(p, point);
    if (!best || d < best.distance - EPSILON) best = { point, segment: i - 1, t, distance: d };
  }
  return best;
}

export type PipelineEnd = 'start' | 'end';

/**
 * Where an end of one pipeline meets another pipeline (in 3D, so pipes crossing at different
 * heights don't connect):
 * - `joint`: the end meets an end of the other pipeline (reported once per pair).
 * - `tee`: the end meets the other pipeline between its ends; `segment` is the segment it lands
 *   on (`t` 0 means it lands on that segment's start vertex).
 */
export interface PipelineJunction {
  kind: 'joint' | 'tee';
  point: PipePoint;
  /** The pipeline whose end is at the junction. */
  pipelineId: string;
  end: PipelineEnd;
  /** The pipeline it meets. */
  otherId: string;
  /** joint only: the other pipeline's end. */
  otherEnd?: PipelineEnd;
  /** tee only: segment index on the other pipeline. */
  segment?: number;
}

/** Connections between the pipelines of a level, derived from their geometry. */
export function pipelineJunctions(level: Level, tolerance = 1e-3): PipelineJunction[] {
  const out: PipelineJunction[] = [];
  const pipes = level.pipelines.filter((p) => p.points.length >= 2);
  pipes.forEach((pipe, pi) => {
    const ends: [PipelineEnd, PipePoint][] = [
      ['start', pipe.points[0]!],
      ['end', pipe.points[pipe.points.length - 1]!],
    ];
    for (const [end, point] of ends) {
      pipes.forEach((other, oi) => {
        if (oi === pi) return;
        const first = other.points[0]!;
        const last = other.points[other.points.length - 1]!;
        const otherEnd: PipelineEnd | null =
          pipeDistance(point, first) <= tolerance ? 'start' : pipeDistance(point, last) <= tolerance ? 'end' : null;
        if (otherEnd) {
          // Seen from both pipelines; keep the one from the earlier pipeline.
          if (pi < oi) out.push({ kind: 'joint', point: { ...point }, pipelineId: pipe.id, end, otherId: other.id, otherEnd });
          return;
        }
        for (let s = 1; s < other.points.length; s++) {
          const hit = closestOnSegment3(point, other.points[s - 1]!, other.points[s]!);
          if (pipeDistance(point, hit.point) <= tolerance) {
            out.push({ kind: 'tee', point: { ...point }, pipelineId: pipe.id, end, otherId: other.id, segment: hit.t >= 1 ? s : s - 1 });
            return;
          }
        }
      });
    }
  });
  return out;
}
