import { describe, expect, it } from 'vitest';

import { routePipeline } from '../src/model/routing';
import type { PipePoint, Wall } from '../src/model/types';

const wall = (x1: number, y1: number, x2: number, y2: number, thickness = 0.2): Wall => ({ id: `w${x1}-${y1}-${x2}-${y2}`, start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness });
const xy = (points: PipePoint[] | null) => points!.map((p) => [p.x, p.y]);
const length = (points: PipePoint[]) => points.slice(1).reduce((sum, p, i) => sum + Math.abs(p.x - points[i]!.x) + Math.abs(p.y - points[i]!.y), 0);
const isOrthogonal = (points: PipePoint[]) => points.slice(1).every((p, i) => p.x === points[i]!.x || p.y === points[i]!.y);

describe('routePipeline', () => {
  it('runs straight between points on one axis and makes one bend otherwise', () => {
    expect(routePipeline({ walls: [] }, { x: 1, y: 2 }, { x: 9, y: 2 })).toEqual([{ x: 1, y: 2, z: 2.6 }, { x: 9, y: 2, z: 2.6 }]);
    const bent = routePipeline({ walls: [] }, { x: 1, y: 2 }, { x: 9, y: 6 }, { elevation: 3 })!;
    expect(bent).toHaveLength(3);
    expect(bent.every((p) => p.z === 3)).toBe(true);
    expect(isOrthogonal(bent)).toBe(true);
    expect(routePipeline({ walls: [] }, { x: 1, y: 2 }, { x: 1, y: 2 })).toBeNull();
  });

  it('keeps off-grid ends exactly', () => {
    const route = routePipeline({ walls: [] }, { x: 1.13, y: 2.07 }, { x: 7.41, y: 5.33 })!;
    expect(route[0]).toMatchObject({ x: 1.13, y: 2.07 });
    expect(route.at(-1)).toMatchObject({ x: 7.41, y: 5.33 });
    expect(isOrthogonal(route)).toBe(true);
  });

  it('goes around a wall when passing through it costs more than the detour', () => {
    const walls = [wall(5, 0, 5, 4)];
    expect(xy(routePipeline({ walls }, { x: 2, y: 2 }, { x: 8, y: 2 }))).toEqual([[2, 2], [8, 2]]); // a short detour is not worth four bends
    const route = routePipeline({ walls }, { x: 2, y: 2 }, { x: 8, y: 2 }, { wallCost: 20 })!;
    expect(isOrthogonal(route)).toBe(true);
    expect(route.length).toBeGreaterThan(2);
    // Never inside the wall body, and it passes one of the wall's ends.
    expect(route.some((p) => p.y > 4 || p.y < 0)).toBe(true);
    expect(length(route)).toBeLessThan(6 + 2 * 3);
  });

  it('passes through a wall when going around is much longer, crossing it once', () => {
    const walls = [wall(5, -40, 5, 40)];
    const route = routePipeline({ walls }, { x: 2, y: 2 }, { x: 8, y: 2 })!;
    expect(xy(route)).toEqual([[2, 2], [8, 2]]);
  });

  it('prefers to run beside a wall', () => {
    // A wall along y = 0; both ends 2 m off it and far apart: the long leg hugs the wall.
    const walls = [wall(0, 0, 30, 0)];
    const route = routePipeline({ walls }, { x: 2, y: 2 }, { x: 28, y: 2 }, { turnCost: 0.2 })!;
    expect(isOrthogonal(route)).toBe(true);
    const longest = route.slice(1).map((p, i) => ({ a: route[i]!, b: p })).sort((s, t) => Math.abs(t.b.x - t.a.x) - Math.abs(s.b.x - s.a.x))[0]!;
    expect(longest.a.y).toBe(longest.b.y);
    expect(longest.a.y).toBeLessThan(1);
    expect(longest.a.y).toBeGreaterThan(0.1); // beside it, not inside
  });

  it('stays fast and orthogonal on long routes by coarsening the grid', () => {
    const walls = Array.from({ length: 40 }, (_, i) => wall(10 + i * 10, 0, 10 + i * 10, 30));
    const started = performance.now();
    const route = routePipeline({ walls }, { x: 1, y: 15 }, { x: 420, y: 18 })!;
    expect(performance.now() - started).toBeLessThan(2000);
    expect(isOrthogonal(route)).toBe(true);
    expect(route[0]).toMatchObject({ x: 1, y: 15 });
    expect(route.at(-1)).toMatchObject({ x: 420, y: 18 });
  });
});
