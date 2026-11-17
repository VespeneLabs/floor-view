import type { ModelAsset } from './assets';
import { polygonArea } from './geometry';
import type { PipeMedium } from './pipeline';
import { syncPipelineLinks } from './pipeline';
import { clonePlan, collectionOf, createId, createLevel, getLevel, nextLevelElevation, removeEntity, translateEntity } from './plan';
import { routePipeline } from './routing';
import type { Entity, EntityKind, FloorPlan, Level, Marker, Metadata, PipePoint, Pipeline, Point, Room, Wall } from './types';
import { parseEntity, parsePlan, PlanValidationError } from './validate';

/**
 * Plan edit commands: a serializable description of changes to a plan (JSON in, JSON out), e.g.
 * the tool calls of an AI assistant or a script. `applyPlanCommands` validates and applies a list
 * as one all-or-nothing change; `FloorplanEditor.applyCommands` does the same as one undo step.
 *
 * Add commands take an optional `id` (unique in the plan), so later commands of the same list can
 * refer to what an earlier one created; without it an id is generated and reported in `created`.
 */

/** A pipeline vertex in a command: `z` (height above the floor, m) defaults to the command's `elevation`. */
export interface PipePointInput extends Point {
  z?: number;
}

/** Which entity a command changes. `levelId` is optional: ids are unique in a plan. */
export interface EntityTarget {
  kind: EntityKind;
  id: string;
  levelId?: string;
}

export type PlanCommand =
  | { type: 'setPlanName'; name: string }
  | { type: 'addLevel'; id?: string; name?: string; elevation?: number; height?: number }
  | { type: 'updateLevel'; levelId: string; name?: string; elevation?: number; height?: number }
  | { type: 'removeLevel'; levelId: string }
  | { type: 'addWall'; levelId: string; id?: string; start: Point; end: Point; thickness?: number; height?: number }
  | { type: 'addRoom'; levelId: string; id?: string; name?: string; points: Point[]; color?: string; data?: Metadata }
  | {
      type: 'addMarker';
      levelId: string;
      id?: string;
      name?: string;
      position: Point;
      kind?: string;
      color?: string;
      model?: string;
      rotation?: number;
      scale?: number;
      elevation?: number;
      pipelineId?: string;
      data?: Metadata;
    }
  | {
      type: 'addPipeline';
      levelId: string;
      id?: string;
      name?: string;
      /** The route. Without it the pipeline is routed automatically between the markers `from` and `to`. */
      points?: PipePointInput[];
      from?: string;
      to?: string;
      elevation?: number;
      diameter?: number;
      medium?: string;
      color?: string;
      data?: Metadata;
    }
  | ({ type: 'updateEntity'; patch: Record<string, unknown> } & EntityTarget)
  | ({ type: 'moveEntity'; dx: number; dy: number } & EntityTarget)
  | ({ type: 'removeEntity' } & EntityTarget);

export type PlanCommandType = PlanCommand['type'];

export interface ApplyPlanCommandsOptions {
  /**
   * The 3D models markers may use. When given, a marker `model` must be one of them, and fittings
   * on a pipeline are centered on it by their model height (as in the editor).
   */
  assets?: readonly ModelAsset[] | ReadonlyMap<string, ModelAsset>;
  /**
   * Pipe media presets. A pipeline `medium` that matches one by id or name (ignoring case) becomes
   * its id and, unless the command says otherwise, takes its color and diameter. Other media stay free text.
   */
  media?: readonly PipeMedium[];
  /** Most commands accepted in one list. Default 500. */
  maxCommands?: number;
}

export interface PlanCommandError {
  /** Index of the command in the list; -1 for an error about the list or the resulting plan as a whole. */
  index: number;
  /** The command's `type`, when it has one. */
  type?: string;
  /** Readable, and written so an assistant can correct the command. */
  message: string;
}

/** Something an add command created. For a level, `id` and `levelId` are the same. */
export interface CreatedEntity {
  index: number;
  kind: EntityKind | 'level';
  id: string;
  levelId: string;
}

export type PlanCommandResult =
  | { ok: true; plan: FloorPlan; created: CreatedEntity[] }
  | { ok: false; errors: PlanCommandError[] };

