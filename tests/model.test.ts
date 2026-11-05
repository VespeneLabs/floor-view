import { describe, expect, it } from 'vitest';
import { History } from '../src/core/history';
import { Emitter } from '../src/core/emitter';
import { createPlan, findEntity, nextLevelElevation, removeEntity, translateEntity } from '../src/model/plan';
import { parsePlan, parsePlanJSON, PlanValidationError } from '../src/model/validate';
import { createSamplePlan as samplePlan } from '../src/samples';

describe('parsePlan', () => {
  it('accepts the sample plan and round-trips through JSON', () => {
    const plan = samplePlan();
    expect(parsePlanJSON(JSON.stringify(plan))).toEqual(plan);
  });

  it('reports the JSON path of invalid data', () => {
    const plan = samplePlan() as unknown as { levels: { walls: { thickness: unknown }[] }[] };
    plan.levels[0]!.walls[2]!.thickness = -1;
    expect(() => parsePlan(plan)).toThrowError(/\$\.levels\[0\]\.walls\[2\]\.thickness/);
  });

  it('rejects duplicate ids across the plan', () => {
    const plan = samplePlan();
    plan.levels[1]!.rooms[0]!.id = plan.levels[0]!.rooms[0]!.id;
    expect(() => parsePlan(plan)).toThrow(PlanValidationError);
  });

  it('rejects rooms with fewer than 3 points and unknown versions', () => {
    const plan = samplePlan();
    plan.levels[0]!.rooms[0]!.points = plan.levels[0]!.rooms[0]!.points.slice(0, 2);
    expect(() => parsePlan(plan)).toThrow(/at least 3 points/);
    expect(() => parsePlan({ ...samplePlan(), version: 2 })).toThrow(/unsupported version/);
  });

  it('drops unknown properties', () => {
    const plan = { ...samplePlan(), extra: true };
    expect(parsePlan(plan)).not.toHaveProperty('extra');
  });

  it('wraps JSON syntax errors', () => {
    expect(() => parsePlanJSON('{')).toThrow(/invalid JSON/);
  });
});

describe('plan helpers', () => {
  it('finds, translates and removes entities', () => {
    const plan = samplePlan();
    const ref = { kind: 'marker', id: 'marker_desk1', levelId: 'level_ground' } as const;
    const marker = findEntity(plan, ref)!;
    translateEntity('marker', marker, 1, -1);
    expect(findEntity(plan, ref)).toMatchObject({ position: { x: 9, y: 0.5 } });
    expect(removeEntity(plan, ref)).toBe(true);
    expect(findEntity(plan, ref)).toBeUndefined();
    expect(removeEntity(plan, ref)).toBe(false);
  });

  it('stacks new levels on top', () => {
    expect(nextLevelElevation(samplePlan())).toBe(6);
    expect(nextLevelElevation(createPlan())).toBe(3);
  });
});

describe('History', () => {
  it('undoes and redoes snapshots', () => {
    const h = new History<number>();
    let state = 1;
    h.push(state);
    state = 2;
    h.push(state);
    state = 3;
    state = h.undo(state)!;
    expect(state).toBe(2);
    state = h.undo(state)!;
    expect(state).toBe(1);
    expect(h.undo(state)).toBeUndefined();
    state = h.redo(state)!;
    expect(state).toBe(2);
    h.push(state); // new change clears redo
    expect(h.canRedo).toBe(false);
  });

  it('respects the limit', () => {
    const h = new History<number>(2);
    h.push(1);
    h.push(2);
    h.push(3);
    expect(h.undo(4)).toBe(3);
    expect(h.undo(3)).toBe(2);
    expect(h.undo(2)).toBeUndefined();
  });
});

describe('Emitter', () => {
  it('subscribes and unsubscribes', () => {
    const e = new Emitter<{ ping: number }>();
    const seen: number[] = [];
    const off = e.on('ping', (n) => seen.push(n));
    e.emit('ping', 1);
    off();
    e.emit('ping', 2);
    expect(seen).toEqual([1]);
  });
});
