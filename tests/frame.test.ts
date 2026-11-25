import { describe, expect, it } from 'vitest';

import { createLevel, createPlan } from '../src/model/plan';
import type { FloorPlan } from '../src/model/types';
import { AUTO_FRAME_ELEVATION, AUTO_FRAME_HIGH_ELEVATION, DEFAULT_FRAME_MIN_SPAN, autoFrameAngle, autoFrameCandidates, frameAngleOffset, framePixelsPerMeter, lerpOffset, lerpZoom, resolveFrame } from '../src/viewer/frame';
import type { PointLookup } from '../src/viewer/focus';

/** Two levels; markers are rings of radius 0.7, sensor points (radius 0.2) rings of 0.7 too. */
function plan(): FloorPlan {
  const p = createPlan();
  p.levels = [
    createLevel({
      id: 'g',
      markers: [
        { id: 'a', name: 'A', position: { x: 2, y: 3 } },
        { id: 'b', name: 'B', position: { x: 12, y: 7 } },
      ],
    }),
    createLevel({ id: 'u', elevation: 3, markers: [{ id: 'c', name: 'C', position: { x: 5, y: 5 } }] }),
  ];
  return p;
}

const points: PointLookup = (layerId, id) => (layerId === 'sensors' && id === 's1' ? { levelId: 'g', position: { x: 4, y: 4 }, height: 1.2, radius: 0.2 } : null);

describe('resolveFrame', () => {
  it('frames one target with its ring', () => {
    const frame = resolveFrame(plan(), [{ kind: 'marker', id: 'a' }], points)!;
    expect(frame.levelId).toBe('g');
    expect(frame.first).toEqual({ kind: 'marker', id: 'a' });
    expect(frame.min).toEqual({ x: 1.3, y: 2.3 });
    expect(frame.max).toEqual({ x: 2.7, y: 3.7 });
  });

  it('spans several targets on the same level', () => {
    const frame = resolveFrame(plan(), [{ kind: 'marker', id: 'a' }, { kind: 'marker', id: 'b' }], points)!;
    expect(frame.targets).toHaveLength(2);
    expect(frame.min).toEqual({ x: 1.3, y: 2.3 });
    expect(frame.max).toEqual({ x: 12.7, y: 7.7 });
  });

  it('keeps the level of the first target that exists and leaves out the others', () => {
    const frame = resolveFrame(plan(), [{ kind: 'marker', id: 'missing' }, { kind: 'marker', id: 'c' }, { kind: 'marker', id: 'a' }], points)!;
    expect(frame.levelId).toBe('u');
    expect(frame.first).toEqual({ kind: 'marker', id: 'c' });
    expect(frame.targets).toHaveLength(1);
  });

  it('takes data points from the point lookup, with their height', () => {
    const frame = resolveFrame(plan(), [{ kind: 'point', layerId: 'sensors', id: 's1' }], points)!;
    expect(frame.levelId).toBe('g');
    expect(frame.height).toBe(1.2);
    expect(frame.min.x).toBeCloseTo(3.3);
  });

  it('is null when no target exists', () => {
    expect(resolveFrame(plan(), [], points)).toBeNull();
    expect(resolveFrame(plan(), [{ kind: 'point', layerId: 'sensors', id: 'nope' }], points)).toBeNull();
  });
});

describe('framePixelsPerMeter', () => {
  const view = { width: 800, height: 400 };

  it('fits a large box inside the padding', () => {
    // 40 m wide: (800 - 2·50) / 40 = 17.5 px/m; 10 m high: (400 - 100) / 10 = 30 px/m.
    expect(framePixelsPerMeter({ width: 40, height: 10 }, view, 50, 8)).toBe(17.5);
  });

  it('stops at the minimum span for a small box', () => {
    // A 1 m box would fit at 200 px/m; the 8 m span across the 400 px side caps it at 50 px/m.
    expect(framePixelsPerMeter({ width: 1, height: 1 }, view, 50, 8)).toBe(50);
  });

  it('handles a zero-size box', () => {
    expect(framePixelsPerMeter({ width: 0, height: 0 }, view, 50, 10)).toBe(40);
    expect(framePixelsPerMeter({ width: 0, height: 0 }, view, 50, 0)).toBe(400 / DEFAULT_FRAME_MIN_SPAN);
  });

  it('never goes below one pixel of room when the padding is larger than the view', () => {
    expect(framePixelsPerMeter({ width: 10, height: 10 }, { width: 50, height: 50 }, 100, 0)).toBe(0.1);
  });
});

