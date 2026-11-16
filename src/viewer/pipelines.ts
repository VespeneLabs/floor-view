import * as THREE from 'three';
import { pipelineJunctions, pipelineLength, pointAlongPipeline } from '../model/pipeline';
import type { Level, PipePoint, Pipeline } from '../model/types';
import { toThreeColor } from './color';

const RADIAL_SEGMENTS = 16;
/**
 * Minimum pick radius (m). Real pipes are a few cm thick, a pixel or two on screen, so each segment
 * also gets an invisible (no color, no depth) hit cylinder at least this thick, flagged
 * `userData.hitProxy`.
 */
export const PIPE_HIT_RADIUS = 0.15;
/** Default minimum on-screen pipe width in pixels (see `updatePipeWidths`). */
export const PIPE_MIN_PIXELS = 2.5;

/**
 * `userData.pipeScale` of a pipe part whose thickness follows the view (`updatePipeWidths`): its
 * real `radius` (m), whether it is a `tube` (scaled across, not along) and how much thicker than
 * the tube it is drawn (`factor`, e.g. tee bodies and flow beads).
 */
export interface PipeScale {
  radius: number;
  tube: boolean;
  factor: number;
}

/**
 * A pipeline's scene objects. `group.userData.pipeline` holds the shared pipe `material` and its
 * `baseColor` (the pipeline's color), so the viewer can tint the pipe in place.
 */
export interface PipelineUserData {
  id: string;
  material: THREE.MeshStandardMaterial;
  baseColor: string;
}

const UP = new THREE.Vector3(0, 1, 0);

/** Plan point (x, y, height z) to level-local world coordinates (x, z, y). */
function world(p: PipePoint): THREE.Vector3 {
  return new THREE.Vector3(p.x, p.z, p.y);
}

/**
 * Build the pipelines of a level: a cylinder per segment, a sphere at each bend (a rounded elbow),
 * and a larger sphere at tees and joints between pipelines. Every mesh is pickable as
 * `{ kind: 'pipeline' }`. Pure: no DOM.
 */
export function buildPipelines(level: Level, defaultColor: string, pick: (mesh: THREE.Object3D, pipelineId: string) => void): Map<string, THREE.Group> {
  const groups = new Map<string, THREE.Group>();

  for (const pipe of level.pipelines) {
    if (pipe.points.length < 2) continue;
    const r = pipe.diameter / 2;
    const baseColor = pipe.color ?? defaultColor;
    const material = new THREE.MeshStandardMaterial({ color: toThreeColor(baseColor), roughness: 0.45, metalness: 0.15 });
    // One unit geometry each, scaled per mesh (disposeObject frees them once).
    const cylinder = new THREE.CylinderGeometry(1, 1, 1, RADIAL_SEGMENTS, 1);
    const sphere = new THREE.SphereGeometry(1, RADIAL_SEGMENTS, 12);
    const hitMaterial = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
    const hitRadius = Math.max(r, PIPE_HIT_RADIUS);

    const group = new THREE.Group();
    group.name = `pipeline:${pipe.id}`;
    group.userData.pipeline = { id: pipe.id, material, baseColor } satisfies PipelineUserData;
    const add = (mesh: THREE.Mesh) => {
      pick(mesh, pipe.id);
      group.add(mesh);
    };

    pipe.points.forEach((p, i) => {
      const next = pipe.points[i + 1];
      if (next) {
        const a = world(p);
        const b = world(next);
        const length = a.distanceTo(b);
        if (length > 1e-6) {
          const mesh = new THREE.Mesh(cylinder, material);
          mesh.scale.set(r, length, r);
          mesh.userData.pipeScale = { radius: r, tube: true, factor: 1 } satisfies PipeScale;
          mesh.position.copy(a).add(b).multiplyScalar(0.5);
          mesh.quaternion.setFromUnitVectors(UP, b.clone().sub(a).normalize());
          add(mesh);
          if (hitRadius > r) {
            const hit = new THREE.Mesh(cylinder, hitMaterial);
            hit.scale.set(hitRadius, length, hitRadius);
            hit.position.copy(mesh.position);
            hit.quaternion.copy(mesh.quaternion);
            hit.userData.hitProxy = true;
            add(hit);
          }
        }
      }
      if (i > 0 && next) {
        const joint = new THREE.Mesh(sphere, material);
        joint.scale.setScalar(r);
        joint.userData.pipeScale = { radius: r, tube: false, factor: 1 } satisfies PipeScale;
        joint.position.copy(world(p));
        add(joint);
      }
    });

    groups.set(pipe.id, group);
  }

  // Tees and joints: a fitting body where pipelines meet, on the pipeline that is met.
  for (const j of pipelineJunctions(level)) {
    const host = groups.get(j.otherId);
    const pipe = level.pipelines.find((p) => p.id === j.otherId);
    const branch = level.pipelines.find((p) => p.id === j.pipelineId);
    if (!host || !pipe || !branch) continue;
    const { material } = host.userData.pipeline as PipelineUserData;
    const fitting = new THREE.Mesh(new THREE.SphereGeometry(1, RADIAL_SEGMENTS, 12), material);
    const size = Math.max(pipe.diameter, branch.diameter) * 0.68;
    fitting.scale.setScalar(size);
    fitting.userData.pipeScale = { radius: size, tube: false, factor: 1.36 } satisfies PipeScale;
    fitting.position.copy(world(j.point));
    pick(fitting, pipe.id);
    host.add(fitting);
  }

  return groups;
}

