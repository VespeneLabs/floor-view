import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { buildLevel, buildPlan, buildPointLayer, disposeObject } from '../src/viewer/sceneBuilder';
import { createSamplePlan as samplePlan } from '../src/samples';

describe('sceneBuilder', () => {
  it('builds one mesh per wall, room and marker, tagged for picking', () => {
    const plan = samplePlan();
    const built = buildPlan(plan);
    expect(built).toHaveLength(2);
    const ground = built[0]!;
    const level = plan.levels[0]!;
    expect(ground.walls.size).toBe(level.walls.length);
    expect(ground.rooms.size).toBe(level.rooms.length);
    expect(ground.markers.size).toBe(level.markers.length);
    expect(ground.rooms.get('room_lobby')!.userData.pick).toEqual({ kind: 'room', id: 'room_lobby', levelId: 'level_ground' });
    expect(built[1]!.group.position.y).toBe(3);
  });

  it('places walls in plan coordinates (plan y -> world z)', () => {
    const level = samplePlan().levels[0]!;
    level.walls = [{ id: 'w', start: { x: 2, y: 0 }, end: { x: 2, y: 6 }, thickness: 0.2 }];
    const mesh = buildLevel(level).walls.get('w')!;
    const box = new THREE.Box3().setFromObject(mesh);
    expect(box.min.x).toBeCloseTo(1.9);
    expect(box.max.x).toBeCloseTo(2.1);
    expect(box.min.z).toBeCloseTo(-0.1); // extended by half the thickness at each end
    expect(box.max.z).toBeCloseTo(6.1);
    expect(box.max.y).toBeCloseTo(level.height);
  });

  it('lays room floors flat on the XZ plane', () => {
    const level = samplePlan().levels[0]!;
    const mesh = buildLevel(level).rooms.get('room_meeting')!;
    const box = new THREE.Box3().setFromObject(mesh);
    expect(box.min.x).toBeCloseTo(0);
    expect(box.max.x).toBeCloseTo(6);
    expect(box.min.z).toBeCloseTo(0);
    expect(box.max.z).toBeCloseTo(5);
    expect(box.max.y - box.min.y).toBeCloseTo(0);
  });

  it('disposeObject detaches label elements nested inside a removed group', () => {
    const container = document.createElement('div');
    const group = new THREE.Group();
    const el = document.createElement('div');
    const label = new CSS2DObject(el);
    group.add(label);
    container.appendChild(el); // what CSS2DRenderer does when it renders the label
    disposeObject(group);
    expect(container.contains(el)).toBe(false);
  });

  it('groups point layers per level and skips unknown levels', () => {
    const groups = buildPointLayer(
      {
        id: 'sensors',
        type: 'points',
        points: [
          { id: 'a', levelId: 'l1', position: { x: 1, y: 2 } },
          { id: 'b', levelId: 'l1', position: { x: 3, y: 4 }, size: 0.5 },
          { id: 'c', levelId: 'missing', position: { x: 0, y: 0 } },
        ],
      },
      new Set(['l1']),
    );
    expect([...groups.keys()]).toEqual(['l1']);
    const meshes = groups.get('l1')!.children;
    expect(meshes).toHaveLength(2);
    expect(meshes[1]!.scale.x).toBe(0.5);
    expect(meshes[0]!.userData.pick).toMatchObject({ kind: 'point', layerId: 'sensors' });
  });
});