describe('lerpZoom', () => {
  it('moves on a log scale', () => {
    expect(lerpZoom(1, 4, 0)).toBe(1);
    expect(lerpZoom(1, 4, 0.5)).toBe(2);
    expect(lerpZoom(1, 4, 1)).toBe(4);
    expect(lerpZoom(4, 1, 0.5)).toBe(2);
  });
});

describe('autoFrameAngle', () => {
  it('looks across the target toward the middle of the level', () => {
    expect(autoFrameAngle({ x: 0, y: 0 }, { x: 5, y: 0 })).toEqual({ azimuth: 0, elevation: AUTO_FRAME_ELEVATION });
    expect(autoFrameAngle({ x: 0, y: 0 }, { x: 0, y: -5 }).azimuth).toBeCloseTo(-90);
    expect(autoFrameAngle({ x: 10, y: 10 }, { x: 5, y: 15 }).azimuth).toBeCloseTo(135);
  });

  it('takes the default view side for a target in the middle', () => {
    const angle = autoFrameAngle({ x: 3, y: 3 }, { x: 3.2, y: 3.1 });
    expect(angle.azimuth).toBeCloseTo((Math.atan2(0.9, 0.55) * 180) / Math.PI);
    expect(angle.elevation).toBe(AUTO_FRAME_ELEVATION);
  });
});

describe('frameAngleOffset', () => {
  it('places the camera at the distance, azimuth and elevation', () => {
    const o = frameAngleOffset({ azimuth: 90, elevation: 30 }, 10);
    expect(Math.hypot(o.x, o.y, o.z)).toBeCloseTo(10);
    expect(o.x).toBeCloseTo(0);
    expect(o.y).toBeCloseTo(5);
    expect(o.z).toBeCloseTo(Math.cos(Math.PI / 6) * 10);
  });

  it('never looks straight down or along the floor', () => {
    expect(frameAngleOffset({ azimuth: 0, elevation: 90 }, 10).x).toBeGreaterThan(0);
    expect(frameAngleOffset({ azimuth: 0, elevation: 0 }, 10).y).toBeGreaterThan(0);
  });
});

describe('lerpOffset', () => {
  const from = frameAngleOffset({ azimuth: 170, elevation: 40 }, 20);
  const to = frameAngleOffset({ azimuth: -170, elevation: 20 }, 5);

  it('starts and ends at the offsets', () => {
    for (const [t, v] of [[0, from], [1, to]] as const) {
      const o = lerpOffset(from, to, t);
      expect(o.x).toBeCloseTo(v.x);
      expect(o.y).toBeCloseTo(v.y);
      expect(o.z).toBeCloseTo(v.z);
    }
  });

  it('swings the short way around and scales the distance on a log scale', () => {
    const mid = lerpOffset(from, to, 0.5);
    expect((Math.atan2(mid.z, mid.x) * 180) / Math.PI).toBeCloseTo(180);
    expect(Math.hypot(mid.x, mid.y, mid.z)).toBeCloseTo(10);
    expect((Math.asin(mid.y / 10) * 180) / Math.PI).toBeCloseTo(30);
  });
});

describe('autoFrameCandidates', () => {
  it('tries the preferred side first, then the nearest sides left and right', () => {
    const c = autoFrameCandidates({ azimuth: 10, elevation: AUTO_FRAME_ELEVATION });
    expect(c.slice(0, 5).map((a) => a.azimuth)).toEqual([10, 40, -20, 70, -50]);
    expect(c.slice(0, 12).every((a) => a.elevation === AUTO_FRAME_ELEVATION)).toBe(true);
  });

  it('covers every side once per elevation, then tries again from higher up', () => {
    const c = autoFrameCandidates({ azimuth: 0, elevation: AUTO_FRAME_ELEVATION });
    expect(c).toHaveLength(24);
    const sides = new Set(c.slice(0, 12).map((a) => ((a.azimuth % 360) + 360) % 360));
    expect(sides.size).toBe(12);
    expect(c.slice(12).every((a) => a.elevation === AUTO_FRAME_HIGH_ELEVATION)).toBe(true);
    expect(c[12]!.azimuth).toBe(0);
  });

  it('does not go lower for a preferred angle already high up', () => {
    expect(autoFrameCandidates({ azimuth: 0, elevation: 70 })).toHaveLength(12);
  });
});
