import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { createLevel } from '../src/model/plan';
import { pointAlongPipeline } from '../src/model/pipeline';
import type { PipePoint, Pipeline } from '../src/model/types';
import { createPlan } from '../src/model/plan';
import { resolveFocus } from '../src/viewer/focus';
import { PipelineFlow, updatePipeWidths, worldPerPixel, type PipelineUserData } from '../src/viewer/pipelines';
import { buildLevel, DEFAULT_SCENE_COLORS, disposeObject } from '../src/viewer/sceneBuilder';

const pt = (x: number, y: number, z = 2.6): PipePoint => ({ x, y, z });
const pipe = (id: string, points: PipePoint[], extra: Partial<Pipeline> = {}): Pipeline => ({ id, name: id, points, diameter: 0.1, ...extra });

const meshes = (group: THREE.Object3D) => group.children.filter((c): c is THREE.Mesh => (c as THREE.Mesh).isMesh);
const isPipePart = (m: THREE.Mesh) => !m.userData.hitProxy && (m.geometry.type === 'CylinderGeometry' || m.geometry.type === 'SphereGeometry');

describe('pipelines in the scene', () => {
  it('builds a tube per segment with a joint at each bend, in level coordinates (plan y → world z, z → up)', () => {
    const level = createLevel({ elevation: 4, pipelines: [pipe('p', [pt(0, 0, 0.5), pt(0, 0), pt(6, 0), pt(6, 2)])] });
    const built = buildLevel(level);
    const group = built.pipelines.get('p')!;
    expect(group.parent).toBe(built.group);
    const parts = meshes(group).filter(isPipePart);
    expect(parts.filter((m) => m.geometry.type === 'CylinderGeometry')).toHaveLength(3);
    expect(parts.filter((m) => m.geometry.type === 'SphereGeometry')).toHaveLength(2);

    const tube = new THREE.Box3().setFromObject(parts.filter((m) => m.geometry.type === 'CylinderGeometry')[2]!);
    expect(tube.min.x).toBeCloseTo(5.95);
    expect(tube.max.z).toBeCloseTo(2);
    expect(tube.min.y).toBeCloseTo(2.55);
    expect(tube.max.y).toBeCloseTo(2.65);
    const riser = new THREE.Box3().setFromObject(parts[0]!);
    expect(riser.min.y).toBeCloseTo(0.5);
    expect(riser.max.y).toBeCloseTo(2.6);
    expect(group.userData.pipeline).toMatchObject({ id: 'p', baseColor: DEFAULT_SCENE_COLORS.pipe });

    // Thin pipes get an invisible, thicker hit cylinder per segment.
    const proxies = meshes(group).filter((m) => m.userData.hitProxy);
    expect(proxies).toHaveLength(3);
    expect(proxies[0]!.scale.x).toBe(0.15);
    expect((proxies[0]!.material as THREE.Material).colorWrite).toBe(false);
  });

  it('tags every part for picking and colors the pipe from the data or the default', () => {
    // (jsdom has no canvas, so only hex colors parse here; toThreeColor handles modern CSS in browsers.)
    const level = createLevel({ pipelines: [pipe('gas', [pt(0, 0), pt(4, 0)], { color: '#facc15' }), pipe('n2', [pt(0, 1), pt(4, 1)])] });
    const built = buildLevel(level, { ...DEFAULT_SCENE_COLORS, pipe: '#123456' });
    const group = built.pipelines.get('gas')!;
    for (const m of meshes(group)) expect(m.userData.pick).toEqual({ kind: 'pipeline', id: 'gas', levelId: level.id });
    const { material, baseColor } = group.userData.pipeline as PipelineUserData;
    expect(baseColor).toBe('#facc15');
    expect(material.color.getHexString()).toBe(new THREE.Color('#facc15').getHexString());
    expect((built.pipelines.get('n2')!.userData.pipeline as PipelineUserData).baseColor).toBe('#123456');
  });

  it('draws no floor supports, only the pipe', () => {
    const level = createLevel({ pipelines: [pipe('p', [pt(0, 0), pt(9, 0)])] });
    expect(meshes(buildLevel(level).pipelines.get('p')!).filter((m) => m.geometry.type === 'BoxGeometry')).toHaveLength(0);
  });

  it('adds a fitting where pipelines meet, on the pipeline that is met', () => {
    const level = createLevel({
      pipelines: [pipe('main', [pt(0, 0, 1), pt(10, 0, 1)]), pipe('branch', [pt(5, 0, 1), pt(5, 4, 1)], { diameter: 0.05 })],
    });
    const built = buildLevel(level);
    const spheres = (id: string) => meshes(built.pipelines.get(id)!).filter((m) => m.geometry.type === 'SphereGeometry');
    expect(spheres('branch')).toHaveLength(0);
    expect(spheres('main')).toHaveLength(1);
    expect(spheres('main')[0]!.position.toArray()).toEqual([5, 1, 0]);
    expect(spheres('main')[0]!.scale.x).toBeCloseTo(0.068);
  });

  it('disposes pipe geometries and materials with the level', () => {
    const level = createLevel({ pipelines: [pipe('p', [pt(0, 0), pt(4, 0)])] });
    const built = buildLevel(level);
    const { material } = built.pipelines.get('p')!.userData.pipeline as PipelineUserData;
    let disposed = false;
    material.addEventListener('dispose', () => (disposed = true));
    disposeObject(built.group);
    expect(disposed).toBe(true);
  });
});

