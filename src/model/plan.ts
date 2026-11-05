import { boundsOf, type Bounds } from './geometry';
import {
  PLAN_FORMAT_VERSION,
  type Entity,
  type EntityKind,
  type EntityRef,
  type FloorPlan,
  type Level,
  type Point,
} from './types';

/** Short random id with a readable prefix, e.g. `room_4f9a2c1b`. */
export function createId(prefix: string): string {
  const random =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 8)
      : Math.random().toString(16).slice(2, 10);
  return `${prefix}_${random}`;
}

export function createLevel(partial: Partial<Level> = {}): Level {
  return {
    id: partial.id ?? createId('level'),
    name: partial.name ?? 'Level',
    elevation: partial.elevation ?? 0,
    height: partial.height ?? 3,
    walls: partial.walls ?? [],
    rooms: partial.rooms ?? [],
    markers: partial.markers ?? [],
  };
}

export function createPlan(name = 'Untitled plan'): FloorPlan {
  return {
    version: PLAN_FORMAT_VERSION,
    id: createId('plan'),
    name,
    levels: [createLevel({ name: 'Ground floor' })],
  };
}

export function clonePlan(plan: FloorPlan): FloorPlan {
  return structuredClone(plan);
}

export function getLevel(plan: FloorPlan, levelId: string): Level | undefined {
  return plan.levels.find((l) => l.id === levelId);
}

const COLLECTION = { wall: 'walls', room: 'rooms', marker: 'markers' } as const;

export function collectionOf(level: Level, kind: EntityKind): Entity[] {
  return level[COLLECTION[kind]];
}

export function findEntity(plan: FloorPlan, ref: EntityRef): Entity | undefined {
  const level = getLevel(plan, ref.levelId);
  return level ? collectionOf(level, ref.kind).find((e) => e.id === ref.id) : undefined;
}

export function removeEntity(plan: FloorPlan, ref: EntityRef): boolean {
  const level = getLevel(plan, ref.levelId);
  if (!level) return false;
  const list = collectionOf(level, ref.kind);
  const index = list.findIndex((e) => e.id === ref.id);
  if (index < 0) return false;
  list.splice(index, 1);
  return true;
}

/** Every point that defines an entity's geometry (wall endpoints, room vertices, marker position). */
export function entityPoints(kind: EntityKind, entity: Entity): Point[] {
  switch (kind) {
    case 'wall': {
      const w = entity as Extract<Entity, { start: Point }>;
      return [w.start, w.end];
    }
    case 'room':
      return (entity as Extract<Entity, { points: Point[] }>).points;
    case 'marker':
      return [(entity as Extract<Entity, { position: Point }>).position];
  }
}

/** Translate an entity in place. */
export function translateEntity(kind: EntityKind, entity: Entity, dx: number, dy: number): void {
  for (const p of entityPoints(kind, entity)) {
    p.x += dx;
    p.y += dy;
  }
}

/** All snap-able points on a level (wall endpoints and room vertices). */
export function levelSnapTargets(level: Level, exclude?: Point): Point[] {
  const out: Point[] = [];
  for (const w of level.walls) out.push(w.start, w.end);
  for (const r of level.rooms) out.push(...r.points);
  return exclude ? out.filter((p) => p !== exclude) : out;
}

export function levelBounds(level: Level): Bounds | null {
  return boundsOf([
    ...level.walls.flatMap((w) => [w.start, w.end]),
    ...level.rooms.flatMap((r) => r.points),
    ...level.markers.map((m) => m.position),
  ]);
}

/** Elevation for a new level stacked on top of the existing ones. */
export function nextLevelElevation(plan: FloorPlan): number {
  return plan.levels.reduce((top, l) => Math.max(top, l.elevation + l.height), 0);
}
