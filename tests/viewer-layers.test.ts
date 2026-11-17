import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import { createSamplePlan } from '../src/samples';
import { buildHighlight, resolveFocus } from '../src/viewer/focus';
import { fillHeatmap, heatmapGrid, heatmapPointsOn, rasterizeHeatmap } from '../src/viewer/heatmap';
import type { HeatmapLayer, PointLayer } from '../src/viewer/layers';
import { PointLayerView } from '../src/viewer/pointLayer';

const LEVELS = new Set(['level_ground', 'level_first']);
const layer = (points: PointLayer['points'], extra: Partial<PointLayer> = {}): PointLayer => ({
  id: 'sensors',
  type: 'points',
  points,
  label: (p) => `${p.data?.value} ppm`,
  ...extra,
});
const sensor = (id: string, value: number, extra: Partial<PointLayer['points'][number]> = {}) => ({
  id,
  levelId: 'level_ground',
  position: { x: 2, y: 3 },
  data: { value },
  ...extra,
});

function meshes(view: PointLayerView) {
  const out: THREE.Mesh[] = [];
  for (const group of view.groups.values()) group.traverse((o) => (o as THREE.Mesh).isMesh && o.userData.pick && out.push(o as THREE.Mesh));
  return out;
}
const labels = (view: PointLayerView) =>
  [...view.groups.values()].flatMap((g) => g.children.filter((c) => c.name === 'point-label').map((c) => (c as unknown as { element: HTMLElement }).element.textContent));

