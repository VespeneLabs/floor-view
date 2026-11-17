import {
  PLAN_FORMAT_VERSION,
  type Entity,
  type EntityKind,
  type FloorPlan,
  type Level,
  type Marker,
  type PipePoint,
  type Pipeline,
  type Point,
  type Room,
  type Wall,
} from './types';

export class PlanValidationError extends Error {
  constructor(
    readonly path: string,
    message: string,
  ) {
    super(`${path}: ${message}`);
    this.name = 'PlanValidationError';
  }
}

type Obj = Record<string, unknown>;

function obj(value: unknown, path: string): Obj {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new PlanValidationError(path, 'expected an object');
  }
  return value as Obj;
}

function arr(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) throw new PlanValidationError(path, 'expected an array');
  return value;
}

function str(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new PlanValidationError(path, 'expected a non-empty string');
  }
  return value;
}

function num(value: unknown, path: string, { positive = false } = {}): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new PlanValidationError(path, 'expected a finite number');
  }
  if (positive && value <= 0) throw new PlanValidationError(path, 'expected a positive number');
  return value;
}

function optStr(value: unknown, path: string): string | undefined {
  return value === undefined ? undefined : str(value, path);
}

function optData(value: unknown, path: string): Record<string, unknown> | undefined {
  return value === undefined ? undefined : obj(value, path);
}

function point(value: unknown, path: string): Point {
  const o = obj(value, path);
  return { x: num(o.x, `${path}.x`), y: num(o.y, `${path}.y`) };
}

function uniqueIds(items: { id: string }[], path: string, seen: Set<string>): void {
  items.forEach((item, i) => {
    if (seen.has(item.id)) throw new PlanValidationError(`${path}[${i}].id`, `duplicate id "${item.id}"`);
    seen.add(item.id);
  });
}

function wall(value: unknown, path: string): Wall {
  const o = obj(value, path);
  const w: Wall = {
    id: str(o.id, `${path}.id`),
    start: point(o.start, `${path}.start`),
    end: point(o.end, `${path}.end`),
    thickness: num(o.thickness, `${path}.thickness`, { positive: true }),
  };
  if (o.height !== undefined) w.height = num(o.height, `${path}.height`, { positive: true });
  return w;
}

function room(value: unknown, path: string): Room {
  const o = obj(value, path);
  const points = arr(o.points, `${path}.points`).map((p, i) => point(p, `${path}.points[${i}]`));
  if (points.length < 3) throw new PlanValidationError(`${path}.points`, 'a room needs at least 3 points');
  const r: Room = { id: str(o.id, `${path}.id`), name: typeof o.name === 'string' ? o.name : '', points };
  const color = optStr(o.color, `${path}.color`);
  if (color) r.color = color;
  const data = optData(o.data, `${path}.data`);
  if (data) r.data = data;
  return r;
}

function marker(value: unknown, path: string): Marker {
  const o = obj(value, path);
  const m: Marker = {
    id: str(o.id, `${path}.id`),
    name: typeof o.name === 'string' ? o.name : '',
    position: point(o.position, `${path}.position`),
  };
  const kind = optStr(o.kind, `${path}.kind`);
  if (kind) m.kind = kind;
  const color = optStr(o.color, `${path}.color`);
  if (color) m.color = color;
  const model = optStr(o.model, `${path}.model`);
  if (model) m.model = model;
  if (o.rotation !== undefined) m.rotation = num(o.rotation, `${path}.rotation`);
  if (o.scale !== undefined) m.scale = num(o.scale, `${path}.scale`, { positive: true });
  if (o.elevation !== undefined) m.elevation = num(o.elevation, `${path}.elevation`);
  const pipelineId = optStr(o.pipelineId, `${path}.pipelineId`);
  if (pipelineId) m.pipelineId = pipelineId;
  const data = optData(o.data, `${path}.data`);
  if (data) m.data = data;
  return m;
}

function pipePoint(value: unknown, path: string): PipePoint {
  const o = obj(value, path);
  return { x: num(o.x, `${path}.x`), y: num(o.y, `${path}.y`), z: num(o.z, `${path}.z`) };
}