/** Defaults shared with the editor's tools. */
const DEFAULT_WALL_THICKNESS = 0.15;
const DEFAULT_PIPE_ELEVATION = 2.6;
const DEFAULT_PIPE_DIAMETER = 0.05;

const KINDS: readonly EntityKind[] = ['wall', 'room', 'marker', 'pipeline'];
const ID_PREFIX: Record<EntityKind, string> = { wall: 'wall', room: 'room', marker: 'marker', pipeline: 'pipe' };

/** What `updateEntity` may change, per kind; `required` properties cannot be removed with null. */
const PATCHABLE: Record<EntityKind, { all: readonly string[]; required: readonly string[] }> = {
  wall: { all: ['start', 'end', 'thickness', 'height'], required: ['start', 'end', 'thickness'] },
  room: { all: ['name', 'points', 'color', 'data'], required: ['name', 'points'] },
  marker: {
    all: ['name', 'position', 'kind', 'color', 'model', 'rotation', 'scale', 'elevation', 'pipelineId', 'data'],
    required: ['name', 'position'],
  },
  pipeline: { all: ['name', 'points', 'diameter', 'medium', 'color', 'from', 'to', 'data'], required: ['name', 'points', 'diameter'] },
};

// ---- JSON Schemas (also the source of each command's allowed properties) ----

type Schema = Record<string, unknown>;

const POINT: Schema = {
  type: 'object',
  properties: { x: { type: 'number' }, y: { type: 'number' } },
  required: ['x', 'y'],
  additionalProperties: false,
};
const PIPE_POINT: Schema = {
  type: 'object',
  properties: {
    x: { type: 'number' },
    y: { type: 'number' },
    z: { type: 'number', description: 'Height above the level floor in meters. Default: the command\'s elevation.' },
  },
  required: ['x', 'y'],
  additionalProperties: false,
};
const NEW_ID: Schema = {
  type: 'string',
  description: 'Optional id for the new item, unique in the plan, so later commands in the same list can refer to it. Omit to have one generated.',
};
const LEVEL_ID: Schema = { type: 'string', description: 'Id of the level.' };
const DATA: Schema = { type: 'object', description: 'Free-form metadata of the host application.' };
const TARGET: Schema = {
  kind: { type: 'string', enum: [...KINDS], description: 'What the id refers to.' },
  id: { type: 'string', description: 'Id of the wall, room, marker or pipeline.' },
  levelId: { type: 'string', description: 'Optional: the level the item is on (ids are unique in a plan).' },
};

function object(properties: Schema, required: string[]): Schema {
  return { type: 'object', properties, required, additionalProperties: false };
}

export interface PlanCommandDefinition {
  /** The command's `type`. */
  type: PlanCommandType;
  /** A tool name for the command, e.g. `add_wall`. */
  name: string;
  description: string;
  /** JSON Schema of the command without its `type`. */
  input_schema: Record<string, unknown>;
}

const UNITS = 'Coordinates are plan meters: x grows to the right, y grows down (as on a drawing seen from above).';

/**
 * One definition per command: its `type`, a tool name, a description and the JSON Schema of its
 * other properties. Usable directly as tool definitions (`{ name, description, input_schema }`);
 * turn a tool call back into a command with `planCommandFromTool`.
 */
