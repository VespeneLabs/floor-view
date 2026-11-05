import { describe, expect, it } from 'vitest';
import {
  boundsOf,
  constrainAngle,
  distanceToSegment,
  pointInPolygon,
  polygonArea,
  polygonCentroid,
  signedArea,
  snapPoint,
  snapToGrid,
} from '../src/model/geometry';

const square = [
  { x: 0, y: 0 },
  { x: 4, y: 0 },
  { x: 4, y: 4 },
  { x: 0, y: 4 },
];

describe('geometry', () => {
  it('computes polygon area regardless of winding', () => {
    expect(polygonArea(square)).toBe(16);
    expect(polygonArea([...square].reverse())).toBe(16);
    expect(signedArea(square)).toBe(-signedArea([...square].reverse()));
  });

  it('computes the centroid of a polygon, including L shapes', () => {
    expect(polygonCentroid(square)).toEqual({ x: 2, y: 2 });
    const l = [
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 2, y: 1 },
      { x: 1, y: 1 },
      { x: 1, y: 2 },
      { x: 0, y: 2 },
    ];
    const c = polygonCentroid(l);
    expect(c.x).toBeCloseTo(5 / 6);
    expect(c.y).toBeCloseTo(5 / 6);
  });

  it('falls back to the vertex average for degenerate polygons', () => {
    expect(polygonCentroid([{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 4, y: 0 }])).toEqual({ x: 2, y: 0 });
  });

  it('tests point containment', () => {
    expect(pointInPolygon({ x: 2, y: 2 }, square)).toBe(true);
    expect(pointInPolygon({ x: 5, y: 2 }, square)).toBe(false);
  });

  it('measures distance to a segment, clamped to its endpoints', () => {
    expect(distanceToSegment({ x: 2, y: 3 }, { x: 0, y: 0 }, { x: 4, y: 0 })).toBe(3);
    expect(distanceToSegment({ x: 7, y: 4 }, { x: 0, y: 0 }, { x: 4, y: 0 })).toBe(5);
  });

  it('snaps to grid without producing -0', () => {
    expect(snapToGrid({ x: 1.13, y: -0.1 }, 0.25)).toEqual({ x: 1.25, y: 0 });
    expect(Object.is(snapToGrid({ x: -0.1, y: 0 }, 0.25).x, 0)).toBe(true);
  });

  it('prefers nearby targets over the grid', () => {
    const target = { x: 1.07, y: 2.02 };
    expect(snapPoint({ x: 1.1, y: 2 }, { grid: 0.25, targets: [target], tolerance: 0.1 })).toEqual({
      point: target,
      snappedToTarget: true,
    });
    expect(snapPoint({ x: 1.6, y: 2 }, { grid: 0.25, targets: [target], tolerance: 0.1 }).snappedToTarget).toBe(false);
  });

  it('constrains angles to 45° steps', () => {
    const p = constrainAngle({ x: 0, y: 0 }, { x: 10, y: 1 });
    expect(p.y).toBeCloseTo(0);
    expect(p.x).toBeCloseTo(Math.hypot(10, 1));
  });

  it('computes bounds', () => {
    expect(boundsOf(square)).toEqual({ minX: 0, minY: 0, maxX: 4, maxY: 4 });
    expect(boundsOf([])).toBeNull();
  });
});
