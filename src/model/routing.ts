import { distanceToSegment } from './geometry';
import type { Level, PipePoint, Point, Wall } from './types';

export interface RoutePipelineOptions {
  /** Height of the run above the level floor (m). Default 2.6. */
  elevation?: number;
  /** Pipe diameter (m): keeps the route that far off wall faces. Default 0.05. */
  diameter?: number;
  /** Spacing of the routing grid (m). Coarser for long routes, to bound the search. Default 0.25. */
  grid?: number;
  /** Cost of a bend, in meters of pipe: higher gives fewer corners. Default 1.5. */
  turnCost?: number;
  /** Cost of passing through a wall, in meters of pipe. Default 4. */
  wallCost?: number;
}

/** Cost factor of a step inside a wall body, and of one running beside a wall (within `ALONG_BAND`). */
const INSIDE_WALL = 5;
const ALONG_WALL = 0.75;
const ALONG_BAND = 0.5;
/** Largest lattice searched; the grid gets coarser for bigger areas. */
const MAX_NODES = 40000;
const DIRS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;

const round = (v: number) => Math.round(v * 1e6) / 1e6 + 0;

/**
 * True when the step from a to b crosses segment cd: a strictly on one side and b on the other
 * side or on the line, so a route passing through a point on cd is counted once.
 */
function segmentsIntersect(a: Point, b: Point, c: Point, d: Point): boolean {
  const cross = (o: Point, p: Point, q: Point) => (p.x - o.x) * (q.y - o.y) - (p.y - o.y) * (q.x - o.x);
  const d1 = cross(c, d, a);
  const d2 = cross(c, d, b);
  const d3 = cross(a, b, c);
  const d4 = cross(a, b, d);
  return ((d1 > 0 && d2 <= 0) || (d1 < 0 && d2 >= 0)) && ((d3 >= 0 && d4 <= 0) || (d3 <= 0 && d4 >= 0));
}

/** Grid coordinates covering [min, max] plus the exact `extra` values, sorted and unique. */
function axis(min: number, max: number, step: number, extra: number[]): number[] {
  const values = [...extra];
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) values.push(round(v));
  values.sort((a, b) => a - b);
  return values.filter((v, i) => i === 0 || v - values[i - 1]! > 1e-6);
}

/**
 * An orthogonal route for a pipeline from `from` to `to` on a level, as pipeline points at one
 * height: the shortest path on a grid that prefers few bends and runs beside walls, stays out of
 * wall bodies and passes through a wall only when going around costs more (`wallCost`). The first
 * and last points are exactly `from` and `to`; a straight line is returned when both are on one
 * axis and nothing is in the way. Returns null when `from` and `to` are the same position.
 *
 * Pure (A* search); only walls are obstacles, equipment and other pipelines are not.
 */