export const PLAN_COMMAND_DEFINITIONS: readonly PlanCommandDefinition[] = [
  {
    type: 'setPlanName',
    name: 'set_plan_name',
    description: 'Rename the plan.',
    input_schema: object({ name: { type: 'string' } }, ['name']),
  },
  {
    type: 'addLevel',
    name: 'add_level',
    description: 'Add a level (storey). Without an elevation it is stacked on top of the existing levels.',
    input_schema: object(
      {
        id: NEW_ID,
        name: { type: 'string' },
        elevation: { type: 'number', description: 'Height of the level floor above ground in meters.' },
        height: { type: 'number', description: 'Default wall height in meters. Default: the height of the first level.' },
      },
      [],
    ),
  },
  {
    type: 'updateLevel',
    name: 'update_level',
    description: 'Change a level\'s name, floor elevation or default wall height.',
    input_schema: object(
      { levelId: LEVEL_ID, name: { type: 'string' }, elevation: { type: 'number' }, height: { type: 'number', description: 'Default wall height in meters.' } },
      ['levelId'],
    ),
  },
  {
    type: 'removeLevel',
    name: 'remove_level',
    description: 'Remove a level with everything on it. The last level of a plan cannot be removed.',
    input_schema: object({ levelId: LEVEL_ID }, ['levelId']),
  },
  {
    type: 'addWall',
    name: 'add_wall',
    description: `Add a straight wall between two points. ${UNITS} Walls that should meet must share an end point exactly.`,
    input_schema: object(
      {
        levelId: LEVEL_ID,
        id: NEW_ID,
        start: POINT,
        end: POINT,
        thickness: { type: 'number', description: `Meters. Default ${DEFAULT_WALL_THICKNESS}.` },
        height: { type: 'number', description: 'Meters. Default: the level\'s wall height.' },
      },
      ['levelId', 'start', 'end'],
    ),
  },
  {
    type: 'addRoom',
    name: 'add_room',
    description: `Add a room: a floor area with a name, given by its outline. ${UNITS} A room does not create walls.`,
    input_schema: object(
      {
        levelId: LEVEL_ID,
        id: NEW_ID,
        name: { type: 'string' },
        points: { type: 'array', items: POINT, minItems: 3, description: 'The outline, in order, not closed (the last point is not the first again).' },
        color: { type: 'string', description: 'CSS color of the floor.' },
        data: DATA,
      },
      ['levelId', 'points'],
    ),
  },
  {
    type: 'addMarker',
    name: 'add_marker',
    description: `Add a marker: a named point, or a piece of equipment or furniture when it has a 3D model. ${UNITS}`,
    input_schema: object(
      {
        levelId: LEVEL_ID,
        id: NEW_ID,
        name: { type: 'string', description: 'Default: the model\'s name with a number.' },
        position: { ...POINT, description: 'Center of the marker (of the model\'s footprint).' },
        kind: { type: 'string', description: 'Free-form category, e.g. "sensor".' },
        color: { type: 'string', description: 'CSS color (the accent color of a 3D model).' },
        model: { type: 'string', description: 'Id of a 3D model from the catalog.' },
        rotation: { type: 'number', description: 'Degrees clockwise seen from above; at 0 the model\'s front faces +y (down the drawing).' },
        scale: { type: 'number', description: 'Uniform scale of the model. Default 1.' },
        elevation: { type: 'number', description: 'Height above the level floor in meters. Default 0.' },
        pipelineId: { type: 'string', description: 'Id of the pipeline this marker sits on (a valve or meter): it is moved onto the pipe.' },
        data: DATA,
      },
      ['levelId', 'position'],
    ),
  },
  {
    type: 'addPipeline',
    name: 'add_pipeline',
    description: `Add a pipeline. Either give its route as points (one per bend), or leave points out and give two markers as from and to: the route is then found automatically (orthogonal, few bends, beside walls). ${UNITS}`,
    input_schema: object(
      {
        levelId: LEVEL_ID,
        id: NEW_ID,
        name: { type: 'string' },
        points: {
          type: 'array',
          items: PIPE_POINT,
          minItems: 2,
          description: 'The route. Two consecutive points with the same x and y and another z make a vertical riser.',
        },
        from: { type: 'string', description: 'Id of the marker the first point is attached to (the end moves onto it).' },
        to: { type: 'string', description: 'Id of the marker the last point is attached to.' },
        elevation: { type: 'number', description: `Height of the run above the floor in meters, for points without z and for automatic routes. Default ${DEFAULT_PIPE_ELEVATION}.` },
        diameter: { type: 'number', description: `Outer diameter in meters. Default: the medium's typical diameter, else ${DEFAULT_PIPE_DIAMETER}.` },
        medium: { type: 'string', description: 'What the pipe carries, e.g. "N2".' },
        color: { type: 'string', description: 'CSS color. Default: the medium\'s color.' },
        data: DATA,
      },
      ['levelId'],
    ),
  },
  {
    type: 'updateEntity',
    name: 'update_entity',
    description:
      'Change properties of a wall, room, marker or pipeline. patch holds only the properties to change; null removes an optional property. ' +
      'wall: start, end, thickness, height. room: name, points, color, data. ' +
      'marker: name, position, kind, color, model, rotation, scale, elevation, pipelineId, data. ' +
      'pipeline: name, points (each with x, y, z), diameter, medium, color, from, to, data.',
    input_schema: object({ ...TARGET, patch: { type: 'object', description: 'Properties to set, by name.' } }, ['kind', 'id', 'patch']),
  },
  {
    type: 'moveEntity',
    name: 'move_entity',
    description: `Move a wall, room, marker or pipeline by an offset, keeping its shape. ${UNITS} Pipeline ends attached to a marker follow the marker.`,
    input_schema: object({ ...TARGET, dx: { type: 'number', description: 'Meters to the right.' }, dy: { type: 'number', description: 'Meters down.' } }, ['kind', 'id', 'dx', 'dy']),
  },
  {
    type: 'removeEntity',
    name: 'remove_entity',
    description: 'Remove a wall, room, marker or pipeline. Pipelines attached to a removed marker stay, detached.',
    input_schema: object({ ...TARGET }, ['kind', 'id']),
  },
];

