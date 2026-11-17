import { describe, expect, it } from 'vitest';
import type { ModelAsset } from '../src/model/assets';
import { applyPlanCommands, PLAN_COMMAND_DEFINITIONS, PLAN_COMMANDS_TOOL, planCommandFromTool, type PlanCommand } from '../src/model/commands';
import { describePlan } from '../src/model/describe';
import { createLevel, createPlan } from '../src/model/plan';
import type { PipeMedium } from '../src/model/pipeline';
import type { FloorPlan } from '../src/model/types';
import { parsePlan } from '../src/model/validate';

const TANK: ModelAsset = { id: 'kit/tank', name: 'Tank', url: 'tank.glb', size: { width: 2, depth: 2, height: 3 } };
const VALVE: ModelAsset = { id: 'kit/valve', name: 'Valve', url: 'valve.glb', size: { width: 0.2, depth: 0.2, height: 0.4 } };
const MEDIA: PipeMedium[] = [{ id: 'N2', name: 'Nitrogen', color: '#16a34a', diameter: 0.08 }];

function basePlan(): FloorPlan {
  const plan = createPlan('Works');
  plan.levels = [
    createLevel({
      id: 'L1',
      name: 'Ground',
      height: 3,
      walls: [{ id: 'w1', start: { x: 0, y: 0 }, end: { x: 10, y: 0 }, thickness: 0.2 }],
      rooms: [{ id: 'r1', name: 'Hall', points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 8 }, { x: 0, y: 8 }] }],
      markers: [
        { id: 'm1', name: 'Tank 1', position: { x: 2, y: 2 }, model: 'kit/tank' },
        { id: 'm2', name: 'Tank 2', position: { x: 8, y: 6 }, model: 'kit/tank' },
      ],
    }),
  ];
  return plan;
}

const apply = (commands: unknown[], plan = basePlan()) => applyPlanCommands(plan, commands, { assets: [TANK, VALVE], media: MEDIA });
const level = (plan: FloorPlan, id = 'L1') => plan.levels.find((l) => l.id === id)!;