export function routePipeline(level: Pick<Level, 'walls'>, from: Point, to: Point, options: RoutePipelineOptions = {}): PipePoint[] | null {
  const z = options.elevation ?? 2.6;
  const radius = (options.diameter ?? 0.05) / 2;
  const turnCost = options.turnCost ?? 1.5;
  const wallCost = options.wallCost ?? 4;
  const start = { x: round(from.x), y: round(from.y) };
  const goal = { x: round(to.x), y: round(to.y) };
  if (start.x === goal.x && start.y === goal.y) return null;

  // Search area: around both ends, with room to go around what is between them.
  const margin = Math.max(4, 0.35 * Math.max(Math.abs(goal.x - start.x), Math.abs(goal.y - start.y)));
  const minX = Math.min(start.x, goal.x) - margin;
  const maxX = Math.max(start.x, goal.x) + margin;
  const minY = Math.min(start.y, goal.y) - margin;
  const maxY = Math.max(start.y, goal.y) + margin;
  let step = options.grid && options.grid > 0 ? options.grid : 0.25;
  while (((maxX - minX) / step) * ((maxY - minY) / step) > MAX_NODES) step *= 2;
  const xs = axis(minX, maxX, step, [start.x, goal.x]);
  const ys = axis(minY, maxY, step, [start.y, goal.y]);
  const cols = xs.length;
  const count = cols * ys.length;

  const reach = ALONG_BAND + radius;
  const walls = level.walls.filter((w: Wall) => {
    const pad = w.thickness / 2 + reach;
    return (
      Math.max(w.start.x, w.end.x) >= minX - pad &&
      Math.min(w.start.x, w.end.x) <= maxX + pad &&
      Math.max(w.start.y, w.end.y) >= minY - pad &&
      Math.min(w.start.y, w.end.y) <= maxY + pad
    );
  });

  // Cost factor per node: inside a wall body, beside a wall, or open floor.
  const factor = new Float32Array(count).fill(1);
  for (let j = 0; j < ys.length; j++) {
    for (let i = 0; i < cols; i++) {
      const p = { x: xs[i]!, y: ys[j]! };
      let f = 1;
      for (const w of walls) {
        const gap = distanceToSegment(p, w.start, w.end) - w.thickness / 2 - radius;
        if (gap < 0) {
          f = INSIDE_WALL;
          break;
        }
        if (gap <= ALONG_BAND) f = ALONG_WALL;
      }
      factor[j * cols + i] = f;
    }
  }
  // The ends are where they are (e.g. equipment standing against a wall).
  const startNode = ys.indexOf(start.y) * cols + xs.indexOf(start.x);
  const goalNode = ys.indexOf(goal.y) * cols + xs.indexOf(goal.x);
  factor[startNode] = Math.min(factor[startNode]!, 1);
  factor[goalNode] = Math.min(factor[goalNode]!, 1);

  // A* over (node, direction it was entered from); direction 4 is "none" (the start).
  const states = count * 5;
  const cost = new Float64Array(states).fill(Infinity);
  const parent = new Int32Array(states).fill(-1);
  const closed = new Uint8Array(states);
  const heap: number[] = [];
  const priority = new Float64Array(states);
  const push = (s: number) => {
    heap.push(s);
    for (let k = heap.length - 1; k > 0; ) {
      const up = (k - 1) >> 1;
      if (priority[heap[up]!]! <= priority[heap[k]!]!) break;
      [heap[up], heap[k]] = [heap[k]!, heap[up]!];
      k = up;
    }
  };
  const pop = (): number => {
    const top = heap[0]!;
    const last = heap.pop()!;
    if (heap.length > 0) {
      heap[0] = last;
      for (let k = 0; ; ) {
        const l = 2 * k + 1;
        const r = l + 1;
        let m = k;
        if (l < heap.length && priority[heap[l]!]! < priority[heap[m]!]!) m = l;
        if (r < heap.length && priority[heap[r]!]! < priority[heap[m]!]!) m = r;
        if (m === k) break;
        [heap[m], heap[k]] = [heap[k]!, heap[m]!];
        k = m;
      }
    }
    return top;
  };
  const estimate = (node: number) => (Math.abs(xs[node % cols]! - goal.x) + Math.abs(ys[Math.floor(node / cols)]! - goal.y)) * ALONG_WALL;

  const first = startNode * 5 + 4;
  cost[first] = 0;
  priority[first] = estimate(startNode);
  push(first);
  let found = -1;
  while (heap.length > 0) {
    const s = pop();
    if (closed[s]) continue;
    closed[s] = 1;
    const node = Math.floor(s / 5);
    if (node === goalNode) {
      found = s;
      break;
    }
    const dir = s % 5;
    const i = node % cols;
    const j = Math.floor(node / cols);
    const a = { x: xs[i]!, y: ys[j]! };
    for (let d = 0; d < 4; d++) {
      if (dir < 4 && (d ^ 1) === dir) continue; // no U-turns
      const ni = i + DIRS[d]![0];
      const nj = j + DIRS[d]![1];
      if (ni < 0 || nj < 0 || ni >= cols || nj >= ys.length) continue;
      const next = nj * cols + ni;
      const t = next * 5 + d;
      if (closed[t]) continue;
      const b = { x: xs[ni]!, y: ys[nj]! };
      let c = cost[s]! + (Math.abs(b.x - a.x) + Math.abs(b.y - a.y)) * ((factor[node]! + factor[next]!) / 2);
      if (dir < 4 && d !== dir) c += turnCost;
      if (c >= cost[t]!) continue;
      for (const w of walls) if (segmentsIntersect(a, b, w.start, w.end)) c += wallCost;
      if (c >= cost[t]!) continue;
      cost[t] = c;
      parent[t] = s;
      priority[t] = c + estimate(next);
      push(t);
    }
  }
  if (found < 0) return [{ ...start, z }, { ...goal, z }];

  // Walk back, keeping only the corners.
  const corners: Point[] = [];
  for (let s = found; s >= 0; s = parent[s]!) {
    const node = Math.floor(s / 5);
    const p = { x: xs[node % cols]!, y: ys[Math.floor(node / cols)]! };
    const [last, before] = [corners.at(-1), corners.at(-2)];
    if (last && before && ((before.x === last.x && last.x === p.x) || (before.y === last.y && last.y === p.y))) corners[corners.length - 1] = p;
    else corners.push(p);
  }
  return corners.reverse().map((p) => ({ x: p.x, y: p.y, z }));
}