describe('PointLayerView', () => {
  it('updates points in place, matched by id', () => {
    const view = new PointLayerView('sensors');
    view.sync(layer([sensor('a', 400), sensor('b', 900, { position: { x: 5, y: 1 } })]), LEVELS, '#f97316');
    const [a] = meshes(view);
    expect(labels(view)).toEqual(['400 ppm', '900 ppm']);

    view.sync(layer([sensor('a', 450, { color: '#ff0000', position: { x: 4, y: 3 } }), sensor('b', 950, { position: { x: 5, y: 1 } })]), LEVELS, '#f97316');
    const [a2] = meshes(view);
    expect(a2).toBe(a); // same object: no rebuild
    expect(a2!.position.x).toBe(4);
    expect((a2!.material as THREE.MeshStandardMaterial).color.getHexString()).toBe('ff0000');
    expect(labels(view)).toEqual(['450 ppm', '950 ppm']);
  });

  it('adds and removes points, rings and labels', () => {
    const view = new PointLayerView('sensors');
    view.sync(layer([sensor('a', 1), sensor('b', 2)]), LEVELS, '#f97316');
    view.sync(layer([sensor('b', 2, { ring: '#dc2626' }), sensor('c', 3, { levelId: 'level_first' })]), LEVELS, '#f97316');
    expect(view.size).toBe(2);
    expect(meshes(view).map((m) => m.userData.pick.id).sort()).toEqual(['b', 'c']);
    const ring = view.groups.get('level_ground')!.children.find((c) => (c as THREE.Mesh).isMesh && !c.userData.pick) as THREE.Mesh;
    expect((ring.material as THREE.MeshBasicMaterial).color.getHexString()).toBe('dc2626');

    view.sync(layer([sensor('b', 2), sensor('c', 3, { levelId: 'level_first' })], { showLabels: false }), LEVELS, '#f97316');
    expect(view.groups.get('level_ground')!.children.filter((c) => !c.userData.pick)).toHaveLength(0); // ring and label gone
    expect(labels(view)).toEqual([]);
  });

  it('moves a point to another level and skips unknown levels', () => {
    const view = new PointLayerView('sensors');
    view.sync(layer([sensor('a', 1), sensor('x', 1, { levelId: 'nope' })]), LEVELS, '#f97316');
    expect(view.size).toBe(1);
    view.sync(layer([sensor('a', 1, { levelId: 'level_first' })]), LEVELS, '#f97316');
    expect(view.pointPosition('a')?.levelId).toBe('level_first');
    expect(meshes(view)[0]!.userData.pick.levelId).toBe('level_first');
    expect(view.groups.get('level_ground')!.children).toHaveLength(0);
  });

  it('draws shapes as solids in 3D and flat, pickable glyphs in 2D, swapping geometry in place', () => {
    const view = new PointLayerView('sensors');
    view.sync(layer([sensor('a', 1), sensor('b', 2, { shape: 'cone' })], { shape: 'box' }), LEVELS, '#f97316');
    const [a, b] = meshes(view);
    expect(a!.geometry).toBeInstanceOf(THREE.BoxGeometry); // layer default
    expect(b!.geometry).toBeInstanceOf(THREE.ConeGeometry); // per-point override
    expect(view.pointShape('a')).toBe('box');

    view.sync(layer([sensor('a', 1, { shape: 'diamond' }), sensor('b', 2, { shape: 'cone' })], { shape: 'box' }), LEVELS, '#f97316');
    expect(meshes(view)[0]).toBe(a); // same mesh, new geometry
    expect(a!.geometry).toBeInstanceOf(THREE.OctahedronGeometry);

    view.setMode('2d');
    expect(a!.geometry).toBeInstanceOf(THREE.ShapeGeometry);
    const box = new THREE.Box3().setFromBufferAttribute(a!.geometry.getAttribute('position') as THREE.BufferAttribute);
    expect(box.max.y - box.min.y).toBeLessThan(1e-6); // flat
    a!.updateMatrixWorld();
    const down = new THREE.Raycaster(new THREE.Vector3(2.03, 10, 3.01), new THREE.Vector3(0, -1, 0));
    expect(down.intersectObject(a!)[0]?.face?.normal.y).toBeCloseTo(1); // faces up, toward the top-down camera

    // The cone glyph is a triangle pointing to screen-up (plan -y = world -z).
    const pos = b!.geometry.getAttribute('position') as THREE.BufferAttribute;
    const zs = Array.from({ length: pos.count }, (_, i) => pos.getZ(i));
    expect(Math.min(...zs)).toBeCloseTo(-1.2);
    expect(Math.max(...zs)).toBeCloseTo(0.75);

    view.sync(layer([sensor('a', 1, { shape: 'nonsense' as never })]), LEVELS, '#f97316');
    expect(view.pointShape('a')).toBe('sphere'); // unknown shapes fall back to the default
    expect(a!.geometry).toBeInstanceOf(THREE.CircleGeometry);
    view.setMode('3d');
    expect(a!.geometry).toBeInstanceOf(THREE.SphereGeometry);
  });

  it('hides a layer (points, labels, beams) without rebuilding', () => {
    const view = new PointLayerView('sensors');
    view.sync(layer([sensor('a', 1, { beam: 'red' })]), LEVELS, '#f97316');
    const [mesh] = meshes(view);
    view.sync(layer([sensor('a', 2, { beam: 'red' })], { visible: false }), LEVELS, '#f97316');
    expect(meshes(view)[0]).toBe(mesh);
    expect([...view.groups.values()].every((g) => !g.visible)).toBe(true);
    expect(labels(view)).toEqual(['2 ppm']); // still updated while hidden
    expect(view.hasBeams(LEVELS)).toBe(false); // no animation frames for hidden beams
    // Groups created while hidden start hidden.
    view.sync(layer([sensor('a', 2), sensor('c', 3, { levelId: 'level_first' })], { visible: false }), LEVELS, '#f97316');
    expect(view.groups.get('level_first')!.visible).toBe(false);
    view.sync(layer([sensor('a', 2, { beam: 'red' })]), LEVELS, '#f97316');
    expect([...view.groups.values()].every((g) => g.visible)).toBe(true);
    expect(view.hasBeams(LEVELS)).toBe(true);
  });

  it('adds, animates and removes alert beams', () => {
    const beams = (v: PointLayerView) => [...v.groups.values()].flatMap((g) => g.children.filter((c) => c.name === 'point-beam')) as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>[];
    const view = new PointLayerView('sensors');
    const ground = new Set(['level_ground']);
    view.sync(layer([sensor('a', 1), sensor('b', 2)]), LEVELS, '#f97316');
    expect(view.hasBeams(LEVELS)).toBe(false);

    view.sync(layer([sensor('a', 1, { beam: '#dc2626' }), sensor('b', 2)]), LEVELS, '#f97316', new Map([['level_ground', 4]]));
    const [column, pulse] = beams(view);
    expect(column!.material.color.getHexString()).toBe('dc2626');
    expect(column!.scale.y).toBeCloseTo(3.98); // floor to the level's wall height
    expect(column!.raycast(new THREE.Raycaster(), [])).toBeUndefined();
    expect(view.hasBeams(ground)).toBe(true);
    expect(view.hasBeams(new Set(['level_first']))).toBe(false); // not on a shown level

    // The pulse expands and fades over one period.
    view.updateBeams(0);
    const start = { scale: pulse!.scale.x, opacity: pulse!.material.opacity };
    view.updateBeams(1200);
    expect(pulse!.scale.x).toBeGreaterThan(start.scale);
    expect(pulse!.material.opacity).toBeLessThan(start.opacity);

    view.setMode('2d');
    expect(column!.visible).toBe(false); // 2D: ring only
    expect(pulse!.visible).toBe(true);

    view.sync(layer([sensor('a', 1, { beam: null }), sensor('b', 2)]), LEVELS, '#f97316');
    expect(beams(view)).toEqual([]);
    expect(view.hasBeams(LEVELS)).toBe(false);

    view.sync(layer([sensor('b', 2, { beam: 'red' })]), LEVELS, '#f97316');
    view.sync(layer([]), LEVELS, '#f97316'); // point removed: its beam goes too
    expect(beams(view)).toEqual([]);
    expect(view.hasBeams(LEVELS)).toBe(false);
  });
});