describe('applyPlanCommands', () => {
  it('applies a list in order and reports what was created, leaving the input plan alone', () => {
    const plan = basePlan();
    const before = JSON.stringify(plan);
    const result = apply(
      [
        { type: 'setPlanName', name: 'Works 2' },
        { type: 'addWall', levelId: 'L1', start: { x: 10, y: 0 }, end: { x: 10, y: 8 } },
        { type: 'addRoom', levelId: 'L1', id: 'office', name: 'Office', points: [{ x: 10, y: 0 }, { x: 14, y: 0 }, { x: 14, y: 4 }, { x: 10, y: 4 }] },
        { type: 'addMarker', levelId: 'L1', position: { x: 5, y: 5 }, model: 'kit/tank', rotation: -90 },
        { type: 'updateEntity', kind: 'room', id: 'office', patch: { color: '#fee' } },
        { type: 'moveEntity', kind: 'marker', id: 'm1', dx: 1, dy: -1 },
        { type: 'removeEntity', kind: 'wall', id: 'w1' },
      ],
      plan,
    );
    expect(JSON.stringify(plan)).toBe(before);
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    const l = level(result.plan);
    expect(result.plan.name).toBe('Works 2');
    expect(l.walls).toHaveLength(1);
    expect(l.walls[0]).toMatchObject({ start: { x: 10, y: 0 }, end: { x: 10, y: 8 }, thickness: 0.15 });
    expect(l.rooms[1]).toMatchObject({ id: 'office', name: 'Office', color: '#fee' });
    expect(l.markers[2]).toMatchObject({ name: 'Tank 3', model: 'kit/tank', rotation: 270 });
    expect(l.markers[0]!.position).toEqual({ x: 3, y: 1 });
    expect(result.created.map((c) => [c.index, c.kind, c.levelId])).toEqual([
      [1, 'wall', 'L1'],
      [2, 'room', 'L1'],
      [3, 'marker', 'L1'],
    ]);
    expect(result.created[1]!.id).toBe('office');
    expect(result.created[0]!.id).toBe(l.walls[0]!.id);
    expect(() => parsePlan(JSON.parse(JSON.stringify(result.plan)))).not.toThrow();
  });

  it('is all-or-nothing and reports every invalid command with its index', () => {
    const result = apply([
      { type: 'addWall', levelId: 'L1', start: { x: 0, y: 8 }, end: { x: 10, y: 8 } },
      { type: 'addWall', levelId: 'L1', start: { x: 1, y: 1 }, end: { x: 1, y: 1 } },
      { type: 'addMarker', levelId: 'nope', position: { x: 1, y: 1 } },
      { type: 'addMarker', levelId: 'L1', position: { x: 1, y: 1 }, model: 'kit/tnk' },
      { type: 'addMarker', levelId: 'L1', position: { x: 1 } },
      { type: 'updateEntity', kind: 'wall', id: 'w1', patch: { thickness: 0 } },
      { type: 'updateEntity', kind: 'wall', id: 'w1', patch: { colour: 'red' } },
      { type: 'removeEntity', kind: 'room', id: 'w1' },
      { type: 'paintWall', id: 'w1' },
      { type: 'addRoom', levelId: 'L1', points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }], colour: 'red' },
      'nonsense',
    ]);
    if (result.ok) throw new Error('expected errors');
    expect(result.errors.map((e) => e.index)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const message = (i: number) => result.errors.find((e) => e.index === i)!.message;
    expect(message(1)).toMatch(/no length/);
    expect(message(2)).toMatch(/no level "nope".*"L1" \(Ground\)/);
    expect(message(3)).toMatch(/no 3D model "kit\/tnk"/);
    expect(message(4)).toMatch(/"position" must be a point/);
    expect(message(5)).toBe('thickness: expected a positive number.');
    expect(message(6)).toMatch(/no property "colour".*start, end, thickness, height/);
    expect(message(7)).toBe('"w1" is a wall, not a room.');
    expect(message(8)).toMatch(/Unknown command type "paintWall"/);
    expect(message(9)).toMatch(/addRoom has no property "colour"/);
    expect(result.errors[0]).toMatchObject({ index: 1, type: 'addWall' });
  });

  it('lets later commands use the ids of earlier ones, and rejects ids that are taken', () => {
    const result = apply([
      { type: 'addLevel', id: 'L2', name: 'First floor' },
      { type: 'addMarker', levelId: 'L2', id: 'a', position: { x: 1, y: 1 } },
      { type: 'addMarker', levelId: 'L2', id: 'b', position: { x: 6, y: 1 } },
      { type: 'addPipeline', levelId: 'L2', from: 'a', to: 'b', medium: 'nitrogen' },
    ]);
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    const l2 = level(result.plan, 'L2');
    expect(l2).toMatchObject({ name: 'First floor', elevation: 3, height: 3 });
    const pipe = l2.pipelines[0]!;
    expect(pipe).toMatchObject({ name: 'Nitrogen 1', medium: 'N2', color: '#16a34a', diameter: 0.08, from: 'a', to: 'b' });
    expect(pipe.points[0]).toMatchObject({ x: 1, y: 1 });
    expect(pipe.points.at(-1)).toMatchObject({ x: 6, y: 1 });
    expect(pipe.points.every((p) => p.z === 2.6)).toBe(true);

    const taken = apply([{ type: 'addMarker', levelId: 'L1', id: 'w1', position: { x: 1, y: 1 } }]);
    expect(taken.ok).toBe(false);
    if (!taken.ok) expect(taken.errors[0]!.message).toMatch(/"w1" is already used/);
  });

  it('adds a pipeline from points, with default heights, risers and linked ends on their markers', () => {
    const result = apply([
      { type: 'addPipeline', levelId: 'L1', id: 'p', points: [{ x: 2.3, y: 2, z: 0.5 }, { x: 2.3, y: 2 }, { x: 8, y: 2 }, { x: 8, y: 6 }], from: 'm1', to: 'm2', elevation: 3, diameter: 0.1 },
      { type: 'addMarker', levelId: 'L1', id: 'v', position: { x: 5, y: 2.4 }, model: 'kit/valve', pipelineId: 'p' },
    ]);
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    const l = level(result.plan);
    const pipe = l.pipelines[0]!;
    expect(pipe.points.map((p) => p.z)).toEqual([0.5, 3, 3, 3]);
    expect(pipe.points[0]).toMatchObject({ x: 2, y: 2 }); // moved onto m1, riser kept
    expect(pipe.points[1]).toMatchObject({ x: 2, y: 2 });
    const valve = l.markers.find((m) => m.id === 'v')!;
    expect(valve.position).toEqual({ x: 5, y: 2 }); // onto the pipe
    expect(valve.elevation).toBeCloseTo(2.8); // centered on it: 3 - 0.4 / 2

    const bad = apply([
      { type: 'addPipeline', levelId: 'L1', points: [{ x: 1, y: 1 }] },
      { type: 'addPipeline', levelId: 'L1', from: 'm1' },
      { type: 'addPipeline', levelId: 'L1', from: 'm1', to: 'ghost' },
      { type: 'addPipeline', levelId: 'L1', points: [{ x: 1, y: 1 }, { x: 2, y: 1 }], diameter: -1 },
    ]);
    if (bad.ok) throw new Error('expected errors');
    expect(bad.errors.map((e) => e.message)).toEqual([
      'points: a pipeline needs at least 2 points.',
      'Give "points", or both "from" and "to" (marker ids) to have the route found automatically.',
      '"to": there is no marker "ghost" on level "L1".',
      '"diameter" must be greater than 0, got -1.',
    ]);
  });

  it('updates entities: null removes optional properties, required ones stay, links are checked', () => {
    const result = apply([
      { type: 'updateEntity', kind: 'marker', id: 'm1', patch: { model: null, kind: 'sensor', elevation: 1.5 } },
      { type: 'updateEntity', kind: 'room', id: 'r1', levelId: 'L1', patch: { name: '' } },
    ]);
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    const m1 = level(result.plan).markers[0]!;
    expect(m1).toEqual({ id: 'm1', name: 'Tank 1', position: { x: 2, y: 2 }, kind: 'sensor', elevation: 1.5 });

    const bad = apply([
      { type: 'updateEntity', kind: 'marker', id: 'm1', patch: { position: null } },
      { type: 'updateEntity', kind: 'marker', id: 'm1', patch: { id: 'x' } },
      { type: 'updateEntity', kind: 'marker', id: 'm1', patch: { pipelineId: 'none' } },
      { type: 'updateEntity', kind: 'marker', id: 'm1', patch: {} },
      { type: 'updateEntity', kind: 'room', id: 'r1', patch: { points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] } },
      { type: 'updateEntity', kind: 'marker', id: 'm1', levelId: 'L9', patch: { name: 'x' } },
    ]);
    if (bad.ok) throw new Error('expected errors');
    expect(bad.errors).toHaveLength(6);
    expect(bad.errors[0]!.message).toBe('"position" cannot be removed from a marker.');
    expect(bad.errors[4]!.message).toBe('points: a room needs at least 3 points.');
  });

  it('handles levels, limits and odd input', () => {
    const levels = apply([
      { type: 'addLevel', id: 'L2' },
      { type: 'updateLevel', levelId: 'L2', name: 'Roof', elevation: 7 },
      { type: 'removeLevel', levelId: 'L1' },
    ]);
    if (!levels.ok) throw new Error(JSON.stringify(levels.errors));
    expect(levels.plan.levels.map((l) => [l.id, l.name, l.elevation])).toEqual([['L2', 'Roof', 7]]);

    const last = apply([{ type: 'removeLevel', levelId: 'L1' }]);
    expect(last.ok).toBe(false);

    // Created and removed again in one list: not reported as created.
    const gone = apply([{ type: 'addMarker', levelId: 'L1', id: 'tmp', position: { x: 1, y: 1 } }, { type: 'removeEntity', kind: 'marker', id: 'tmp' }]);
    expect(gone.ok && gone.created).toEqual([]);

    // Removing a marker detaches pipelines from it.
    const detached = apply([
      { type: 'addPipeline', levelId: 'L1', id: 'p', from: 'm1', to: 'm2' },
      { type: 'removeEntity', kind: 'marker', id: 'm1' },
    ]);
    expect(detached.ok && level(detached.plan).pipelines[0]).toMatchObject({ id: 'p', to: 'm2' });
    expect(detached.ok && level(detached.plan).pipelines[0]!.from).toBeUndefined();

    expect(applyPlanCommands(basePlan(), 'x' as unknown as unknown[]).ok).toBe(false);
    expect(applyPlanCommands(basePlan(), [{ type: 'setPlanName', name: 'a' }, { type: 'setPlanName', name: 'b' }], { maxCommands: 1 }).ok).toBe(false);
    const empty = applyPlanCommands(basePlan(), []);
    expect(empty.ok && empty.created).toEqual([]);
    // Without a catalog any model id is accepted.
    expect(applyPlanCommands(basePlan(), [{ type: 'addMarker', levelId: 'L1', position: { x: 1, y: 1 }, model: 'anything' }]).ok).toBe(true);
  });
});

