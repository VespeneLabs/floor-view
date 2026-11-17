import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { FloorplanEditor } from '../src/editor/Editor';
import { createLevel, createPlan } from '../src/model/plan';
import type { FloorPlan } from '../src/model/types';

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  Element.prototype.getBoundingClientRect = function () {
    return { left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600, x: 0, y: 0, toJSON() {} } as DOMRect;
  };
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
  Element.prototype.hasPointerCapture = () => false;
});

let editor: FloorplanEditor;
afterEach(() => {
  editor.dispose();
  document.body.replaceChildren();
});

function setup(): FloorplanEditor {
  const plan = createPlan('Works');
  plan.levels = [
    createLevel({
      id: 'L1',
      walls: [{ id: 'w1', start: { x: 0, y: 0 }, end: { x: 10, y: 0 }, thickness: 0.2 }],
      markers: [
        { id: 'm1', name: 'A', position: { x: 2, y: 2 } },
        { id: 'm2', name: 'B', position: { x: 8, y: 6 } },
      ],
      pipelines: [{ id: 'p1', name: 'Pipe', points: [{ x: 2, y: 2, z: 2.6 }, { x: 8, y: 2, z: 2.6 }], diameter: 0.05, from: 'm1' }],
    }),
    createLevel({ id: 'L2', name: 'Upper', elevation: 3 }),
  ];
  editor = new FloorplanEditor(document.body, { plan });
  return editor;
}

const view = (e: FloorplanEditor) => ({ ...(e as unknown as { view: object }).view });

describe('FloorplanEditor.applyCommands', () => {
  it('applies a list as one undo step, keeping view, level and selection', () => {
    const e = setup();
    const before = e.getPlan();
    const viewBefore = view(e);
    e.select({ kind: 'marker', id: 'm2', levelId: 'L1' });
    const changes: FloorPlan[] = [];
    const selections: unknown[] = [];
    e.on('change', (p) => changes.push(p));
    e.on('selectionchange', (s) => selections.push(s));

    const result = e.applyCommands([
      { type: 'addWall', levelId: 'L1', id: 'w2', start: { x: 10, y: 0 }, end: { x: 10, y: 8 } },
      { type: 'addRoom', levelId: 'L1', points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 8 }, { x: 0, y: 8 }], name: 'Hall' },
      { type: 'moveEntity', kind: 'marker', id: 'm1', dx: 1, dy: 0 },
    ]);
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    expect(result.created.map((c) => c.kind)).toEqual(['wall', 'room']);
    expect(changes).toHaveLength(1);
    const level = e.getActiveLevel();
    expect(level.walls).toHaveLength(2);
    expect(level.rooms).toHaveLength(1);
    expect(level.pipelines[0]!.points[0]).toMatchObject({ x: 3, y: 2 }); // the linked end followed its marker
    expect(view(e)).toEqual(viewBefore);
    expect(e.getSelection()).toEqual({ kind: 'marker', id: 'm2', levelId: 'L1' });
    expect(selections).toEqual([]);
    // The returned plan is a copy.
    result.plan.name = 'changed';
    expect(e.getPlan().name).toBe('Works');

    e.undo();
    expect(e.getPlan()).toEqual(before);
    expect(e.canUndo()).toBe(false);
    e.redo();
    expect(e.getActiveLevel().walls).toHaveLength(2);
  });

  it('changes nothing when a command is invalid', () => {
    const e = setup();
    const before = e.getPlan();
    let changed = 0;
    e.on('change', () => changed++);
    const result = e.applyCommands([
      { type: 'addWall', levelId: 'L1', start: { x: 10, y: 0 }, end: { x: 10, y: 8 } },
      { type: 'removeEntity', kind: 'marker', id: 'nope' },
    ]);
    expect(result).toEqual({ ok: false, errors: [{ index: 1, type: 'removeEntity', message: 'There is no marker "nope".' }] });
    expect(e.getPlan()).toEqual(before);
    expect(changed).toBe(0);
    expect(e.canUndo()).toBe(false);

    expect(e.applyCommands([]).ok).toBe(true);
    expect(e.canUndo()).toBe(false);
    e.setReadOnly(true);
    expect(e.applyCommands([{ type: 'setPlanName', name: 'x' }]).ok).toBe(false);
  });

  it('drops the selection and the active level when a command removes them', () => {
    const e = setup();
    e.select({ kind: 'marker', id: 'm2', levelId: 'L1' });
    const events: string[] = [];
    e.on('selectionchange', (s) => events.push(`selection:${s?.id ?? 'none'}`));
    e.on('levelchange', (id) => events.push(`level:${id}`));
    expect(e.applyCommands([{ type: 'removeEntity', kind: 'marker', id: 'm2' }]).ok).toBe(true);
    expect(e.getSelection()).toBeNull();
    expect(events).toEqual(['selection:none']);
    expect(e.applyCommands([{ type: 'removeLevel', levelId: 'L1' }]).ok).toBe(true);
    expect(e.getActiveLevel().id).toBe('L2');
    expect(events).toContain('level:L2');
  });
});

describe('FloorplanEditor.removeEntity and updateEntity', () => {
  it('removes an entity as one undo step, clearing links and the selection', () => {
    const e = setup();
    e.select({ kind: 'marker', id: 'm1', levelId: 'L1' });
    expect(e.removeEntity({ kind: 'marker', id: 'm1', levelId: 'L1' })).toBe(true);
    expect(e.getActiveLevel().markers.map((m) => m.id)).toEqual(['m2']);
    expect(e.getActiveLevel().pipelines[0]!.from).toBeUndefined();
    expect(e.getSelection()).toBeNull();
    expect(e.removeEntity({ kind: 'marker', id: 'm1', levelId: 'L1' })).toBe(false);
    e.undo();
    expect(e.getActiveLevel().markers).toHaveLength(2);
    e.setReadOnly(true);
    expect(e.removeEntity({ kind: 'marker', id: 'm2', levelId: 'L1' })).toBe(false);
  });

  it('refuses patches that would make an entity invalid', () => {
    const e = setup();
    const wall = { kind: 'wall', id: 'w1', levelId: 'L1' } as const;
    const marker = { kind: 'marker', id: 'm2', levelId: 'L1' } as const;
    expect(e.updateEntity(wall, { thickness: 0 })).toBe(false);
    expect(e.updateEntity(wall, { start: { x: Number.NaN, y: 0 } })).toBe(false);
    expect(e.updateEntity(marker, { rotation: 'left' as unknown as number })).toBe(false);
    expect(e.updateEntity({ kind: 'pipeline', id: 'p1', levelId: 'L1' }, { points: [{ x: 1, y: 1, z: 1 }] })).toBe(false);
    expect(e.canUndo()).toBe(false);
    expect(e.getActiveLevel().walls[0]!.thickness).toBe(0.2);

    expect(e.updateEntity(wall, { thickness: 0.3, height: undefined })).toBe(true);
    expect(e.updateEntity(marker, { elevation: undefined, name: '' })).toBe(true);
    expect(e.updateEntity({ kind: 'marker', id: 'zz', levelId: 'L1' }, { name: 'x' })).toBe(false);
    expect(e.getActiveLevel().walls[0]!.thickness).toBe(0.3);
  });
});