describe('heatmap grid cache', () => {
  it('fills the same pixels as a full rasterization', () => {
    const level = createSamplePlan().levels[0]!;
    const hm: HeatmapLayer = {
      id: 'co2',
      type: 'heatmap',
      points: [
        { levelId: level.id, position: { x: 2, y: 2 }, value: 400 },
        { levelId: level.id, position: { x: 10, y: 6 }, value: 1400 },
      ],
      colorStops: [
        { value: 400, color: '#22c55e' },
        { value: 1400, color: '#ef4444' },
      ],
      resolution: 0.5,
    };
    const points = heatmapPointsOn(hm, level.id);
    const grid = heatmapGrid(level, hm, points)!;
    const buffer = new Uint8Array(grid.width * grid.height * 4).fill(7);
    expect(fillHeatmap(grid, points, hm, buffer)).toBe(buffer);
    expect([...buffer]).toEqual([...rasterizeHeatmap(level, hm)!.data]);
  });
});

describe('focus', () => {
  const plan = createSamplePlan();
  const noPoints = () => null;

  it('resolves entities, positions and points', () => {
    expect(resolveFocus(plan, { kind: 'room', id: 'room_meeting' }, noPoints)).toMatchObject({ levelId: 'level_ground', center: { x: 3, y: 2.5 }, shape: { type: 'outline', closed: true } });
    const wall = plan.levels[0]!.walls[0]!;
    expect(resolveFocus(plan, { kind: 'wall', id: wall.id }, noPoints)?.shape).toMatchObject({ type: 'outline', closed: false, width: wall.thickness + 0.2 });
    expect(resolveFocus(plan, { kind: 'position', levelId: 'level_first', position: { x: 1, y: 2 } }, noPoints)).toMatchObject({ levelId: 'level_first', shape: { type: 'ring' } });
    expect(resolveFocus(plan, { kind: 'point', layerId: 's', id: 'a' }, () => ({ levelId: 'level_first', position: { x: 4, y: 4 }, height: 1, radius: 0.25 }))).toMatchObject({
      center: { x: 4, y: 4 },
      height: 1,
      shape: { type: 'ring', radius: 0.8 },
    });
  });

  it('returns null for missing targets', () => {
    expect(resolveFocus(plan, { kind: 'room', id: 'nope' }, noPoints)).toBeNull();
    expect(resolveFocus(plan, { kind: 'room', id: 'room_meeting', levelId: 'level_first' }, noPoints)).toBeNull();
    expect(resolveFocus(plan, { kind: 'position', levelId: 'nope', position: { x: 0, y: 0 } }, noPoints)).toBeNull();
    expect(resolveFocus(plan, { kind: 'point', layerId: 's', id: 'a' }, noPoints)).toBeNull();
  });

  it('builds a flat, unpickable highlight around the target', () => {
    const focus = resolveFocus(plan, { kind: 'room', id: 'room_meeting' }, noPoints)!;
    const mesh = buildHighlight(focus, new THREE.Color('#facc15'));
    const box = new THREE.Box3().setFromObject(mesh);
    expect(box.min.x).toBeLessThan(0);
    expect(box.max.x).toBeGreaterThan(6);
    expect(box.max.y - box.min.y).toBeLessThan(1e-6);
    const raycaster = new THREE.Raycaster(new THREE.Vector3(3, 5, 0), new THREE.Vector3(0, -1, 0));
    expect(raycaster.intersectObject(mesh)).toEqual([]);
  });
});

