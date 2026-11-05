import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';

import { toThreeColor } from './color';
import type { PointDatum, PointLayer } from './layers';
import type { PickInfo } from './sceneBuilder';

interface PointItem {
  levelId: string;
  mesh: THREE.Mesh<THREE.SphereGeometry, THREE.MeshStandardMaterial>;
  ring: THREE.Mesh<THREE.TorusGeometry, THREE.MeshBasicMaterial> | null;
  label: CSS2DObject | null;
}

const DEFAULT_SIZE = 0.25;
const DEFAULT_ELEVATION = 1;

/**
 * The scene objects of one points layer: one group per level, one sphere per point, plus an
 * optional outline ring and text label. `sync` updates them in place, matched by point id, so
 * live data (values every few seconds) doesn't rebuild meshes. Pure three.js, no renderer needed.
 */
export class PointLayerView {
  /** Level id → group (named `layer:<id>`), created on demand. */
  readonly groups = new Map<string, THREE.Group>();
  private readonly items = new Map<string, PointItem>();
  private readonly sphere = new THREE.SphereGeometry(1, 20, 14);
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

  get size(): number {
    return this.items.size;
  }

  dispose(): void {
    for (const item of this.items.values()) this.disposeItem(item);
    this.items.clear();
    for (const group of this.groups.values()) group.removeFromParent();
    this.groups.clear();
    this.sphere.dispose();
    this.torus.dispose();
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
    let item = this.items.get(point.id);
    if (!item) {
      const mesh = new THREE.Mesh(this.sphere, new THREE.MeshStandardMaterial({ roughness: 0.4 }));
      item = { levelId: point.levelId, mesh, ring: null, label: null };
      this.items.set(point.id, item);
      this.group(point.levelId).add(mesh);
    } else if (item.levelId !== point.levelId) {
      item.levelId = point.levelId;
      const group = this.group(point.levelId);
      group.add(item.mesh);
      if (item.ring) group.add(item.ring);
      if (item.label) group.add(item.label);
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
      item.label.position.set(point.position.x, y + size + 0.05, point.position.y - size);
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
