import * as THREE from 'three';
import type { ModelAsset } from '../model/assets';
import { polygonCentroid } from '../model/geometry';
import { toThreeColor } from './color';
import type { FloorPlan, Level } from '../model/types';
import type { PointLayer } from './layers';
import { PointLayerView } from './pointLayer';

/** What a pickable mesh represents. Stored on `mesh.userData.pick`. */
export interface PickInfo {
  kind: 'wall' | 'room' | 'marker' | 'point';
  id: string;
  levelId: string;
  /** Set for `kind: 'point'`. */
  layerId?: string;
}

export interface SceneColors {
  wall: string;
  room: string;
  marker: string;
  point: string;
  /** `focus()` highlight ring/outline. */
  highlight: string;
  /** Base color of 3D models (they are drawn decolorized, see `marker.color` for accents). */
  model: string;
}

export const DEFAULT_SCENE_COLORS: SceneColors = {
  wall: '#f1f5f9',
  room: '#dbe3ec',
  marker: '#6366f1',
  point: '#f97316',
  highlight: '#facc15',
  model: '#eef1f5',
};

/** Height of room floors above the level elevation, to avoid z-fighting. */
const FLOOR_OFFSET = 0.02;

export interface BuiltLevel {
  levelId: string;
  group: THREE.Group;
  rooms: Map<string, THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>>;
  walls: Map<string, THREE.Mesh>;
  /** Marker spheres, or the model slots (see `models`) of markers that show a 3D model. */
  markers: Map<string, THREE.Object3D>;
  /** Markers that show a 3D model, each with a placeholder box until the viewer loads the model. */
  models: ModelSlot[];
  /** Room label anchors (centroid, slightly above the floor), in level-local coordinates. */
  labelAnchors: { roomId: string; text: string; position: THREE.Vector3 }[];
}

/**
 * Where a marker's 3D model goes: `slot` sits at the marker position and rotation (scale is
 * applied to the model), and holds `placeholder`, a box of the asset's size, until the model is
 * swapped in. `slot.userData.modelSlot` is true, so hover can light up the whole model.
 */
export interface ModelSlot {
  markerId: string;
  asset: ModelAsset;
  /** `asset.scale` × `marker.scale`. */
  scale: number;
  /** The marker's color: the accent of the model in the clay style. */
  color?: string;
  slot: THREE.Group;
  placeholder: THREE.Mesh | null;
}

function tag(mesh: THREE.Object3D, pick: PickInfo): void {
  mesh.userData.pick = pick;
}