function pipeline(value: unknown, path: string): Pipeline {
  const o = obj(value, path);
  const points = arr(o.points, `${path}.points`).map((p, i) => pipePoint(p, `${path}.points[${i}]`));
  if (points.length < 2) throw new PlanValidationError(`${path}.points`, 'a pipeline needs at least 2 points');
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    if (a.x === b.x && a.y === b.y && a.z === b.z) {
      throw new PlanValidationError(`${path}.points[${i}]`, 'repeats the previous point');
    }
  }
  const p: Pipeline = {
    id: str(o.id, `${path}.id`),
    name: typeof o.name === 'string' ? o.name : '',
    points,
    diameter: num(o.diameter, `${path}.diameter`, { positive: true }),
  };
  const medium = optStr(o.medium, `${path}.medium`);
  if (medium) p.medium = medium;
  const color = optStr(o.color, `${path}.color`);
  if (color) p.color = color;
  const from = optStr(o.from, `${path}.from`);
  if (from) p.from = from;
  const to = optStr(o.to, `${path}.to`);
  if (to) p.to = to;
  const data = optData(o.data, `${path}.data`);
  if (data) p.data = data;
  return p;
}

/**
 * Validate one entity (same rules as `parsePlan`) and return it normalized. Throws
 * `PlanValidationError` with a path under `path`.
 */
export function parseEntity(kind: EntityKind, value: unknown, path: string = kind): Entity {
  if (kind === 'wall') return wall(value, path);
  if (kind === 'room') return room(value, path);
  if (kind === 'marker') return marker(value, path);
  return pipeline(value, path);
}

/** Drop links that don't resolve on the same level (pipeline ends → markers, fittings → pipelines). */
function dropDanglingLinks(level: Level): void {
  const markerIds = new Set(level.markers.map((m) => m.id));
  const pipelineIds = new Set(level.pipelines.map((p) => p.id));
  for (const p of level.pipelines) {
    if (p.from !== undefined && !markerIds.has(p.from)) delete p.from;
    if (p.to !== undefined && !markerIds.has(p.to)) delete p.to;
  }
  for (const m of level.markers) {
    if (m.pipelineId !== undefined && !pipelineIds.has(m.pipelineId)) delete m.pipelineId;
  }
}

function level(value: unknown, path: string): Level {
  const o = obj(value, path);
  return {
    id: str(o.id, `${path}.id`),
    name: typeof o.name === 'string' ? o.name : '',
    elevation: num(o.elevation, `${path}.elevation`),
    height: num(o.height, `${path}.height`, { positive: true }),
    walls: arr(o.walls ?? [], `${path}.walls`).map((w, i) => wall(w, `${path}.walls[${i}]`)),
    rooms: arr(o.rooms ?? [], `${path}.rooms`).map((r, i) => room(r, `${path}.rooms[${i}]`)),
    markers: arr(o.markers ?? [], `${path}.markers`).map((m, i) => marker(m, `${path}.markers[${i}]`)),
    pipelines: arr(o.pipelines ?? [], `${path}.pipelines`).map((p, i) => pipeline(p, `${path}.pipelines[${i}]`)),
  };
}

/**
 * Validate untrusted input (e.g. parsed JSON) and return a normalized `FloorPlan`.
 * Unknown properties are dropped, and so are pipeline `from`/`to` and marker `pipelineId` links
 * that don't resolve to an entity on the same level. Throws `PlanValidationError` with a JSON path on failure.
 */
export function parsePlan(input: unknown): FloorPlan {
  const o = obj(input, '$');
  if (o.version !== PLAN_FORMAT_VERSION) {
    throw new PlanValidationError('$.version', `unsupported version ${String(o.version)}, expected ${PLAN_FORMAT_VERSION}`);
  }
  const levels = arr(o.levels, '$.levels').map((l, i) => level(l, `$.levels[${i}]`));
  if (levels.length === 0) throw new PlanValidationError('$.levels', 'a plan needs at least one level');

  const seen = new Set<string>();
  uniqueIds(levels, '$.levels', seen);
  levels.forEach((l, i) => {
    uniqueIds(l.walls, `$.levels[${i}].walls`, seen);
    uniqueIds(l.rooms, `$.levels[${i}].rooms`, seen);
    uniqueIds(l.markers, `$.levels[${i}].markers`, seen);
    uniqueIds(l.pipelines, `$.levels[${i}].pipelines`, seen);
  });
  levels.forEach(dropDanglingLinks);

  return { version: PLAN_FORMAT_VERSION, id: str(o.id, '$.id'), name: typeof o.name === 'string' ? o.name : '', levels };
}

/** Parse a JSON string into a validated plan. */
export function parsePlanJSON(json: string): FloorPlan {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch (err) {
    throw new PlanValidationError('$', `invalid JSON: ${(err as Error).message}`);
  }
  return parsePlan(data);
}