const DEFINITION_BY_TYPE = new Map(PLAN_COMMAND_DEFINITIONS.map((d) => [d.type as string, d]));
const DEFINITION_BY_NAME = new Map(PLAN_COMMAND_DEFINITIONS.map((d) => [d.name, d]));

/**
 * A single tool that takes a whole list of commands, applied together or not at all: its input is
 * `{ commands: PlanCommand[] }`, each command with its `type`.
 */
export const PLAN_COMMANDS_TOOL: { name: string; description: string; input_schema: Record<string, unknown> } = {
  name: 'apply_plan_commands',
  description:
    'Edit the floor plan with a list of commands, applied in order as one change: if any command is invalid, nothing is changed and every error is reported with the index of its command. ' +
    `${UNITS} Lengths are meters.`,
  input_schema: object(
    {
      commands: {
        type: 'array',
        minItems: 1,
        items: {
          anyOf: PLAN_COMMAND_DEFINITIONS.map((d) => {
            const schema = d.input_schema as { properties: Schema; required: string[] };
            return {
              type: 'object',
              description: d.description,
              properties: { type: { type: 'string', const: d.type }, ...schema.properties },
              required: ['type', ...schema.required],
              additionalProperties: false,
            };
          }),
        },
      },
    },
    ['commands'],
  ),
};

/**
 * The command for a call of one of the per-command tools (`PLAN_COMMAND_DEFINITIONS[].name`), or
 * null for another tool name. The input is not validated here: `applyPlanCommands` does that.
 */
export function planCommandFromTool(name: string, input: unknown): PlanCommand | null {
  const definition = DEFINITION_BY_NAME.get(name);
  if (!definition) return null;
  const rest = typeof input === 'object' && input !== null && !Array.isArray(input) ? input : {};
  return { ...rest, type: definition.type } as PlanCommand;
}

// ---- Applying ----

class CommandError extends Error {}

function fail(message: string): never {
  throw new CommandError(message);
}

type Input = Record<string, unknown>;

function describe(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'an array';
  if (typeof value === 'number' && !Number.isFinite(value)) return 'a non-finite number';
  return typeof value === 'string' ? JSON.stringify(value.length > 40 ? `${value.slice(0, 40)}…` : value) : `a ${typeof value}`;
}

function str(o: Input, key: string): string {
  const v = o[key];
  if (typeof v !== 'string' || v.length === 0) fail(`"${key}" must be a non-empty string, got ${describe(v)}.`);
  return v;
}

function optStr(o: Input, key: string): string | undefined {
  return o[key] === undefined ? undefined : str(o, key);
}

/** Like `optStr`, but an empty string is allowed (names). */
function optText(o: Input, key: string): string | undefined {
  const v = o[key];
  if (v === undefined) return undefined;
  if (typeof v !== 'string') fail(`"${key}" must be a string, got ${describe(v)}.`);
  return v;
}

function num(o: Input, key: string, { positive = false } = {}): number {
  const v = o[key];
  if (typeof v !== 'number' || !Number.isFinite(v)) fail(`"${key}" must be a finite number, got ${describe(v)}.`);
  if (positive && v <= 0) fail(`"${key}" must be greater than 0, got ${v}.`);
  return v;
}

