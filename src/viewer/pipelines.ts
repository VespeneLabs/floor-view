import * as THREE from 'three';
import { pipelineJunctions, pipelineLength, pointAlongPipeline } from '../model/pipeline';
import type { Level, PipePoint, Pipeline } from '../model/types';
import { toThreeColor } from './color';

/** Horizontal runs at least this high (m above the floor) stand on floor supports. */
export const SUPPORT_MIN_HEIGHT = 1.5;
/** Distance between floor supports along a run, in meters. */
export const SUPPORT_SPACING = 3;
/** Support color: neutral steel, not the pipe color (tints and flows leave it alone). */
const SUPPORT_COLOR = '#94a3b8';
const RADIAL_SEGMENTS = 16;
/**
 * Minimum pick radius (m). Real pipes are a few cm thick, a pixel or two on screen, so each segment
 * also gets an invisible (no color, no depth) hit cylinder at least this thick, flagged
 * `userData.hitProxy`.
 */
export const PIPE_HIT_RADIUS = 0.15;

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
 * a larger sphere at tees and joints between pipelines, and floor supports under horizontal runs
 * from `SUPPORT_MIN_HEIGHT` up. Every mesh is pickable as `{ kind: 'pipeline' }`. Pure: no DOM.
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
        joint.position.copy(world(p));
        add(joint);
      }
    });

    // Per pipeline, so hovering one pipeline doesn't light up the supports of the others.
    const supports = supportPositions(pipe);
    const supportMaterial = supports.length
      ? new THREE.MeshStandardMaterial({ color: toThreeColor(SUPPORT_COLOR), roughness: 0.7, metalness: 0.2 })
      : null;
    for (const support of supports) {
      const height = support.z - r;
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.05, height, 0.05), supportMaterial!);
      post.position.set(support.x, height / 2, support.y);
      add(post);
      // A short cross bar under the pipe, across the run.
      const bar = new THREE.Mesh(new THREE.BoxGeometry(Math.max(0.25, r * 5), 0.04, 0.05), supportMaterial!);
      bar.position.set(support.x, height - 0.02, support.y);
      bar.rotation.y = -support.angle + Math.PI / 2;
      add(bar);
    }

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
    fitting.scale.setScalar(Math.max(pipe.diameter, branch.diameter) * 0.68);
    fitting.position.copy(world(j.point));
    pick(fitting, pipe.id);
    host.add(fitting);
  }

  return groups;
}

/**
 * Floor support positions under a pipeline: along each horizontal segment at least
 * `SUPPORT_MIN_HEIGHT` up, one per `SUPPORT_SPACING` meters (at least one), evenly spread. `angle`
 * is the segment's direction in plan (radians, atan2 of plan y over x).
 */
export function supportPositions(pipe: Pipeline): { x: number; y: number; z: number; angle: number }[] {
  const out: { x: number; y: number; z: number; angle: number }[] = [];
  for (let i = 1; i < pipe.points.length; i++) {
    const a = pipe.points[i - 1]!;
    const b = pipe.points[i]!;
    const plan = Math.hypot(b.x - a.x, b.y - a.y);
    if (plan < 1e-6 || Math.abs(b.z - a.z) > 1e-6 || a.z < SUPPORT_MIN_HEIGHT) continue;
    const count = Math.max(1, Math.floor(plan / SUPPORT_SPACING));
    const angle = Math.atan2(b.y - a.y, b.x - a.x);
    for (let k = 0; k < count; k++) {
      const t = (k + 0.5) / count;
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z, angle });
    }
  }
  return out;
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