describe('plan command schemas', () => {
  it('has one definition per command type, with closed object schemas', () => {
    const types = PLAN_COMMAND_DEFINITIONS.map((d) => d.type).sort();
    const all: PlanCommand['type'][] = ['addLevel', 'addMarker', 'addPipeline', 'addRoom', 'addWall', 'moveEntity', 'removeEntity', 'removeLevel', 'setPlanName', 'updateEntity', 'updateLevel'];
    expect(types).toEqual(all);
    for (const d of PLAN_COMMAND_DEFINITIONS) {
      expect(d.name).toMatch(/^[a-z_]+$/);
      expect(d.description.length).toBeGreaterThan(10);
      expect(d.input_schema).toMatchObject({ type: 'object', additionalProperties: false });
      const schema = d.input_schema as { properties: Record<string, unknown>; required: string[] };
      for (const key of schema.required) expect(schema.properties).toHaveProperty(key);
      expect(schema.properties).not.toHaveProperty('type');
    }
    expect(JSON.parse(JSON.stringify(PLAN_COMMAND_DEFINITIONS))).toEqual(PLAN_COMMAND_DEFINITIONS);
  });

  it('offers one tool for a whole list and maps per-command tool calls to commands', () => {
    const items = (PLAN_COMMANDS_TOOL.input_schema as { properties: { commands: { items: { anyOf: { properties: { type: { const: string } }; required: string[] }[] } } } }).properties.commands.items.anyOf;
    expect(items).toHaveLength(PLAN_COMMAND_DEFINITIONS.length);
    expect(items[0]!.properties.type.const).toBe('setPlanName');
    expect(items.every((i) => i.required[0] === 'type')).toBe(true);

    const command = planCommandFromTool('add_wall', { levelId: 'L1', start: { x: 0, y: 8 }, end: { x: 10, y: 8 }, type: 'ignored' });
    expect(command).toEqual({ type: 'addWall', levelId: 'L1', start: { x: 0, y: 8 }, end: { x: 10, y: 8 } });
    expect(planCommandFromTool('ask_user', {})).toBeNull();
    expect(applyPlanCommands(basePlan(), [planCommandFromTool('remove_entity', null)]).ok).toBe(false);
    expect(applyPlanCommands(basePlan(), [command]).ok).toBe(true);
  });
});