function optNum(o: Input, key: string, options?: { positive?: boolean }): number | undefined {
  return o[key] === undefined ? undefined : num(o, key, options);
}

function record(value: unknown, what: string): Input {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) fail(`${what} must be an object, got ${describe(value)}.`);
  return value as Input;
}

function point(value: unknown, what: string): Point {
  const o = record(value, what);
  const { x, y } = o;
  if (typeof x !== 'number' || !Number.isFinite(x) || typeof y !== 'number' || !Number.isFinite(y)) {
    fail(`${what} must be a point { x, y } with finite numbers.`);
  }
  return { x, y };
}

function points(value: unknown, what: string): unknown[] {
  if (!Array.isArray(value)) fail(`${what} must be an array of points, got ${describe(value)}.`);
  return value;
}

function optData(o: Input): Metadata | undefined {
  return o.data === undefined ? undefined : (structuredClone(record(o.data, '"data"')) as Metadata);
}

function normalizeRotation(degrees: number): number {
  return ((degrees % 360) + 360) % 360;
}

/** The next free "Base N" name, numbered like the editor's tools. */
function numbered(base: string, names: string[]): string {
  const pattern = new RegExp(`^${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\d+$`);
  return `${base} ${names.filter((n) => pattern.test(n)).length + 1}`;
}

interface Context {
  plan: FloorPlan;
  assets: ReadonlyMap<string, ModelAsset> | null;
  media: readonly PipeMedium[];
  created: CreatedEntity[];
  index: number;
}

function planIds(plan: FloorPlan): Set<string> {
  const ids = new Set<string>();
  for (const level of plan.levels) {
    ids.add(level.id);
    for (const kind of KINDS) for (const e of collectionOf(level, kind)) ids.add(e.id);
  }
  return ids;
}

function newId(ctx: Context, o: Input, prefix: string): string {
  const ids = planIds(ctx.plan);
  const given = optStr(o, 'id');
  if (given !== undefined) {
    if (ids.has(given)) fail(`The id "${given}" is already used in the plan. Choose another id or leave it out.`);
    return given;
  }
  let id = createId(prefix);
  while (ids.has(id)) id = createId(prefix);
  return id;
}

function levelOf(ctx: Context, o: Input): Level {
  const id = str(o, 'levelId');
  const level = getLevel(ctx.plan, id);
  if (!level) fail(`There is no level "${id}". Levels: ${ctx.plan.levels.map((l) => `"${l.id}" (${l.name})`).join(', ')}.`);
  return level;
}

function target(ctx: Context, o: Input): { kind: EntityKind; level: Level; entity: Entity; list: Entity[]; at: number } {
  const kind = o.kind as EntityKind;
  if (!KINDS.includes(kind)) fail(`"kind" must be one of ${KINDS.join(', ')}, got ${describe(o.kind)}.`);
  const id = str(o, 'id');
  const levels = o.levelId === undefined ? ctx.plan.levels : [levelOf(ctx, o)];
  for (const level of levels) {
    const list = collectionOf(level, kind);
    const at = list.findIndex((e) => e.id === id);
    if (at >= 0) return { kind, level, entity: list[at]!, list, at };
  }
  for (const level of ctx.plan.levels) {
    for (const other of KINDS) {
      if (other !== kind && collectionOf(level, other).some((e) => e.id === id)) fail(`"${id}" is a ${other}, not a ${kind}.`);
    }
  }
  return fail(`There is no ${kind} "${id}"${o.levelId === undefined ? '' : ` on level "${String(o.levelId)}"`}.`);
}

