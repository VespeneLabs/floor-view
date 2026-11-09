import { PLAN_FORMAT_VERSION, type FloorPlan, type Level, type Marker, type Point, type Room, type Wall } from './types';

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
  const data = optData(o.data, `${path}.data`);
  if (data) m.data = data;
  return m;
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
  };
}

/**
 * Validate untrusted input (e.g. parsed JSON) and return a normalized `FloorPlan`.
 * Unknown properties are dropped. Throws `PlanValidationError` with a JSON path on failure.
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
  });

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
