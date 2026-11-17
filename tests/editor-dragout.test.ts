import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { FloorplanEditor, type EditorDragOutEvent, type EditorOptions } from '../src/editor/Editor';
import { createLevel, createPlan } from '../src/model/plan';

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

function setup(options: EditorOptions = {}) {
  const plan = createPlan();
  plan.levels = [
    createLevel({
      id: 'L1',
      rooms: [{ id: 'r1', name: 'Hall', points: [{ x: 6, y: 6 }, { x: 10, y: 6 }, { x: 10, y: 10 }, { x: 6, y: 10 }] }],
      markers: [{ id: 'm1', name: 'A', position: { x: 2, y: 2 } }],
    }),
  ];
  editor = new FloorplanEditor(document.body, {
    plan,
    grid: 0.5,
    overlayPoints: [{ id: 'o1', levelId: 'L1', position: { x: 4, y: 2 } }],
    ...options,
  });
  const svgEl = editor.element.querySelector('svg')!;
  // 1 m = 50 px, origin at (0, 0); the stubbed editor is 800 × 600 px, so x > 16 m is outside.
  (editor as unknown as { view: { scale: number; ox: number; oy: number } }).view = { scale: 50, ox: 0, oy: 0 };
  const at = (x: number, y: number, type: string) =>
    svgEl.dispatchEvent(new MouseEvent(type, { clientX: x * 50, clientY: y * 50, bubbles: true, button: 0 }) as PointerEvent);
  const out: EditorDragOutEvent[] = [];
  const log: string[] = [];
  editor.on('entitydragout', (e) => out.push(e));
  editor.on('change', () => log.push('change'));
  editor.on('overlaypointmove', () => log.push('overlaypointmove'));
  return { editor, at, out, log };
}

describe('editor drag-out', () => {
  it('cancels a marker move that leaves the editor and reports the marker once', () => {
    const { editor, at, out, log } = setup({ dragOut: true });
    at(2, 2, 'pointerdown');
    at(5, 3, 'pointermove');
    expect(editor.getActiveLevel().markers[0]!.position).toEqual({ x: 5, y: 3 });
    at(17, 3, 'pointermove');
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ ref: { kind: 'marker', id: 'm1', levelId: 'L1' }, clientX: 850, clientY: 150 });
    expect(editor.getActiveLevel().markers[0]!.position).toEqual({ x: 2, y: 2 });

    // Nothing resumes when the pointer comes back, and the release commits nothing.
    at(6, 3, 'pointermove');
    at(6, 3, 'pointerup');
    expect(out).toHaveLength(1);
    expect(editor.getActiveLevel().markers[0]!.position).toEqual({ x: 2, y: 2 });
    expect(log).toEqual([]);
    expect(editor.canUndo()).toBe(false);
  });

  it('works for overlay points, rooms and in read-only mode', () => {
    const { editor, at, out, log } = setup({ dragOut: true });
    at(4, 2, 'pointerdown');
    at(4.5, 2, 'pointermove');
    at(4, -1, 'pointermove');
    at(4, -1, 'pointerup');
    expect(out[0]!.ref).toEqual({ kind: 'point', id: 'o1', levelId: 'L1' });
    expect(editor.getOverlayPoints()[0]!.position).toEqual({ x: 4, y: 2 });

    editor.setReadOnly(true);
    at(8, 8, 'pointerdown');
    at(8, 13, 'pointermove');
    at(8, 13, 'pointerup');
    expect(out[1]!.ref).toEqual({ kind: 'room', id: 'r1', levelId: 'L1' });
    expect(log).toEqual([]);

    // A press on empty space pans and is never a drag-out.
    at(13, 2, 'pointerdown');
    at(17, 2, 'pointermove');
    at(17, 2, 'pointerup');
    expect(out).toHaveLength(2);
  });

  it('is off by default: a drag past the edge keeps moving the entity', () => {
    const { editor, at, out, log } = setup();
    expect(editor.getDragOut()).toBe(false);
    at(2, 2, 'pointerdown');
    at(17, 3, 'pointermove');
    at(17, 3, 'pointerup');
    expect(out).toEqual([]);
    expect(editor.getActiveLevel().markers[0]!.position).toEqual({ x: 17, y: 3 });
    expect(log).toEqual(['change']);

    editor.setDragOut(true);
    at(17, 3, 'pointerdown');
    at(17, 3, 'pointermove');
    expect(out).toHaveLength(1);
  });
});