/** Checks beyond the plan format's own (`parseEntity`), and the links to other entities. */
function check(ctx: Context, level: Level, kind: EntityKind, value: unknown): Entity {
  let entity: Entity;
  try {
    entity = parseEntity(kind, value, kind);
  } catch (err) {
    if (err instanceof PlanValidationError) fail(`${err.path.replace(/^\w+\.?/, '') || kind}: ${err.message.slice(err.path.length + 2)}.`);
    throw err;
  }
  if (kind === 'wall') {
    const wall = entity as Wall;
    if (Math.hypot(wall.end.x - wall.start.x, wall.end.y - wall.start.y) < 0.01) fail('The wall has no length: start and end are the same point.');
  } else if (kind === 'room') {
    const room = entity as Room;
    if (polygonArea(room.points) < 1e-4) fail('The room outline has no area: give at least 3 points that are not on one line.');
  } else if (kind === 'marker') {
    const marker = entity as Marker;
    if (marker.rotation !== undefined) marker.rotation = normalizeRotation(marker.rotation);
    if (marker.model !== undefined && ctx.assets && !ctx.assets.has(marker.model)) {
      const word = marker.model.split('/').at(-1)!.toLowerCase();
      const similar = [...ctx.assets.keys()].filter((id) => id.toLowerCase().includes(word)).slice(0, 5);
      fail(`There is no 3D model "${marker.model}" in the catalog.${similar.length ? ` Similar ids: ${similar.join(', ')}.` : ''}`);
    }
    if (marker.pipelineId !== undefined && !level.pipelines.some((p) => p.id === marker.pipelineId)) {
      fail(`"pipelineId": there is no pipeline "${marker.pipelineId}" on level "${level.id}".`);
    }
  } else {
    const pipe = entity as Pipeline;
    for (const key of ['from', 'to'] as const) {
      const id = pipe[key];
      if (id !== undefined && !level.markers.some((m) => m.id === id)) fail(`"${key}": there is no marker "${id}" on level "${level.id}".`);
    }
    if (pipe.from !== undefined && pipe.from === pipe.to) fail('"from" and "to" are the same marker.');
    if (pipe.medium !== undefined) pipe.medium = medium(ctx, pipe.medium)?.id ?? pipe.medium;
  }
  return entity;
}

function medium(ctx: Context, name: string): PipeMedium | undefined {
  const key = name.toLowerCase();
  return ctx.media.find((m) => m.id.toLowerCase() === key) ?? ctx.media.find((m) => m.name.toLowerCase() === key);
}

/** Copy the optional properties that are present. */
function pick(o: Input, keys: readonly string[]): Input {
  const out: Input = {};
  for (const key of keys) if (o[key] !== undefined) out[key] = o[key];
  return out;
}

function add(ctx: Context, level: Level, kind: EntityKind, value: Input): void {
  const entity = check(ctx, level, kind, value);
  collectionOf(level, kind).push(entity);
  ctx.created.push({ index: ctx.index, kind, id: entity.id, levelId: level.id });
}

