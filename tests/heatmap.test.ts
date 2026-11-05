import { describe, expect, it } from 'vitest';

import { createLevel } from '../src/model/plan';
import { buildHeatmapMesh, interpolateIDW, rasterizeHeatmap, resolveStops, sampleStops } from '../src/viewer/heatmap';
import type { HeatmapLayer } from '../src/viewer/layers';

const square = (x: number, y: number, size: number) => [
  { x, y },
  { x: x + size, y },
  { x: x + size, y: y + size },
  { x, y: y + size },
];

describe('interpolateIDW', () => {
  const points = [
    { levelId: 'l', position: { x: 0, y: 0 }, value: 0 },
    { levelId: 'l', position: { x: 10, y: 0 }, value: 100 },
  ];

  it('returns exact values at the points and the mean halfway between equal-weight points', () => {
    expect(interpolateIDW(points, { x: 0, y: 0 })).toBe(0);
    expect(interpolateIDW(points, { x: 10, y: 0 })).toBe(100);
    expect(interpolateIDW(points, { x: 5, y: 0 })).toBeCloseTo(50);
  });

  it('weights nearer points more', () => {
    expect(interpolateIDW(points, { x: 2, y: 0 })!).toBeLessThan(20);
  });

  it('returns null beyond maxDistance', () => {
    expect(interpolateIDW(points, { x: 5, y: 50 }, 2, 10)).toBeNull();
  });
});

describe('color stops', () => {
  const stops = resolveStops([
    { value: 100, color: '#ffffff' },
    { value: 0, color: '#000000' }, // unsorted on purpose
  ]);

  it('interpolates in sRGB bytes and clamps outside the range', () => {
    expect(sampleStops(stops, 50).map(Math.round)).toEqual([128, 128, 128]);
    expect(sampleStops(stops, -10)).toEqual([0, 0, 0]);
    expect(sampleStops(stops, 500)).toEqual([255, 255, 255]);
  });
});

describe('rasterizeHeatmap', () => {
  const level = createLevel({
    id: 'l',
    rooms: [{ id: 'r', name: 'Room', points: square(0, 0, 2) }],
  });
  const layer: HeatmapLayer = {
    id: 'h',
    type: 'heatmap',
    points: [{ levelId: 'l', position: { x: 1, y: 1 }, value: 10 }],
    colorStops: [
      { value: 0, color: '#0000ff' },
      { value: 10, color: '#ff0000' },
    ],
    resolution: 0.5,
    opacity: 1,
  };

  it('covers the rooms bounds with opaque, correctly colored cells', () => {
    const raster = rasterizeHeatmap(level, layer)!;
    expect(raster).toMatchObject({ width: 4, height: 4, minX: 0, minY: 0, cellSize: 0.5 });
    expect([...raster.data.slice(0, 4)]).toEqual([255, 0, 0, 255]);
  });

  it('leaves cells outside rooms transparent when clipping', () => {
    const lShaped = createLevel({
      id: 'l',
      rooms: [
        { id: 'a', name: 'A', points: square(0, 0, 2) },
        { id: 'b', name: 'B', points: square(2, 2, 2) },
      ],
    });
    const raster = rasterizeHeatmap(lShaped, layer)!;
    // Cell (row 0, last column) lies at x≈3.75, y≈0.25: outside both rooms.
    expect(raster.data[(0 * raster.width + raster.width - 1) * 4 + 3]).toBe(0);
    // Cell at x≈3.75, y≈3.75 is inside room B.
    expect(raster.data[((raster.height - 1) * raster.width + raster.width - 1) * 4 + 3]).toBe(255);
  });

  it('returns null for levels without points', () => {
    expect(rasterizeHeatmap({ ...level, id: 'other' }, layer)).toBeNull();
  });

  it('builds a flat, non-pickable mesh over the raster area', () => {
    const mesh = buildHeatmapMesh(rasterizeHeatmap(level, layer)!, 0.05);
    expect(mesh.position.toArray()).toEqual([1, 0.05, 1]);
    const hits: unknown[] = [];
    mesh.raycast({} as never, hits as never);
    expect(hits).toHaveLength(0);
  });
});