describe('describePlan', () => {
  const plan = () => {
    const result = apply([
      { type: 'addPipeline', levelId: 'L1', id: 'p', points: [{ x: 2, y: 2 }, { x: 8, y: 2 }], medium: 'N2', from: 'm1' },
      { type: 'addMarker', levelId: 'L1', id: 's', name: 'Sensor "A"', position: { x: 20, y: 20 }, kind: 'sensor', data: { secret: 'x'.repeat(500) } },
      { type: 'addLevel', id: 'L2', name: 'Roof' },
    ]);
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    return result.plan;
  };

  it('lists every entity with id, rounded geometry and context', () => {
    const text = describePlan(plan(), { assets: [TANK] });
    expect(text).toContain('Plan "Works": 2 levels.');
    expect(text).toContain('Level "Ground" [L1]: floor at 0 m, wall height 3 m, extent x 0..20, y 0..20');
    expect(text).toContain('- r1 "Hall" 80 m²: (0,0) (10,0) (10,8) (0,8)');
    expect(text).toContain('- w1 (0,0)->(10,0) 0.2');
    expect(text).toContain('- m1 "Tank 1" at (2,2) in "Hall" model kit/tank (Tank)');
    expect(text).toContain('- s "Sensor \\"A\\"" at (20,20) kind sensor');
    expect(text).toContain('- p "Nitrogen 1" medium N2 diameter 0.08 length 6 m from m1: (2,2,2.6) (8,2,2.6)');
    expect(text).toContain('Level "Roof" [L2]: floor at 3 m, wall height 3 m, empty');
    expect(text).not.toContain('secret');
  });

  it('can describe one level and summarize', () => {
    const one = describePlan(plan(), { levelId: 'L2' });
    expect(one).toContain('Levels: "Ground" [L1], "Roof" [L2].');
    expect(one).not.toContain('Hall');
    expect(describePlan(plan(), { levelId: 'zz' })).toContain('There is no level "zz".');

    const summary = describePlan(plan(), { detail: 'summary', assets: [TANK] });
    expect(summary).toContain('- r1 "Hall" 80 m²');
    expect(summary).toContain('Walls: 1');
    expect(summary).toContain('Markers: 3 (2 × Tank, 1 × sensor)');
    expect(summary).toContain('Pipelines: 1 (6 m in total; media: N2)');
    expect(summary).not.toContain('m1');
    expect(summary.length).toBeLessThan(describePlan(plan()).length);
  });
});