const HANDLERS: Record<PlanCommandType, (ctx: Context, o: Input) => void> = {
  setPlanName(ctx, o) {
    ctx.plan.name = optText(o, 'name') ?? fail('"name" is required.');
  },

  addLevel(ctx, o) {
    const level = createLevel({
      id: newId(ctx, o, 'level'),
      name: optText(o, 'name') ?? `Level ${ctx.plan.levels.length}`,
      elevation: optNum(o, 'elevation') ?? nextLevelElevation(ctx.plan),
      height: optNum(o, 'height', { positive: true }) ?? ctx.plan.levels[0]!.height,
    });
    ctx.plan.levels.push(level);
    ctx.created.push({ index: ctx.index, kind: 'level', id: level.id, levelId: level.id });
  },

  updateLevel(ctx, o) {
    const level = levelOf(ctx, o);
    const name = optText(o, 'name');
    const elevation = optNum(o, 'elevation');
    const height = optNum(o, 'height', { positive: true });
    if (name === undefined && elevation === undefined && height === undefined) fail('Nothing to change: give a name, elevation or height.');
    if (name !== undefined) level.name = name;
    if (elevation !== undefined) level.elevation = elevation;
    if (height !== undefined) level.height = height;
  },

  removeLevel(ctx, o) {
    const level = levelOf(ctx, o);
    if (ctx.plan.levels.length <= 1) fail('The last level of a plan cannot be removed.');
    ctx.plan.levels = ctx.plan.levels.filter((l) => l !== level);
  },

  addWall(ctx, o) {
    const level = levelOf(ctx, o);
    add(ctx, level, 'wall', {
      id: newId(ctx, o, ID_PREFIX.wall),
      start: point(o.start, '"start"'),
      end: point(o.end, '"end"'),
      thickness: optNum(o, 'thickness', { positive: true }) ?? DEFAULT_WALL_THICKNESS,
      ...pick(o, ['height']),
    });
  },

  addRoom(ctx, o) {
    const level = levelOf(ctx, o);
    add(ctx, level, 'room', {
      id: newId(ctx, o, ID_PREFIX.room),
      name: optText(o, 'name') ?? '',
      points: points(o.points, '"points"').map((p, i) => point(p, `"points[${i}]"`)),
      ...pick(o, ['color']),
      ...(o.data === undefined ? {} : { data: optData(o) }),
    });
  },

  addMarker(ctx, o) {
    const level = levelOf(ctx, o);
    const model = optStr(o, 'model');
    const base = model === undefined ? undefined : ctx.assets?.get(model)?.name;
    const names = level.markers.map((m) => m.name);
    add(ctx, level, 'marker', {
      id: newId(ctx, o, ID_PREFIX.marker),
      name: optText(o, 'name') ?? (base ? numbered(base, names) : `Marker ${level.markers.length + 1}`),
      position: point(o.position, '"position"'),
      ...pick(o, ['kind', 'color', 'model', 'rotation', 'scale', 'elevation', 'pipelineId']),
      ...(o.data === undefined ? {} : { data: optData(o) }),
    });
  },

  addPipeline(ctx, o) {
    const level = levelOf(ctx, o);
    const preset = o.medium === undefined ? undefined : medium(ctx, str(o, 'medium'));
    const elevation = optNum(o, 'elevation') ?? DEFAULT_PIPE_ELEVATION;
    const diameter = optNum(o, 'diameter', { positive: true }) ?? preset?.diameter ?? DEFAULT_PIPE_DIAMETER;
    const from = optStr(o, 'from');
    const to = optStr(o, 'to');
    let route: PipePoint[];
    if (o.points === undefined) {
      const ends = [from, to].map((id, i) => {
        const key = i === 0 ? 'from' : 'to';
        if (id === undefined) fail('Give "points", or both "from" and "to" (marker ids) to have the route found automatically.');
        return level.markers.find((m) => m.id === id) ?? fail(`"${key}": there is no marker "${id}" on level "${level.id}".`);
      });
      if (from === to) fail('"from" and "to" are the same marker.');
      route = routePipeline(level, ends[0]!.position, ends[1]!.position, { elevation, diameter }) ?? fail('No route was found between the two markers. Give "points" instead.');
    } else {
      route = points(o.points, '"points"').map((p, i) => {
        const z = (record(p, `"points[${i}]"`) as Input).z;
        if (z !== undefined && (typeof z !== 'number' || !Number.isFinite(z))) fail(`"points[${i}].z" must be a finite number, got ${describe(z)}.`);
        return { ...point(p, `"points[${i}]"`), z: (z as number | undefined) ?? elevation };
      });
    }
    add(ctx, level, 'pipeline', {
      id: newId(ctx, o, ID_PREFIX.pipeline),
      name: optText(o, 'name') ?? numbered(preset?.name ?? 'Pipeline', level.pipelines.map((p) => p.name)),
      points: route,
      diameter,
      ...pick(o, ['medium', 'from', 'to']),
      ...(o.color !== undefined || preset ? { color: o.color ?? preset!.color } : {}),
      ...(o.data === undefined ? {} : { data: optData(o) }),
    });
  },

  updateEntity(ctx, o) {
    const { kind, level, entity, list, at } = target(ctx, o);
    const patch = record(o.patch, '"patch"');
    const allowed = PATCHABLE[kind];
    const keys = Object.keys(patch);
    if (keys.length === 0) fail('"patch" is empty: nothing to change.');
    const next: Input = { ...(entity as unknown as Input) };
    for (const key of keys) {
      if (key === 'id') fail('The id of an item cannot be changed.');
      if (!allowed.all.includes(key)) fail(`A ${kind} has no property "${key}" to change. Properties: ${allowed.all.join(', ')}.`);
      const value = patch[key];
      if (value === null) {
        if (allowed.required.includes(key)) fail(`"${key}" cannot be removed from a ${kind}.`);
        delete next[key];
      } else next[key] = structuredClone(value);
    }
    list[at] = check(ctx, level, kind, next);
  },

  moveEntity(ctx, o) {
    const { kind, entity } = target(ctx, o);
    translateEntity(kind, entity, num(o, 'dx'), num(o, 'dy'));
  },

  removeEntity(ctx, o) {
    const { kind, level, entity } = target(ctx, o);
    removeEntity(ctx.plan, { kind, id: entity.id, levelId: level.id });
  },
};

