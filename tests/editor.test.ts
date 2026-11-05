import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { FloorplanEditor } from '../src/editor/Editor';
import { createPlan } from '../src/model/plan';
import type { FloorPlan } from '../src/model/types';

// jsdom has no layout or ResizeObserver: stub them so world coords are predictable.
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

let editor: FloorplanEditor | undefined;
afterEach(() => {
  editor?.dispose();
  document.body.replaceChildren();
});

function setup(plan: FloorPlan = createPlan()) {
  editor = new FloorplanEditor(document.body, { plan, grid: 0.5 });
  const svgEl = editor.element.querySelector('svg')!;
  // Pin the view to a known transform: 1 m = 50 px, origin at (0, 0).
  (editor as unknown as { view: { scale: number; ox: number; oy: number } }).view = { scale: 50, ox: 0, oy: 0 };
  const at = (x: number, y: number, type: string, init: PointerEventInit = {}) =>
    svgEl.dispatchEvent(new MouseEvent(type, { clientX: x * 50, clientY: y * 50, bubbles: true, button: 0, ...init }) as PointerEvent);
  const click = (x: number, y: number, init: PointerEventInit = {}) => {
    at(x, y, 'pointerdown', init);
    at(x, y, 'pointerup', init);
  };
  return { editor, at, click };
}

describe('FloorplanEditor', () => {
  it('draws a chain of walls and stops when the same point is clicked twice', () => {
    const { editor, click } = setup();
    const changes: FloorPlan[] = [];
    editor.on('change', (p) => changes.push(p));
    editor.setTool('wall');
    click(1, 1);
    click(5.1, 1); // snaps to 5
    click(5, 4);
    click(5, 4); // finish
    click(8, 8); // starts a new chain, no wall yet
    const walls = editor.getActiveLevel().walls;
    expect(walls).toHaveLength(2);
    expect(walls[0]).toMatchObject({ start: { x: 1, y: 1 }, end: { x: 5, y: 1 }, thickness: 0.15 });
    expect(walls[1]).toMatchObject({ start: { x: 5, y: 1 }, end: { x: 5, y: 4 } });
    expect(changes).toHaveLength(2);
  });

  it('draws a room by clicking back on the first corner, then undoes and redoes it', () => {
    const { editor, click } = setup();
    editor.setTool('room');
    click(0, 0);
    click(4, 0);
    click(4, 3);
    click(0, 3);
    click(0, 0); // close
    expect(editor.getActiveLevel().rooms).toHaveLength(1);
    expect(editor.getSelection()?.kind).toBe('room');
    editor.undo();
    expect(editor.getActiveLevel().rooms).toHaveLength(0);
    editor.redo();
    expect(editor.getActiveLevel().rooms[0]!.points).toHaveLength(4);
  });

  it('moves a selected marker by dragging, as one undoable step', () => {
    const { editor, at, click } = setup();
    editor.setTool('marker');
    click(2, 2);
    editor.setTool('select');
    at(2, 2, 'pointerdown');
    at(3, 2.6, 'pointermove');
    at(4, 3, 'pointermove');
    at(4, 3, 'pointerup');
    expect(editor.getActiveLevel().markers[0]!.position).toEqual({ x: 4, y: 3 });
    editor.undo();
    expect(editor.getActiveLevel().markers[0]!.position).toEqual({ x: 2, y: 2 });
  });

  it('deletes the selection and manages levels', () => {
    const { editor, click } = setup();
    editor.setTool('marker');
    click(1, 1);
    const marker = editor.getActiveLevel().markers[0]!;
    editor.select({ kind: 'marker', id: marker.id, levelId: editor.getActiveLevel().id });
    editor.deleteSelection();
    expect(editor.getActiveLevel().markers).toHaveLength(0);

    const first = editor.getActiveLevel();
    const second = editor.addLevel('Roof');
    expect(editor.getActiveLevel().id).toBe(second.id);
    expect(second.elevation).toBe(first.elevation + first.height);
    expect(editor.removeLevel(second.id)).toBe(true);
    expect(editor.removeLevel(first.id)).toBe(false); // last level stays
  });

  it('shows an underlay image in plan coordinates and fits an empty plan to it', () => {
    const { editor } = setup();
    editor.setUnderlay({ url: 'data:image/png;base64,AAAA', x: 0, y: 0, width: 80, height: 40, opacity: 0.3 });
    const img = editor.element.querySelector('.vl-editor__underlay image')!;
    expect(img.getAttribute('width')).toBe('80');
    expect(img.getAttribute('opacity')).toBe('0.3');
    expect(editor.getUnderlay()).toMatchObject({ width: 80, height: 40 });
    editor.setUnderlay(null);
    expect(editor.element.querySelector('.vl-editor__underlay image')).toBeNull();
  });

  it('getPlan returns a copy', () => {
    const { editor } = setup();
    editor.getPlan().levels[0]!.name = 'mutated';
    expect(editor.getActiveLevel().name).not.toBe('mutated');
  });
});