const scratchA = new THREE.Vector3();
const scratchB = new THREE.Vector3();
const scratchC = new THREE.Vector3();
const scratchLine = new THREE.Line3();

/** World size of one screen pixel at `distance` from the camera (any distance for an orthographic one). */
export function worldPerPixel(camera: THREE.Camera, distance: number, viewportHeight: number): number {
  if (viewportHeight <= 0) return 0;
  if ((camera as THREE.OrthographicCamera).isOrthographicCamera) {
    const ortho = camera as THREE.OrthographicCamera;
    return (ortho.top - ortho.bottom) / ortho.zoom / viewportHeight;
  }
  const persp = camera as THREE.PerspectiveCamera;
  return (2 * Math.max(distance, persp.near) * Math.tan(THREE.MathUtils.degToRad(persp.fov) / 2)) / persp.zoom / viewportHeight;
}

/**
 * Keep pipes visible from far away: thicken every pipe part under `root` (tubes, joints, tees,
 * flow beads) so it is at least `minPixels` wide on screen, and give it its real size back up
 * close. A tube is measured at its point nearest to the camera, so it never looks swollen in the
 * foreground. Call before rendering; `minPixels` 0 restores the real sizes.
 */
export function updatePipeWidths(root: THREE.Object3D, camera: THREE.Camera, viewportHeight: number, minPixels = PIPE_MIN_PIXELS): void {
  const eye = camera.getWorldPosition(scratchC);
  root.traverse((object) => {
    const spec = object.userData.pipeScale as PipeScale | undefined;
    if (!spec) return;
    let radius = spec.radius;
    if (minPixels > 0) {
      object.updateWorldMatrix(true, false);
      let distance: number;
      if (spec.tube) {
        // The unit cylinder runs from y = -0.5 to 0.5.
        scratchLine.set(scratchA.set(0, -0.5, 0).applyMatrix4(object.matrixWorld), scratchB.set(0, 0.5, 0).applyMatrix4(object.matrixWorld));
        distance = scratchLine.closestPointToPoint(eye, true, scratchA).distanceTo(eye);
      } else {
        distance = scratchA.setFromMatrixPosition(object.matrixWorld).distanceTo(eye);
      }
      radius = Math.max(radius, (spec.factor * minPixels * worldPerPixel(camera, distance, viewportHeight)) / 2);
    }
    if (spec.tube) {
      if (object.scale.x !== radius) object.scale.set(radius, object.scale.y, radius);
    } else if (object.scale.x !== radius) {
      object.scale.setScalar(radius);
    }
  });
}

/** Distance between flow beads along a pipe (m) and their speed (m/s). */
const BEAD_SPACING = 1.5;
const BEAD_SPEED = 0.8;

export type FlowDirection = 'forward' | 'reverse';

/**
 * Animated beads that travel along a pipeline to show the flow direction (`forward`: from the
 * first point to the last). Not pickable. `update(time)` moves them; `update(null)` parks them at
 * evenly spaced positions (reduced motion).
 */
export class PipelineFlow {
  readonly group = new THREE.Group();
  private readonly length: number;

  constructor(
    private readonly pipe: Pipeline,
    private readonly direction: FlowDirection,
  ) {
    this.group.name = `flow:${pipe.id}`;
    this.length = pipelineLength(pipe);
    const count = Math.max(1, Math.round(this.length / BEAD_SPACING));
    const geometry = new THREE.SphereGeometry(1, 10, 8);
    const material = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const radius = Math.max(pipe.diameter * 0.75, 0.03);
    for (let i = 0; i < count; i++) {
      const bead = new THREE.Mesh(geometry, material);
      bead.scale.setScalar(radius);
      bead.userData.pipeScale = { radius, tube: false, factor: 1.5 } satisfies PipeScale;
      this.group.add(bead);
    }
    this.update(null);
  }

  update(time: number | null): void {
    const beads = this.group.children;
    const spacing = this.length / beads.length;
    const shift = time === null ? spacing / 2 : ((time / 1000) * BEAD_SPEED) % spacing;
    beads.forEach((bead, i) => {
      const along = i * spacing + shift;
      const s = this.direction === 'forward' ? along : this.length - along;
      const p = pointAlongPipeline(this.pipe, s);
      if (p) bead.position.set(p.x, p.z, p.y);
    });
  }
}

