import * as THREE from 'three';
import { polygonCentroid } from '../model/geometry';
import { toThreeColor } from './color';
import type { FloorPlan, Level } from '../model/types';
import type { PointLayer } from './layers';

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
}

export const DEFAULT_SCENE_COLORS: SceneColors = {
  wall: '#f1f5f9',
  room: '#dbe3ec',
  marker: '#6366f1',
  point: '#f97316',
};

/** Height of room floors above the level elevation, to avoid z-fighting. */
const FLOOR_OFFSET = 0.02;

export interface BuiltLevel {
  levelId: string;
  group: THREE.Group;
  rooms: Map<string, THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>>;
  walls: Map<string, THREE.Mesh>;
  markers: Map<string, THREE.Mesh>;
  /** Room label anchors (centroid, slightly above the floor), in level-local coordinates. */
  labelAnchors: { roomId: string; text: string; position: THREE.Vector3 }[];
}

function tag(mesh: THREE.Object3D, pick: PickInfo): void {
  mesh.userData.pick = pick;
}

export function buildLevel(level: Level, colors: SceneColors = DEFAULT_SCENE_COLORS): BuiltLevel {
  const group = new THREE.Group();
  group.name = `level:${level.id}`;
  group.position.y = level.elevation;
  const built: BuiltLevel = {
    levelId: level.id,
    group,
    rooms: new Map(),
    walls: new Map(),
    markers: new Map(),
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
    const material = new THREE.MeshStandardMaterial({ color: toThreeColor(marker.color ?? colors.marker), roughness: 0.4 });
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.2, 20, 14), material);
    mesh.position.set(marker.position.x, 0.25, marker.position.y);
    tag(mesh, { kind: 'marker', id: marker.id, levelId: level.id });
    group.add(mesh);
    built.markers.set(marker.id, mesh);
  }

  return built;
}

export function buildPlan(plan: FloorPlan, colors: SceneColors = DEFAULT_SCENE_COLORS): BuiltLevel[] {
  return plan.levels.map((level) => buildLevel(level, colors));
}

/**
 * Build point-layer meshes, one group per level (keyed by level id).
 * Points whose level does not exist are skipped.
 */
export function buildPointLayer(
  layer: PointLayer,
  levelIds: ReadonlySet<string>,
  defaultColor = DEFAULT_SCENE_COLORS.point,
): Map<string, THREE.Group> {
  const groups = new Map<string, THREE.Group>();
  const geometry = new THREE.SphereGeometry(1, 20, 14);
  for (const p of layer.points) {
    if (!levelIds.has(p.levelId)) continue;
    let group = groups.get(p.levelId);
    if (!group) {
      group = new THREE.Group();
      group.name = `layer:${layer.id}`;
      groups.set(p.levelId, group);
    }
    const material = new THREE.MeshStandardMaterial({ color: toThreeColor(p.color ?? layer.color ?? defaultColor), roughness: 0.4 });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.scale.setScalar(p.size ?? layer.size ?? 0.25);
    mesh.position.set(p.position.x, layer.elevation ?? 1, p.position.y);
    tag(mesh, { kind: 'point', id: p.id, levelId: p.levelId, layerId: layer.id });
    group.add(mesh);
  }
  return groups;
}

/**
 * Dispose geometries and materials under `root` (shared geometries are disposed once) and
 * detach the DOM elements of any CSS2D labels. CSS2DObject only removes its element when the
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
    seen.add(mesh.geometry);
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of materials) {
      seen.add(m);
      const map = (m as THREE.MeshBasicMaterial).map;
      if (map) seen.add(map);
    }
  });
  seen.forEach((d) => d.dispose());
}
