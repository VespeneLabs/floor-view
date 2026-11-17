import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { createLevel } from '../src/model/plan';
import type { Wall } from '../src/model/types';
import { buildLevel, disposeObject, setWallHeights } from '../src/viewer/sceneBuilder';

const wall = (id: string, extra: Partial<Wall> = {}): Wall => ({ id, start: { x: 0, y: 0 }, end: { x: 4, y: 0 }, thickness: 0.2, ...extra });
const box = (mesh: THREE.Object3D) => {
  mesh.parent?.updateMatrixWorld(true);
  return new THREE.Box3().setFromObject(mesh);
};

describe('wall display', () => {
  const level = () => createLevel({ elevation: 3, height: 2.8, walls: [wall('a'), wall('b', { height: 1.2 }), wall('c', { height: 0.05 })] });

  it('draws walls as low stubs standing on the floor, ignoring level and wall heights', () => {
    const built = buildLevel(level());
    setWallHeights(built, 0.1);
    for (const id of ['a', 'b']) {
      const b = box(built.walls.get(id)!);
      expect(b.min.y).toBeCloseTo(3);
      expect(b.max.y).toBeCloseTo(3.1);
    }
    // Footprint unchanged.
    const a = box(built.walls.get('a')!);
    expect(a.min.x).toBeCloseTo(-0.1);
    expect(a.max.x).toBeCloseTo(4.1);
    expect(a.max.z - a.min.z).toBeCloseTo(0.2);
    disposeObject(built.group);
  });

  it('never raises a wall that is lower than the stub height', () => {
    const built = buildLevel(level());
    setWallHeights(built, 0.1);
    expect(box(built.walls.get('c')!).max.y).toBeCloseTo(3.05);
    disposeObject(built.group);
  });

  it('restores the real heights and keeps walls pickable', () => {
    const built = buildLevel(level());
    setWallHeights(built, 0.1);
    const mesh = built.walls.get('a')!;
    expect(mesh.visible).toBe(true);
    expect(mesh.userData.pick).toEqual({ kind: 'wall', id: 'a', levelId: built.levelId });
    expect(mesh.userData.wallHeight).toBe(2.8);

    built.group.updateMatrixWorld(true);
    const ray = new THREE.Raycaster(new THREE.Vector3(2, 10, 0), new THREE.Vector3(0, -1, 0));
    expect(ray.intersectObject(mesh)[0]?.point.y).toBeCloseTo(3.1);

    setWallHeights(built, null);
    expect(box(mesh).max.y).toBeCloseTo(5.8);
    expect(box(built.walls.get('b')!).max.y).toBeCloseTo(4.2);
    expect(mesh.scale.y).toBe(1);
    disposeObject(built.group);
  });
});