function fittingOffset(assets: ReadonlyMap<string, ModelAsset> | null): (marker: Marker) => number | null {
  return (marker) => {
    if (!marker.model) return 0;
    const asset = assets?.get(marker.model);
    if (!asset || asset.mounted) return null;
    return (asset.size.height * (marker.scale ?? 1)) / 2;
  };
}

/**
 * Validate and apply a list of commands to a copy of `plan`. All or nothing: either every command
 * is valid and the new plan is returned with the ids of what was created, or the plan is left
 * alone and every invalid command is reported with its index and a readable message. Commands are
 * untrusted input (e.g. an assistant's tool calls): anything may be passed. The given plan is
 * never changed.
 *
 * After the commands, linked pipeline ends move onto their markers and fittings onto their
 * pipelines (`syncPipelineLinks`), as after every edit in the editor.
 */
export function applyPlanCommands(plan: FloorPlan, commands: readonly unknown[], options: ApplyPlanCommandsOptions = {}): PlanCommandResult {
  const max = options.maxCommands ?? 500;
  if (!Array.isArray(commands)) return { ok: false, errors: [{ index: -1, message: 'The commands must be an array.' }] };
  if (commands.length > max) return { ok: false, errors: [{ index: -1, message: `Too many commands: ${commands.length}, at most ${max} in one list.` }] };

  const assets = !options.assets ? null : options.assets instanceof Map ? (options.assets as ReadonlyMap<string, ModelAsset>) : new Map((options.assets as readonly ModelAsset[]).map((a) => [a.id, a]));
  const ctx: Context = { plan: clonePlan(plan), assets, media: options.media ?? [], created: [], index: 0 };
  const errors: PlanCommandError[] = [];

  commands.forEach((command, index) => {
    ctx.index = index;
    const type = typeof command === 'object' && command !== null ? (command as Input).type : undefined;
    const report = (message: string): void => {
      errors.push({ index, ...(typeof type === 'string' ? { type } : {}), message });
    };
    const definition = typeof type === 'string' ? DEFINITION_BY_TYPE.get(type) : undefined;
    if (!definition) {
      report(`Unknown command type ${describe(type ?? command)}. Types: ${PLAN_COMMAND_DEFINITIONS.map((d) => d.type).join(', ')}.`);
      return;
    }
    const allowed = Object.keys((definition.input_schema as { properties: Schema }).properties);
    const unknown = Object.keys(command as Input).filter((key) => key !== 'type' && !allowed.includes(key));
    if (unknown.length) {
      report(`${definition.type} has no property ${unknown.map((k) => `"${k}"`).join(', ')}. Properties: ${allowed.join(', ')}.`);
      return;
    }
    // A failed command must not leave half a change behind for the ones after it.
    const before = clonePlan(ctx.plan);
    const created = ctx.created.length;
    try {
      HANDLERS[definition.type](ctx, command as Input);
    } catch (err) {
      if (!(err instanceof CommandError)) throw err;
      ctx.plan = before;
      ctx.created.length = created;
      report(err.message);
    }
  });
  if (errors.length) return { ok: false, errors };

  for (const level of ctx.plan.levels) syncPipelineLinks(level, { fittingOffset: fittingOffset(assets) });
  try {
    parsePlan(ctx.plan);
  } catch (err) {
    return { ok: false, errors: [{ index: -1, message: `The resulting plan is not valid: ${(err as Error).message}.` }] };
  }
  // Something created by one command and removed by a later one was not created.
  const ids = planIds(ctx.plan);
  return { ok: true, plan: ctx.plan, created: ctx.created.filter((c) => ids.has(c.id)) };
}
