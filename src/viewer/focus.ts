import * as THREE from 'three';

import { polygonCentroid } from '../model/geometry';
import type { FloorPlan, Point } from '../model/types';

/** What `FloorplanViewer.focus()` can move to. */
export type FocusTarget =
  /** A data point of a points layer. */
  | { kind: 'point'; layerId: string; id: string }
  /** A plan entity; `levelId` is optional (looked up). */
  | { kind: 'room' | 'wall' | 'marker'; id: string; levelId?: string }
  /** Any position on a level, in plan meters. */
  | { kind: 'position'; levelId: string; position: Point };

export interface FocusOptions {
  /** Draw a highlight (ring or outline). `true` uses the scene's highlight color. Default true. */
  highlight?: boolean | { color?: string; /** Remove it after this many ms. */ duration?: number };
}

/** Where a focus target is, and what shape to highlight. */
export interface ResolvedFocus {
  levelId: string;
  /** Plan position to center on. */
  center: Point;
  /** Height above the level floor of the thing itself (e.g. a point's sphere). */
  height: number;
  shape: { type: 'ring'; radius: number } | { type: 'outline'; points: Point[]; closed: boolean; width: number };
}

/** A point's live position, provided by the viewer's point layers. */
export type PointLookup = (layerId: string, id: string) => { levelId: string; position: Point; height: number; radius: number } | null;

/** Resolves a target against the plan (and the point layers), or null when it doesn't exist. */
export function resolveFocus(plan: FloorPlan, target: FocusTarget, points: PointLookup): ResolvedFocus | null {
  if (target.kind === 'point') {
    const p = points(target.layerId, target.id);
    return p && { levelId: p.levelId, center: p.position, height: p.height, shape: { type: 'ring', radius: p.radius * 2 + 0.3 } };
  }
  if (target.kind === 'position') {
    if (!plan.levels.some((l) => l.id === target.levelId)) return null;
    return { levelId: target.levelId, center: { ...target.position }, height: 0, shape: { type: 'ring', radius: 0.6 } };
  }
  for (const level of plan.levels) {
    if (target.levelId && level.id !== target.levelId) continue;
    if (target.kind === 'room') {
      const room = level.rooms.find((r) => r.id === target.id);
      if (room) {
        return { levelId: level.id, center: polygonCentroid(room.points), height: 0, shape: { type: 'outline', points: room.points.map((p) => ({ ...p })), closed: true, width: 0.15 } };
      }
    } else if (target.kind === 'wall') {
      const wall = level.walls.find((w) => w.id === target.id);
      if (wall) {
        const center = { x: (wall.start.x + wall.end.x) / 2, y: (wall.start.y + wall.end.y) / 2 };
        return { levelId: level.id, center, height: 0, shape: { type: 'outline', points: [{ ...wall.start }, { ...wall.end }], closed: false, width: wall.thickness + 0.2 } };
      }
    } else {
      const marker = level.markers.find((m) => m.id === target.id);
      if (marker) return { levelId: level.id, center: { ...marker.position }, height: 0, shape: { type: 'ring', radius: 0.7 } };
    }
  }
  return null;
}

/**
 * The highlight for a resolved target, in level-local coordinates: a flat ring, or a flat ribbon
 * along an outline. Drawn on top of everything (no depth test) and not pickable.
 */
export function buildHighlight(focus: ResolvedFocus, color: THREE.Color): THREE.Mesh {
  const material = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95, depthTest: false, depthWrite: false, side: THREE.DoubleSide });
  let geometry: THREE.BufferGeometry;
  const y = focus.height + 0.06;
  if (focus.shape.type === 'ring') {
    const r = focus.shape.radius;
    geometry = new THREE.RingGeometry(r, r + Math.max(0.08, r * 0.15), 48).rotateX(-Math.PI / 2).translate(focus.center.x, y, focus.center.y);
  } else {
    const { points, closed, width } = focus.shape;
    const half = width / 2;
    const positions: number[] = [];
    const count = closed ? points.length : points.length - 1;
    for (let i = 0; i < count; i++) {
      const a = points[i]!;
      const b = points[(i + 1) % points.length]!;
      const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      // Perpendicular offset; extend each segment by half the width so corners close.
      const nx = (-(b.y - a.y) / len) * half;
      const ny = ((b.x - a.x) / len) * half;
      const ex = ((b.x - a.x) / len) * half;
      const ey = ((b.y - a.y) / len) * half;
      const quad = [
        [a.x - ex + nx, a.y - ey + ny],
        [a.x - ex - nx, a.y - ey - ny],
        [b.x + ex - nx, b.y + ey - ny],
        [b.x + ex + nx, b.y + ey + ny],
      ] as const;
      for (const k of [0, 1, 2, 0, 2, 3]) positions.push(quad[k]![0], y, quad[k]![1]);
    }
    geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  }
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'focus-highlight';
  mesh.renderOrder = 10;
  mesh.raycast = () => undefined;
  return mesh;
}
