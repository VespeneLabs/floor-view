import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';

import { POINT_GLYPHS, pointShape, type PointShape } from '../core/shapes';
import { toThreeColor } from './color';
import type { PointDatum, PointLayer } from './layers';
import type { PickInfo } from './sceneBuilder';

interface PointItem {
  levelId: string;
  shape: PointShape;
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  ring: THREE.Mesh<THREE.TorusGeometry, THREE.MeshBasicMaterial> | null;
  label: CSS2DObject | null;
  beam: Beam | null;
}

/** The alert beam of a point: a light column (3D only) and an expanding ground ring. */
interface Beam {
  column: THREE.Mesh<THREE.CylinderGeometry, THREE.MeshBasicMaterial>;
  pulse: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  /** Point radius the pulse scales from. */
  radius: number;
}

/** One pulse cycle in ms. */
export const BEAM_PERIOD = 1600;
const DEFAULT_BEAM_HEIGHT = 3;
const COLUMN_OPACITY = 0.55;

/** Vertical alpha gradient for the beam column: opaque at the floor, transparent at the top. */
function beamGradient(): THREE.DataTexture {
  const rows = 64;
  const data = new Uint8Array(rows * 4);
  for (let i = 0; i < rows; i++) {
    const a = Math.round(255 * (1 - i / (rows - 1)) ** 1.6);
    data.set([a, a, a, 255], i * 4);
  }
  const texture = new THREE.DataTexture(data, 1, rows);
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

const DEFAULT_SIZE = 0.25;
const DEFAULT_ELEVATION = 1;

/** Solids for the 3D view, about 1 m "radius" (scaled by the point size), centered on the point. */
function solidGeometry(shape: PointShape): THREE.BufferGeometry {
  switch (shape) {
    case 'box':
      return new THREE.BoxGeometry(1.6, 1.6, 1.6);
    case 'cylinder':
      return new THREE.CylinderGeometry(0.9, 0.9, 1.8, 24);
    case 'cone':
      return new THREE.ConeGeometry(1, 2, 24);
    case 'diamond':
      return new THREE.OctahedronGeometry(1.25);
    case 'sphere':
      return new THREE.SphereGeometry(1, 20, 14);
  }
}

/** Flat glyphs for the top-down 2D view, facing up (+Y), so each shape stays distinguishable. */
function glyphGeometry(shape: PointShape): THREE.BufferGeometry {
  const outline = POINT_GLYPHS[shape];
  // ShapeGeometry lies in XY facing +Z; rotating -90° about X makes it face up and maps shape y
  // to world -z, so plan y (= world z) goes in as -y.
  const geometry = outline
    ? new THREE.ShapeGeometry(new THREE.Shape(outline.map((p) => new THREE.Vector2(p.x, -p.y))))
    : new THREE.CircleGeometry(1, 32);
  return geometry.rotateX(-Math.PI / 2);
}

/**
 * The scene objects of one points layer: one group per level, one mesh per point (a solid in 3D,
 * a flat glyph in 2D, by `shape`), plus an optional outline ring and text label. `sync` updates them in place, matched by point id, so
 * live data (values every few seconds) doesn't rebuild meshes. Pure three.js, no renderer needed.
 */
export class PointLayerView {
  /** Level id → group (named `layer:<id>`), created on demand. */
  readonly groups = new Map<string, THREE.Group>();
  private readonly items = new Map<string, PointItem>();
  private readonly solids = new Map<PointShape, THREE.BufferGeometry>();
  private readonly glyphs = new Map<PointShape, THREE.BufferGeometry>();
  private mode: '2d' | '3d' = '3d';
  // Beam resources, created with the first beam.
  private beamShared: { column: THREE.CylinderGeometry; pulse: THREE.RingGeometry; gradient: THREE.DataTexture } | null = null;
  private beams = 0;
  private readonly torus = new THREE.TorusGeometry(1, 0.09, 8, 40).rotateX(Math.PI / 2);

  constructor(
    readonly layerId: string,
    /** Called when a level group is created, to attach it to the level's scene group. */
    private readonly attach: (levelId: string, group: THREE.Group) => void = () => {},
  ) {}

  /**
   * Apply `layer` (same id). Points on levels not in `levelIds` are skipped. `levelHeights`
   * (level id → wall height) sets the beam height; default 3 m.
   */
  sync(layer: PointLayer, levelIds: ReadonlySet<string>, defaultColor: string, levelHeights?: ReadonlyMap<string, number>): void {
    const seen = new Set<string>();
    for (const point of layer.points) {
      if (!levelIds.has(point.levelId) || seen.has(point.id)) continue;
      seen.add(point.id);
      this.syncPoint(layer, point, defaultColor, levelHeights?.get(point.levelId) ?? DEFAULT_BEAM_HEIGHT);
    }
    for (const [id, item] of this.items) {
      if (!seen.has(id)) {
        this.disposeItem(item);
        this.items.delete(id);
      }
    }
  }

  /** World-independent (level-local) position of a point's sphere center, or null. */
  pointPosition(id: string): { levelId: string; position: THREE.Vector3; radius: number } | null {
    const item = this.items.get(id);
    return item ? { levelId: item.levelId, position: item.mesh.position.clone(), radius: item.mesh.scale.x } : null;
  }

  /** Show solids (3D) or flat glyphs (2D). Swaps geometries in place. */
  setMode(mode: '2d' | '3d'): void {
    if (mode === this.mode) return;
    this.mode = mode;
    for (const item of this.items.values()) {
      item.mesh.geometry = this.geometry(item.shape);
      // From above the column would cover the point; 2D shows only the ground pulse.
      if (item.beam) item.beam.column.visible = mode === '3d';
    }
  }

  /** Whether a beam is shown on one of `levelIds`, i.e. whether the beams need animation frames. */
  hasBeams(levelIds: ReadonlySet<string>): boolean {
    if (this.beams === 0) return false;
    for (const item of this.items.values()) if (item.beam && levelIds.has(item.levelId)) return true;
    return false;
  }

  /**
   * Set every beam's pulse for time `time` (ms, e.g. the rAF timestamp), or the static,
   * reduced-motion look when `time` is null.
   */
  updateBeams(time: number | null): void {
    if (this.beams === 0) return;
    for (const item of this.items.values()) if (item.beam) poseBeam(item.beam, time);
  }

  /** Shape of a point, or null if there is no such point. */
  pointShape(id: string): PointShape | null {
    return this.items.get(id)?.shape ?? null;
  }

  get size(): number {
    return this.items.size;
  }

  dispose(): void {
    for (const item of this.items.values()) this.disposeItem(item);
    this.items.clear();
    for (const group of this.groups.values()) group.removeFromParent();
    this.groups.clear();
    for (const g of [...this.solids.values(), ...this.glyphs.values()]) g.dispose();
    if (this.beamShared) {
      this.beamShared.column.dispose();
      this.beamShared.pulse.dispose();
      this.beamShared.gradient.dispose();
      this.beamShared = null;
    }
    this.solids.clear();
    this.glyphs.clear();
    this.torus.dispose();
  }

  /** Shared geometry for a shape in the current mode, created on first use. */
  private geometry(shape: PointShape): THREE.BufferGeometry {
    const cache = this.mode === '3d' ? this.solids : this.glyphs;
    let geometry = cache.get(shape);
    if (!geometry) cache.set(shape, (geometry = this.mode === '3d' ? solidGeometry(shape) : glyphGeometry(shape)));
    return geometry;
  }

  private group(levelId: string): THREE.Group {
    let group = this.groups.get(levelId);
    if (!group) {
      group = new THREE.Group();
      group.name = `layer:${this.layerId}`;
      this.groups.set(levelId, group);
      this.attach(levelId, group);
    }
    return group;
  }

  private syncPoint(layer: PointLayer, point: PointDatum, defaultColor: string, beamHeight: number): void {
    const shape = pointShape(point.shape, pointShape(layer.shape));
    let item = this.items.get(point.id);
    if (!item) {
      const mesh = new THREE.Mesh(this.geometry(shape), new THREE.MeshStandardMaterial({ roughness: 0.4 }));
      item = { levelId: point.levelId, shape, mesh, ring: null, label: null, beam: null };
      this.items.set(point.id, item);
      this.group(point.levelId).add(mesh);
    } else if (item.levelId !== point.levelId) {
      item.levelId = point.levelId;
      const group = this.group(point.levelId);
      group.add(item.mesh);
      if (item.ring) group.add(item.ring);
      if (item.label) group.add(item.label);
      if (item.beam) group.add(item.beam.column, item.beam.pulse);
    }
    if (item.shape !== shape) {
      item.shape = shape;
      item.mesh.geometry = this.geometry(shape);
    }
    const size = point.size ?? layer.size ?? DEFAULT_SIZE;
    const y = layer.elevation ?? DEFAULT_ELEVATION;
    const { mesh } = item;
    toThreeColor(point.color ?? layer.color ?? defaultColor, mesh.material.color);
    mesh.scale.setScalar(size);
    mesh.position.set(point.position.x, y, point.position.y);
    const pick: PickInfo = { kind: 'point', id: point.id, levelId: point.levelId, layerId: layer.id };
    mesh.userData.pick = pick;

    // Outline ring: a flat torus around the sphere (a circle outline from above, a halo in 3D).
    if (point.ring) {
      if (!item.ring) {
        item.ring = new THREE.Mesh(this.torus, new THREE.MeshBasicMaterial());
        item.ring.raycast = () => undefined;
        this.group(item.levelId).add(item.ring);
      }
      toThreeColor(point.ring, item.ring.material.color);
      item.ring.scale.setScalar(size * 1.55);
      item.ring.position.copy(mesh.position);
    } else if (item.ring) {
      item.ring.removeFromParent();
      item.ring.material.dispose();
      item.ring = null;
    }

    if (point.beam) {
      if (!item.beam) {
        item.beam = this.createBeam();
        this.group(item.levelId).add(item.beam.column, item.beam.pulse);
        this.beams++;
      }
      const { column, pulse } = item.beam;
      toThreeColor(point.beam, column.material.color);
      pulse.material.color.copy(column.material.color);
      item.beam.radius = size;
      column.position.set(point.position.x, 0.02, point.position.y);
      column.scale.set(size * 0.85, Math.max(beamHeight - 0.02, 0.5), size * 0.85);
      pulse.position.set(point.position.x, 0.07, point.position.y);
      poseBeam(item.beam, null);
    } else if (item.beam) {
      this.disposeBeam(item.beam);
      item.beam = null;
    }

    const text = (layer.showLabels ?? true) && layer.label ? layer.label(point) : null;
    if (text) {
      if (!item.label) {
        const el = document.createElement('div');
        el.className = 'vl-viewer__point-label';
        item.label = new CSS2DObject(el);
        item.label.name = 'point-label';
        // Sit above the sphere: CSS2D anchors at the element's center.
        item.label.center.set(0.5, 1);
        this.group(item.levelId).add(item.label);
      }
      if (item.label.element.textContent !== text) item.label.element.textContent = text;
      // Above the sphere in 3D, and toward screen-up (plan -y) so it clears the sphere in 2D too.
      item.label.position.set(point.position.x, y + size * 1.25 + 0.05, point.position.y - size * 1.3);
    } else if (item.label) {
      item.label.element.remove();
      item.label.removeFromParent();
      item.label = null;
    }
  }

  private createBeam(): Beam {
    this.beamShared ??= {
      // Open cylinder with its base at y = 0; uv v runs 0 (bottom) → 1 (top), matching the gradient rows.
      column: new THREE.CylinderGeometry(1, 1, 1, 32, 1, true).translate(0, 0.5, 0),
      pulse: new THREE.RingGeometry(0.8, 1, 48).rotateX(-Math.PI / 2),
      gradient: beamGradient(),
    };
    const shared = { transparent: true, depthWrite: false, side: THREE.DoubleSide };
    const column = new THREE.Mesh(this.beamShared.column, new THREE.MeshBasicMaterial({ ...shared, alphaMap: this.beamShared.gradient, opacity: COLUMN_OPACITY }));
    const pulse = new THREE.Mesh(this.beamShared.pulse, new THREE.MeshBasicMaterial(shared));
    for (const mesh of [column, pulse]) {
      mesh.raycast = () => undefined;
      mesh.name = 'point-beam';
      mesh.renderOrder = 2;
    }
    column.visible = this.mode === '3d';
    return { column, pulse, radius: 1 };
  }

  private disposeBeam(beam: Beam): void {
    for (const mesh of [beam.column, beam.pulse]) {
      mesh.removeFromParent();
      mesh.material.dispose();
    }
    this.beams--;
  }

  private disposeItem(item: PointItem): void {
    item.mesh.removeFromParent();
    item.mesh.material.dispose();
    if (item.ring) {
      item.ring.removeFromParent();
      item.ring.material.dispose();
    }
    if (item.label) {
      item.label.element.remove();
      item.label.removeFromParent();
    }
    if (item.beam) this.disposeBeam(item.beam);
  }
}

/** Pulse: the ground ring expands and fades once per period while the column breathes. Null: static. */
function poseBeam(beam: Beam, time: number | null): void {
  const { column, pulse, radius } = beam;
  if (time === null) {
    pulse.scale.setScalar(radius * 2);
    pulse.material.opacity = 0.6;
    column.material.opacity = COLUMN_OPACITY;
    return;
  }
  const phase = (time % BEAM_PERIOD) / BEAM_PERIOD;
  pulse.scale.setScalar(radius * (1.3 + 2.2 * phase));
  pulse.material.opacity = 0.85 * (1 - phase) ** 1.3;
  column.material.opacity = COLUMN_OPACITY * (0.75 + 0.25 * Math.cos(phase * Math.PI * 2));
}