describe('PointLayerView: per-point elevation and dragging', () => {
  const parts = (view: PointLayerView) => {
    const children = view.groups.get('level_ground')!.children;
    return {
      mesh: children.find((c) => c.userData.pick)!,
      ring: children.find((c) => (c as THREE.Mesh).isMesh && !c.userData.pick && c.name !== 'point-beam')!,
      label: children.find((c) => c.name === 'point-label')!,
      beams: children.filter((c) => c.name === 'point-beam'),
    };
  };

  it('uses the point elevation over the layer elevation, in place', () => {
    const view = new PointLayerView('sensors');
    view.sync(layer([sensor('a', 1), sensor('b', 2, { elevation: 2.4, ring: 'red' })], { elevation: 1.5, size: 0.2 }), LEVELS, '#f97316');
    const [a, b] = meshes(view);
    expect(a!.position.y).toBe(1.5); // layer default
    expect(b!.position.y).toBe(2.4);
    const { ring, label } = parts(view);
    expect(ring.position.y).toBe(2.4);
    expect(view.pointPosition('b')!.position.y).toBe(2.4); // what focus() highlights

    view.sync(layer([sensor('a', 1, { elevation: 0 }), sensor('b', 2, { elevation: 0.5, ring: 'red' })], { elevation: 1.5, size: 0.2 }), LEVELS, '#f97316');
    expect(meshes(view)[0]).toBe(a); // same objects
    expect(a!.position.y).toBe(0); // 0 is a height, not "unset"
    expect(b!.position.y).toBe(0.5);
    expect(parts(view).ring.position.y).toBe(0.5);
    expect(label.position.y).toBeCloseTo(0 + 0.2 * 1.25 + 0.05); // a's label follows its height

    view.sync(layer([sensor('a', 1)]), LEVELS, '#f97316');
    expect(a!.position.y).toBe(1); // back to the default
  });

  it('extends the beam up to a point above the wall height', () => {
    const view = new PointLayerView('sensors');
    const heights = new Map([['level_ground', 3]]);
    view.sync(layer([sensor('a', 1, { beam: 'red', elevation: 2, size: 0.2 })]), LEVELS, '#f97316', heights);
    const [column] = parts(view).beams;
    expect(column!.scale.y).toBeCloseTo(2.98); // wall height, as without an elevation
    view.sync(layer([sensor('a', 1, { beam: 'red', elevation: 5, size: 0.2 })]), LEVELS, '#f97316', heights);
    expect(column!.scale.y).toBeCloseTo(5.18); // reaches the top of the point
    expect(column!.position.y).toBeCloseTo(0.02); // still from the floor
  });

  it("draws no shape for 'none' but keeps the label, ring and beam; the point is unpickable", () => {
    const view = new PointLayerView('sensors');
    view.sync(layer([sensor('a', 7, { shape: 'none', ring: 'red', beam: 'red', elevation: 2 })], { size: 0.2 }), LEVELS, '#f97316');
    const { mesh, ring, label, beams } = parts(view);
    expect(mesh.visible).toBe(false); // the viewer picks visible objects only
    expect([ring.visible, label.visible, beams.length]).toEqual([true, true, 2]);
    expect(labels(view)).toEqual(['7 ppm']);
    expect(label.position.y).toBeCloseTo(2 + 0.2 * 1.25 + 0.05);
    expect(view.pointPosition('a')!.position.toArray()).toEqual([2, 2, 3]); // focus() still finds it

    view.sync(layer([sensor('a', 7, { shape: 'cone' })]), LEVELS, '#f97316');
    expect(mesh.visible).toBe(true);
    expect((mesh as THREE.Mesh).geometry).toBeInstanceOf(THREE.ConeGeometry);

    // Layer default 'none'; a point's own shape wins, an unknown one falls back to the layer's.
    view.sync(layer([sensor('a', 7), sensor('b', 8, { shape: 'box' }), sensor('c', 9, { shape: 'bogus' as never })], { shape: 'none' }), LEVELS, '#f97316');
    expect(meshes(view).map((m) => m.visible)).toEqual([false, true, false]);
  });

  it('is draggable per layer, overridden per point; off by default', () => {
    const view = new PointLayerView('sensors');
    view.sync(layer([sensor('a', 1), sensor('b', 2, { draggable: true })]), LEVELS, '#f97316');
    expect([view.isDraggable('a'), view.isDraggable('b'), view.isDraggable('nope')]).toEqual([false, true, false]);
    view.sync(layer([sensor('a', 1), sensor('b', 2, { draggable: false })], { draggable: true }), LEVELS, '#f97316');
    expect([view.isDraggable('a'), view.isDraggable('b')]).toEqual([true, false]);
  });

  it('moves a point with its ring, label and beam, keeping heights; sync puts it back', () => {
    const view = new PointLayerView('sensors');
    const l = layer([sensor('a', 1, { ring: 'red', beam: 'red', elevation: 2 })], { size: 0.2 });
    view.sync(l, LEVELS, '#f97316');
    const { mesh, ring, label, beams } = parts(view);
    const labelZ = label.position.z;
    const heights = [mesh, ring, label, ...beams].map((o) => o.position.y);

    expect(view.movePoint('a', 6, 7.5)).toBe(true);
    expect(view.movePoint('nope', 0, 0)).toBe(false);
    for (const o of [mesh, ring, ...beams]) expect([o.position.x, o.position.z]).toEqual([6, 7.5]);
    expect(label.position.x).toBe(6);
    expect(label.position.z).toBeCloseTo(labelZ + 4.5); // keeps its offset from the point
    expect([mesh, ring, label, ...beams].map((o) => o.position.y)).toEqual(heights);
    expect(view.pointPosition('a')!.position.toArray()).toEqual([6, 2, 7.5]);

    view.sync(l, LEVELS, '#f97316'); // the layer is the source of truth
    expect([mesh.position.x, mesh.position.z, label.position.z]).toEqual([2, 3, labelZ]);
  });
});