describe('pipeline flow', () => {
  const p = pipe('p', [pt(0, 0, 0), pt(0, 0, 2), pt(4, 0, 2)]);

  it('finds points along a pipeline in 3D, clamped to its ends', () => {
    expect(pointAlongPipeline(p, 1)).toEqual({ x: 0, y: 0, z: 1 });
    expect(pointAlongPipeline(p, 3)).toEqual({ x: 1, y: 0, z: 2 });
    expect(pointAlongPipeline(p, -1)).toEqual({ x: 0, y: 0, z: 0 });
    expect(pointAlongPipeline(p, 99)).toEqual({ x: 4, y: 0, z: 2 });
  });

  it('spreads beads along the pipe and moves them in the flow direction', () => {
    const forward = new PipelineFlow(p, 'forward');
    const reverse = new PipelineFlow(p, 'reverse');
    expect(forward.group.children).toHaveLength(4); // 6 m / 1.5 m
    // Parked (reduced motion): half a spacing in from the start.
    expect(forward.group.children[0]!.position.toArray()).toEqual([0, 0.75, 0]);
    expect(reverse.group.children[0]!.position.toArray()).toEqual([3.25, 2, 0]);
    forward.update(1000); // 0.8 m on
    expect(forward.group.children[0]!.position.y).toBeCloseTo(0.8);
    reverse.update(1000);
    expect(reverse.group.children[0]!.position.x).toBeCloseTo(3.2);
  });
});

describe('pipe width on screen', () => {
  const level = createLevel({ pipelines: [pipe('p', [pt(0, 0, 1), pt(4, 0, 1), pt(4, 3, 1)], { diameter: 0.05 })] });
  const camera = (distance: number) => {
    const c = new THREE.PerspectiveCamera(45, 1, 0.1, 5000);
    c.position.set(2, 1 + distance, 0);
    c.lookAt(2, 1, 0);
    c.updateMatrixWorld();
    return c;
  };
  const parts = (group: THREE.Object3D) => meshes(group).filter(isPipePart);

  it('measures a pixel in world units for both cameras', () => {
    expect(worldPerPixel(camera(10), 10, 1000)).toBeCloseTo((20 * Math.tan(Math.PI / 8)) / 1000);
    const ortho = new THREE.OrthographicCamera(-10, 10, 5, -5, 0.1, 100);
    ortho.zoom = 2;
    expect(worldPerPixel(ortho, 123, 500)).toBeCloseTo(0.01);
  });

  it('thickens distant pipes to a minimum width and restores the real size up close', () => {
    const group = buildLevel(level).pipelines.get('p')!;
    const [tube, joint] = [parts(group)[0]!, parts(group).find((m) => m.geometry.type === 'SphereGeometry')!];
    updatePipeWidths(group, camera(2), 800, 2.5);
    expect(tube.scale.toArray()).toEqual([0.025, 4, 0.025]);

    const far = camera(200);
    updatePipeWidths(group, far, 800, 2.5);
    const expected = (2.5 * worldPerPixel(far, 200, 800)) / 2;
    expect(expected).toBeGreaterThan(0.025);
    expect(tube.scale.x).toBeCloseTo(expected);
    expect(tube.scale.y).toBe(4); // the length is untouched
    expect(joint.scale.x).toBeGreaterThan(0.025);
    expect(meshes(group).find((m) => m.userData.hitProxy)!.scale.x).toBe(0.15);

    updatePipeWidths(group, far, 800, 0);
    expect(tube.scale.x).toBe(0.025);
    expect(joint.scale.x).toBe(0.025);
  });

  it('keeps flow beads thicker than the pipe', () => {
    const flow = new PipelineFlow(level.pipelines[0]!, 'forward');
    const far = camera(200);
    updatePipeWidths(flow.group, far, 800, 2.5);
    expect(flow.group.children[0]!.scale.x).toBeGreaterThan((2.5 * worldPerPixel(far, 200, 800)) / 2);
  });
});

describe('pipeline focus', () => {
  it('centers on the middle of the pipe at its height and outlines its route', () => {
    const plan = createPlan();
    plan.levels[0]!.pipelines.push(pipe('p', [pt(0, 0, 0.5), pt(0, 0, 2.5), pt(6, 0, 2.5), pt(6, 2, 2.5)]));
    const focus = resolveFocus(plan, { kind: 'pipeline', id: 'p' }, () => null)!;
    expect(focus).toMatchObject({ levelId: plan.levels[0]!.id, center: { x: 3, y: 0 }, height: 2.5 });
    expect(focus.shape).toEqual({ type: 'outline', points: [{ x: 0, y: 0 }, { x: 6, y: 0 }, { x: 6, y: 2 }], closed: false, width: 0.1 + 0.2 });
    expect(resolveFocus(plan, { kind: 'pipeline', id: 'nope' }, () => null)).toBeNull();
  });

  it('rings a pipeline that is only a riser', () => {
    const plan = createPlan();
    plan.levels[0]!.pipelines.push(pipe('r', [pt(1, 1, 0), pt(1, 1, 3)]));
    expect(resolveFocus(plan, { kind: 'pipeline', id: 'r' }, () => null)).toMatchObject({ center: { x: 1, y: 1 }, height: 1.5, shape: { type: 'ring' } });
  });
});