describe('FloorplanEditor overlay points', () => {
  const sensors = (levelId: string) => [
    { id: 's1', levelId, position: { x: 2, y: 2 }, label: 'CO₂ 420' },
    { id: 's2', levelId, position: { x: 6, y: 2 }, color: '#ef4444', draggable: false },
    { id: 's3', levelId: 'other', position: { x: 2, y: 2 } },
  ];

  it('draws the active level’s points on top, outside the plan and history', () => {
    const { editor } = setup();
    const levelId = editor.getActiveLevel().id;
    const changes: unknown[] = [];
    editor.on('change', (p) => changes.push(p));
    editor.setOverlayPoints(sensors(levelId));
    const drawn = [...editor.element.querySelectorAll('.vl-editor__overlay-point')].map((g) => g.getAttribute('data-overlay-id'));
    expect(drawn).toEqual(['s1', 's2']);
    expect(editor.element.querySelector('.vl-editor__overlay-label')?.textContent).toBe('CO₂ 420');
    expect(JSON.stringify(editor.getPlan())).not.toContain('s1');
    expect(changes).toEqual([]);
    expect(editor.canUndo()).toBe(false);
  });

  it('selects and drags a point (snapped), emitting one move on drop without touching the plan', () => {
    const { editor, at } = setup();
    const levelId = editor.getActiveLevel().id;
    editor.setOverlayPoints(sensors(levelId));
    const moves: unknown[] = [];
    const selected: (string | null)[] = [];
    editor.on('overlaypointmove', (m) => moves.push(m));
    editor.on('overlaypointselect', (id) => selected.push(id));
    editor.on('change', () => moves.push('plan change!'));

    at(2.05, 2, 'pointerdown');
    at(3.6, 4.1, 'pointermove');
    at(4.6, 5.1, 'pointermove');
    at(4.6, 5.1, 'pointerup');
    expect(selected).toEqual(['s1']);
    expect(moves).toEqual([{ id: 's1', levelId, position: { x: 4.5, y: 5 } }]);
    expect(editor.getOverlayPoints()[0]!.position).toEqual({ x: 4.5, y: 5 });
    expect(editor.canUndo()).toBe(false);

    // Not draggable: selected but stays put.
    at(6, 2, 'pointerdown');
    at(8, 4, 'pointermove');
    at(8, 4, 'pointerup');
    expect(selected).toEqual(['s1', 's2']);
    expect(moves).toHaveLength(1);
    expect(editor.getOverlayPoints()[1]!.position).toEqual({ x: 6, y: 2 });
  });

  it('keeps overlay and entity selection mutually exclusive', () => {
    const { editor, click } = setup();
    const levelId = editor.getActiveLevel().id;
    editor.setTool('marker');
    click(8, 8);
    editor.setTool('select');
    editor.setOverlayPoints(sensors(levelId));
    click(2, 2);
    expect(editor.getOverlaySelection()).toBe('s1');
    click(8, 8);
    expect(editor.getSelection()?.kind).toBe('marker');
    expect(editor.getOverlaySelection()).toBeNull();
    editor.selectOverlayPoint('s2');
    expect(editor.getSelection()).toBeNull();
    editor.setOverlayPoints([]); // removing the selected point deselects it
    expect(editor.getOverlaySelection()).toBeNull();
  });
});

describe('FloorplanEditor host integration', () => {
  it('converts client coordinates to plan positions on the active level', () => {
    const { editor } = setup();
    const levelId = editor.getActiveLevel().id;
    expect(editor.clientToPlan(110, 160)).toEqual({ levelId, position: { x: 2.2, y: 3.2 } });
    expect(editor.clientToPlan(110, 160, { snap: true })).toEqual({ levelId, position: { x: 2, y: 3 } });
    expect(editor.clientToPlan(900, 100)).toBeNull();
  });

  it('limits the tools', () => {
    const { editor } = setup();
    const changes: string[] = [];
    editor.on('toolchange', (t) => changes.push(t));
    editor.setTools(['select', 'marker']);
    editor.setTool('wall');
    expect(editor.getTool()).toBe('select');
    editor.element.dispatchEvent(new KeyboardEvent('keydown', { key: 'w' }));
    editor.element.dispatchEvent(new KeyboardEvent('keydown', { key: 'm' }));
    expect(changes).toEqual(['marker']);
    editor.setTools(['pan']);
    expect(editor.getTool()).toBe('pan');
    expect(editor.availableTools()).toEqual(['pan']);
  });

  it('read-only: selection works, edits by the user do not', () => {
    const { editor, at, click } = setup();
    editor.setTool('marker');
    click(2, 2);
    editor.setTool('wall');
    editor.setReadOnly(true);
    expect(editor.getTool()).toBe('select');
    expect(editor.availableTools()).toEqual(['select', 'pan']);
    expect(editor.element.hasAttribute('data-readonly')).toBe(true);
    editor.setTool('room');
    expect(editor.getTool()).toBe('select');

    const before = JSON.stringify(editor.getPlan());
    at(2, 2, 'pointerdown');
    at(5, 5, 'pointermove');
    at(5, 5, 'pointerup');
    expect(editor.getSelection()?.kind).toBe('marker'); // selectable
    editor.element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete' }));
    editor.element.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true }));
    expect(JSON.stringify(editor.getPlan())).toBe(before);

    editor.setReadOnly(false);
    editor.element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete' }));
    expect(editor.getActiveLevel().markers).toHaveLength(0);
  });

  it('read-only still lets the host drag overlay points', () => {
    const { editor, at } = setup();
    editor.setReadOnly(true);
    const levelId = editor.getActiveLevel().id;
    editor.setOverlayPoints([{ id: 's', levelId, position: { x: 1, y: 1 } }]);
    const moves: unknown[] = [];
    editor.on('overlaypointmove', (m) => moves.push(m));
    at(1, 1, 'pointerdown');
    at(3, 1, 'pointermove');
    at(3, 1, 'pointerup');
    expect(moves).toEqual([{ id: 's', levelId, position: { x: 3, y: 1 } }]);
  });

  it('honours tools and readOnly options at construction', () => {
    editor = new FloorplanEditor(document.body, { tool: 'wall', tools: ['select', 'pan'], readOnly: false });
    expect(editor.getTool()).toBe('select');
    editor.dispose();
    editor = new FloorplanEditor(document.body, { tool: 'marker', readOnly: true });
    expect(editor.getTool()).toBe('select');
    expect(editor.isReadOnly()).toBe(true);
  });
});
