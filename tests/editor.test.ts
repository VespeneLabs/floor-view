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