export function buildLevel(
  level: Level,
  colors: SceneColors = DEFAULT_SCENE_COLORS,
  assets: ReadonlyMap<string, ModelAsset> = new Map(),
): BuiltLevel {
  const group = new THREE.Group();
  group.name = `level:${level.id}`;
  group.position.y = level.elevation;
  const built: BuiltLevel = {
    levelId: level.id,
    group,
    rooms: new Map(),
    walls: new Map(),
    markers: new Map(),
    models: [],
    labelAnchors: [],
  };

  for (const room of level.rooms) {
    const shape = new THREE.Shape(room.points.map((p) => new THREE.Vector2(p.x, p.y)));
    const geometry = new THREE.ShapeGeometry(shape);
    // Shape lives in XY; rotating +90° about X maps (x, y, 0) -> (x, 0, y): plan y -> world z.
    geometry.rotateX(Math.PI / 2);
    const baseColor = room.color ?? colors.room;
    const material = new THREE.MeshStandardMaterial({ color: toThreeColor(baseColor), side: THREE.DoubleSide, roughness: 0.9 });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.y = FLOOR_OFFSET;
    mesh.userData.baseColor = baseColor;
    tag(mesh, { kind: 'room', id: room.id, levelId: level.id });
    group.add(mesh);
    built.rooms.set(room.id, mesh);

    const c = polygonCentroid(room.points);
    if (room.name) built.labelAnchors.push({ roomId: room.id, text: room.name, position: new THREE.Vector3(c.x, 0.1, c.y) });
  }

  for (const wall of level.walls) {
    const dx = wall.end.x - wall.start.x;
    const dz = wall.end.y - wall.start.y;
    const length = Math.hypot(dx, dz);
    if (length < 1e-6) continue;
    const height = wall.height ?? level.height;
    // Extend by the thickness so walls meeting at a corner overlap cleanly.
    const geometry = new THREE.BoxGeometry(length + wall.thickness, height, wall.thickness);
    const material = new THREE.MeshStandardMaterial({ color: toThreeColor(colors.wall), roughness: 0.8 });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set((wall.start.x + wall.end.x) / 2, height / 2, (wall.start.y + wall.end.y) / 2);
    mesh.rotation.y = -Math.atan2(dz, dx);
    tag(mesh, { kind: 'wall', id: wall.id, levelId: level.id });
    group.add(mesh);
    built.walls.set(wall.id, mesh);
  }

  for (const marker of level.markers) {
    const asset = marker.model ? assets.get(marker.model) : undefined;
    if (asset) {
      const pick: PickInfo = { kind: 'marker', id: marker.id, levelId: level.id };
      const slot = new THREE.Group();
      slot.name = `model:${marker.id}`;
      slot.position.set(marker.position.x, marker.elevation ?? 0, marker.position.y);
      // Plan rotation is clockwise with y down; around world Y that is a negative angle (as for walls).
      slot.rotation.y = -THREE.MathUtils.degToRad(marker.rotation ?? 0);
      slot.userData.modelSlot = true;
      const s = marker.scale ?? 1;
      const { width, depth, height } = asset.size;
      const placeholder = new THREE.Mesh(
        new THREE.BoxGeometry(Math.max(width * s, 0.05), Math.max(height * s, 0.05), Math.max(depth * s, 0.05)),
        new THREE.MeshStandardMaterial({ color: toThreeColor(marker.color ?? colors.marker), transparent: true, opacity: 0.35 }),
      );
      placeholder.position.y = Math.max(height * s, 0.05) / 2;
      tag(placeholder, pick);
      slot.add(placeholder);
      group.add(slot);
      built.markers.set(marker.id, slot);
      built.models.push({ markerId: marker.id, asset, scale: (asset.scale ?? 1) * s, color: marker.color, slot, placeholder });
      continue;
    }
    const material = new THREE.MeshStandardMaterial({ color: toThreeColor(marker.color ?? colors.marker), roughness: 0.4 });
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.2, 20, 14), material);
    mesh.position.set(marker.position.x, 0.25 + (marker.elevation ?? 0), marker.position.y);
    tag(mesh, { kind: 'marker', id: marker.id, levelId: level.id });
    group.add(mesh);
    built.markers.set(marker.id, mesh);
  }

  return built;
}

export function buildPlan(
  plan: FloorPlan,
  colors: SceneColors = DEFAULT_SCENE_COLORS,
  assets: ReadonlyMap<string, ModelAsset> = new Map(),
): BuiltLevel[] {
  return plan.levels.map((level) => buildLevel(level, colors, assets));
}

/**
 * Build point-layer meshes, one group per level (keyed by level id).
 * Points whose level does not exist are skipped. The viewer keeps a `PointLayerView` instead,
 * to update points in place.
 */
export function buildPointLayer(
  layer: PointLayer,
  levelIds: ReadonlySet<string>,
  defaultColor = DEFAULT_SCENE_COLORS.point,
): Map<string, THREE.Group> {
  const view = new PointLayerView(layer.id);
  view.sync(layer, levelIds, defaultColor);
  return view.groups;
}

/**
 * Dispose geometries and materials under `root` (shared geometries are disposed once) and
 * detach the DOM elements of any CSS2D labels. Meshes flagged `userData.sharedAsset` (model
 * instances) only dispose their own material: geometry and textures belong to the model cache. CSS2DObject only removes its element when the
 * label itself is removed from the scene, not when an ancestor group is, so stale labels would
 * otherwise stay frozen on screen after a rebuild.
 */
export function disposeObject(root: THREE.Object3D): void {
  const seen = new Set<{ dispose(): void }>();
  root.traverse((obj) => {
    const element = (obj as THREE.Object3D & { isCSS2DObject?: boolean; element?: Element }).element;
    if ((obj as { isCSS2DObject?: boolean }).isCSS2DObject && element) element.remove();
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    const shared = mesh.userData.sharedAsset === true;
    if (!shared) seen.add(mesh.geometry);
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of materials) {
      seen.add(m);
      if (shared) continue;
      const map = (m as THREE.MeshBasicMaterial).map;
      if (map) seen.add(map);
    }
  });
  seen.forEach((d) => d.dispose());
}
