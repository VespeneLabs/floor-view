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
  private readonly torus = new THREE.TorusGeometry(1, 0.09, 8, 40).rotateX(Math.PI / 2);

  constructor(
    readonly layerId: string,
    /** Called when a level group is created, to attach it to the level's scene group. */
    private readonly attach: (levelId: string, group: THREE.Group) => void = () => {},
  ) {}

  /** Apply `layer` (same id). Points on levels not in `levelIds` are skipped. */
  sync(layer: PointLayer, levelIds: ReadonlySet<string>, defaultColor: string): void {
    const seen = new Set<string>();
    for (const point of layer.points) {
      if (!levelIds.has(point.levelId) || seen.has(point.id)) continue;
      seen.add(point.id);
      this.syncPoint(layer, point, defaultColor);
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
    for (const item of this.items.values()) item.mesh.geometry = this.geometry(item.shape);
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

  private syncPoint(layer: PointLayer, point: PointDatum, defaultColor: string): void {
    const shape = pointShape(point.shape, pointShape(layer.shape));
    let item = this.items.get(point.id);
    if (!item) {
      const mesh = new THREE.Mesh(this.geometry(shape), new THREE.MeshStandardMaterial({ roughness: 0.4 }));
      item = { levelId: point.levelId, shape, mesh, ring: null, label: null };
      this.items.set(point.id, item);
      this.group(point.levelId).add(mesh);
    } else if (item.levelId !== point.levelId) {
      item.levelId = point.levelId;
      const group = this.group(point.levelId);
      group.add(item.mesh);
      if (item.ring) group.add(item.ring);
      if (item.label) group.add(item.label);
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
  }
}
