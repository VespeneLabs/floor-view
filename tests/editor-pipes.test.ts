import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { FloorplanEditor, type PipeSettings } from '../src/editor/Editor';
import { orthoPoint, snapToWallFace } from '../src/editor/pipes';
import { createPlan } from '../src/model/plan';
import { pipelineJunctions } from '../src/model/pipeline';
import type { FloorPlan, Marker, PipePoint, Pipeline } from '../src/model/types';

// Same harness as editor.test.ts: no layout in jsdom, view pinned to 50 px/m at the origin.
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

const pt = (x: number, y: number, z = 2.6): PipePoint => ({ x, y, z });

function setup(plan: FloorPlan = createPlan()) {
  editor = new FloorplanEditor(document.body, { plan, grid: 0.5 });
  const svgEl = editor.element.querySelector('svg')!;
  (editor as unknown as { view: { scale: number; ox: number; oy: number } }).view = { scale: 50, ox: 0, oy: 0 };
  const at = (x: number, y: number, type: string, init: MouseEventInit = {}) =>
    svgEl.dispatchEvent(new MouseEvent(type, { clientX: x * 50, clientY: y * 50, bubbles: true, button: 0, ...init }));
  const click = (x: number, y: number, init: MouseEventInit = {}) => {
    at(x, y, 'pointerdown', init);
    at(x, y, 'pointerup', init);
  };
  const drag = (from: [number, number], to: [number, number], init: MouseEventInit = {}) => {
    at(...from, 'pointerdown', init);
    at(...to, 'pointermove', init);
    at(...to, 'pointerup', init);
  };
  const key = (k: string, init: KeyboardEventInit = {}) =>
    editor!.element.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, ...init }));
  const pipes = () => editor!.getActiveLevel().pipelines;
  const markers = () => editor!.getActiveLevel().markers;
  return { editor, at, click, drag, key, pipes, markers };
}

function planWith({ markers = [], pipelines = [], walls = [] }: { markers?: Marker[]; pipelines?: Pipeline[]; walls?: FloorPlan['levels'][0]['walls'] }) {
  const plan = createPlan();
  Object.assign(plan.levels[0]!, { markers, pipelines, walls });
  return plan;
}

const marker = (id: string, x: number, y: number, extra: Partial<Marker> = {}): Marker => ({ id, name: id, position: { x, y }, ...extra });
const pipe = (id: string, points: PipePoint[], extra: Partial<Pipeline> = {}): Pipeline => ({ id, name: id, points, diameter: 0.05, ...extra });

describe('pipe tool: drawing', () => {
  it('draws an orthogonal pipeline at the current elevation as one undo step', () => {
    const { editor, click, key, pipes } = setup();
    const changes: FloorPlan[] = [];
    editor.on('change', (p) => changes.push(p));
    key('p');
    expect(editor.getTool()).toBe('pipe');
    click(1, 1);
    click(4, 1.3); // ortho: stays horizontal
    click(4.2, 4); // ortho: vertical
    key('Enter');
    expect(pipes()).toHaveLength(1);
    expect(pipes()[0]).toMatchObject({ name: 'Pipeline 1', diameter: 0.05, points: [pt(1, 1), pt(4, 1), pt(4, 4)] });
    expect(editor.getSelection()).toMatchObject({ kind: 'pipeline', id: pipes()[0]!.id });
    expect(changes).toHaveLength(1);
    editor.undo();
    expect(pipes()).toHaveLength(0);
  });

  it('allows 45° with Shift and finishes when the last point is clicked again', () => {
    const { editor, click, pipes } = setup();
    editor.setTool('pipe');
    click(1, 1);
    click(3, 3.2, { shiftKey: true });
    click(3, 3);
    expect(pipes()[0]!.points).toEqual([pt(1, 1), pt(3, 3)]);
  });

  it('uses the pipe settings for new pipelines', () => {
    const { editor, click, pipes } = setup();
    const events: PipeSettings[] = [];
    editor.on('pipesettingschange', (s) => events.push(s));
    editor.setPipeSettings({ elevation: 3, diameter: 0.1, medium: 'N2', color: '#22c55e', name: 'Nitrogen' });
    editor.setTool('pipe');
    click(0, 0);
    click(2, 0);
    click(2, 0);
    expect(pipes()[0]).toMatchObject({ name: 'Nitrogen 1', diameter: 0.1, medium: 'N2', color: '#22c55e', points: [pt(0, 0, 3), pt(2, 0, 3)] });
    expect(events.at(-1)).toEqual({ elevation: 3, diameter: 0.1, medium: 'N2', color: '#22c55e', name: 'Nitrogen' });
    editor.setPipeSettings({ medium: undefined, diameter: -1, elevation: -5 });
    expect(editor.getPipeSettings()).toEqual({ elevation: 0, diameter: 0.1, color: '#22c55e', name: 'Nitrogen' });
  });

  it('changes the elevation with [ and ] while drawing, making and removing risers', () => {
    const { editor, click, key, pipes } = setup();
    editor.setTool('pipe');
    click(1, 1);
    key(']', { code: 'BracketRight' });
    key(']', { code: 'BracketRight' }); // riser at (1, 1) up to 2.8
    click(5, 1);
    key('[', { code: 'BracketLeft' });
    key('{', { code: 'BracketLeft', shiftKey: true }); // 2.8 → 2.7 → 1.7
    key('PageUp'); // 1.8
    click(5, 4);
    key('Enter');
    expect(pipes()[0]!.points).toEqual([pt(1, 1), pt(1, 1, 2.8), pt(5, 1, 2.8), pt(5, 1, 1.8), pt(5, 4, 1.8)]);
    expect(editor.getPipeSettings().elevation).toBe(1.8);
  });

  it('drops a riser when the elevation goes back to the height before it', () => {
    const { editor, click, key, pipes } = setup();
    editor.setTool('pipe');
    click(1, 1);
    click(3, 1);
    key(']', { code: 'BracketRight' });
    key('[', { code: 'BracketLeft' });
    click(3, 3);
    key('Enter');
    expect(pipes()[0]!.points).toEqual([pt(1, 1), pt(3, 1), pt(3, 3)]);
  });

  it('cancels with Escape and ignores elevation keys in other tools', () => {
    const { editor, click, key, pipes } = setup();
    editor.setTool('pipe');
    click(1, 1);
    click(3, 1);
    key('Escape');
    expect(pipes()).toHaveLength(0);
    editor.setTool('select');
    key(']', { code: 'BracketRight' });
    expect(editor.getPipeSettings().elevation).toBe(2.6);
  });

  it('commits the draft when switching tools, and is not available read-only', () => {
    const { editor, click, pipes } = setup();
    editor.setTool('pipe');
    click(1, 1);
    click(3, 1);
    editor.setTool('select');
    expect(pipes()).toHaveLength(1);
    editor.setReadOnly(true);
    editor.setTool('pipe');
    expect(editor.getTool()).toBe('select');
  });

  it('snaps a pipe to run along a wall face, offset by half the wall, the radius and a clearance', () => {
    const wall = { id: 'w', start: { x: 0, y: 0 }, end: { x: 10, y: 0 }, thickness: 0.25 };
    const side = { id: 'w2', start: { x: 10, y: 0 }, end: { x: 10, y: 8 }, thickness: 0.25 };
    const { editor, click, key, pipes } = setup(planWith({ walls: [wall, side] }));
    editor.setTool('pipe');
    click(2.1, 0.3); // near the inner face of the top wall: y = 0.125 + 0.025 + 0.05
    click(9.9, 0.3); // runs along it and stops at the right wall's face: x = 10 - 0.2
    key('Enter');
    expect(pipes()[0]!.points).toEqual([pt(2, 0.2), pt(9.8, 0.2)]);
  });
});

describe('pipe tool: connections', () => {
  it('attaches ends to markers, which the pipe then follows', () => {
    const { editor, click, drag, pipes } = setup(planWith({ markers: [marker('tank', 2, 2), marker('boiler', 6, 5)] }));
    editor.setTool('pipe');
    click(2.1, 2.05); // on the tank
    click(6, 2);
    click(6, 5.1); // on the boiler: finishes
    expect(pipes()[0]).toMatchObject({ from: 'tank', to: 'boiler', points: [pt(2, 2), pt(6, 2), pt(6, 5)] });

    editor.setTool('select');
    drag([6, 5], [7, 5]);
    expect(pipes()[0]!.points.at(-1)).toEqual(pt(7, 5));
    editor.undo();
    expect(pipes()[0]!.points.at(-1)).toEqual(pt(6, 5));

    editor.select({ kind: 'marker', id: 'boiler', levelId: editor.getActiveLevel().id });
    editor.deleteSelection();
    expect(pipes()[0]).not.toHaveProperty('to');
    expect(pipes()[0]).toMatchObject({ from: 'tank' });
  });

  it('moves a riser at an attached end with its marker', () => {
    const p = pipe('p', [pt(2, 2, 0.5), pt(2, 2), pt(6, 2)], { from: 'tank' });
    const { editor, pipes } = setup(planWith({ markers: [marker('tank', 2, 2)], pipelines: [p] }));
    editor.updateEntity({ kind: 'marker', id: 'tank', levelId: editor.getActiveLevel().id }, { position: { x: 2, y: 3 } });
    expect(pipes()[0]!.points).toEqual([pt(2, 3, 0.5), pt(2, 3), pt(6, 2)]);
  });

  it('starts a tee on another pipeline at its height, and ends on one with a riser', () => {
    const main = pipe('main', [pt(0, 0, 3), pt(10, 0, 3)]);
    const { editor, click, key, pipes } = setup(planWith({ pipelines: [main] }));
    editor.setTool('pipe');
    click(5, 0.05);
    expect(editor.getPipeSettings().elevation).toBe(3);
    click(5, 4);
    key('Enter');
    const branch = pipes()[1]!;
    expect(branch.points).toEqual([pt(5, 0, 3), pt(5, 4, 3)]);

    editor.setPipeSettings({ elevation: 2.6 });
    click(2, 4);
    click(2, 0.1); // ends on main (z 3): adds a riser and finishes
    expect(pipes()[2]!.points).toEqual([pt(2, 4), pt(2, 0), pt(2, 0, 3)]);
    expect(pipelineJunctions(editor.getActiveLevel()).map((j) => [j.kind, j.pipelineId, j.otherId])).toEqual([
      ['tee', branch.id, 'main'],
      ['tee', pipes()[2]!.id, 'main'],
    ]);
  });

  it('places markers onto a pipeline as fittings, aligned and at its height', () => {
    const main = pipe('main', [pt(0, 0, 3), pt(10, 0, 3), pt(10, 6, 3)]);
    const { editor, click, markers } = setup(planWith({ pipelines: [main] }));
    editor.setMarkerTemplate({ name: 'Valve' });
    editor.setTool('marker');
    click(4, 0.1);
    click(10.1, 3);
    expect(markers()[0]).toMatchObject({ name: 'Valve 1', position: { x: 4, y: 0 }, pipelineId: 'main', rotation: 0, elevation: 3 });
    expect(markers()[1]).toMatchObject({ position: { x: 10, y: 3 }, pipelineId: 'main', rotation: 90 });
    click(4, 3); // away from the pipe: a plain marker
    expect(markers()[2]).not.toHaveProperty('pipelineId');
  });

  it('centers fitting models on the pipe and leaves mounted models alone', () => {
    const main = pipe('main', [pt(0, 0, 3), pt(10, 0, 3)]);
    const assets = [
      { id: 'valve', name: 'Valve', url: 'valve.glb', size: { width: 0.3, depth: 0.2, height: 0.4 } },
      { id: 'panel', name: 'Panel', url: 'panel.glb', size: { width: 0.5, depth: 0.2, height: 1.5 }, mounted: true },
    ];
    const { editor, click, markers } = setup(planWith({ pipelines: [main] }));
    editor.setAssets(assets);
    editor.setTool('marker');
    editor.setMarkerTemplate({ model: 'valve' });
    click(3, 0.05);
    editor.setMarkerTemplate({ model: 'panel' });
    click(6, 0.05);
    expect(markers()[0]).toMatchObject({ pipelineId: 'main', elevation: 2.8 });
    expect(markers()[1]).toMatchObject({ pipelineId: 'main' });
    expect(markers()[1]).not.toHaveProperty('elevation');
  });

  it('slides fittings along their pipeline; Alt-drag detaches them', () => {
    const main = pipe('main', [pt(0, 0, 3), pt(10, 0, 3), pt(10, 6, 3)]);
    const valve = marker('valve', 4, 0, { pipelineId: 'main', rotation: 180, elevation: 3 });
    const { drag, markers } = setup(planWith({ pipelines: [main], markers: [valve] }));
    drag([4, 0], [6, 0.5]);
    expect(markers()[0]).toMatchObject({ position: { x: 6, y: 0 }, rotation: 180 });
    drag([6, 0], [10.5, 3]); // around the corner: keeps facing "backwards" along the pipe
    expect(markers()[0]).toMatchObject({ position: { x: 10, y: 3 }, rotation: 270 });
    drag([10, 3], [8, 3], { altKey: true });
    expect(markers()[0]!.position).toEqual({ x: 8, y: 3 });
    expect(markers()[0]).not.toHaveProperty('pipelineId');
  });
});

describe('pipe editing with the select tool', () => {
  it('moves a pipeline with its fittings, detaching it from equipment', () => {
    const main = pipe('main', [pt(0, 0), pt(10, 0)], { from: 'tank' });
    const { drag, pipes, markers } = setup(
      planWith({ pipelines: [main], markers: [marker('tank', 0, 0), marker('valve', 4, 0, { pipelineId: 'main' })] }),
    );
    drag([7, 0], [7, 1]);
    expect(pipes()[0]!.points).toEqual([pt(0, 1), pt(10, 1)]);
    expect(pipes()[0]).not.toHaveProperty('from');
    expect(markers()[1]!.position).toEqual({ x: 4, y: 1 });
  });

  it('drags a vertex with its riser, and (de)attaches ends', () => {
    const main = pipe('main', [pt(0, 0, 0.5), pt(0, 0), pt(10, 0)], { from: 'tank' });
    const { editor, drag, pipes } = setup(planWith({ pipelines: [main], markers: [marker('tank', 0, 0), marker('pump', 10, 5)] }));
    editor.select({ kind: 'pipeline', id: 'main', levelId: editor.getActiveLevel().id });
    drag([0, 0], [0, 2]); // start handle: leaves the tank
    expect(pipes()[0]!.points.slice(0, 2)).toEqual([pt(0, 2, 0.5), pt(0, 2)]);
    expect(pipes()[0]).not.toHaveProperty('from');
    drag([10, 0], [10, 4.9]); // end handle onto the pump
    expect(pipes()[0]).toMatchObject({ to: 'pump' });
    expect(pipes()[0]!.points.at(-1)).toEqual(pt(10, 5));
    editor.undo();
    expect(pipes()[0]!.points.at(-1)).toEqual(pt(10, 0));
  });

  it('inserts and removes vertices with Alt-click', () => {
    const main = pipe('main', [pt(0, 0), pt(10, 0), pt(10, 6)]);
    const { editor, click, pipes } = setup(planWith({ pipelines: [main] }));
    click(5, 0); // select
    click(4, 0, { altKey: true });
    expect(pipes()[0]!.points).toEqual([pt(0, 0), pt(4, 0), pt(10, 0), pt(10, 6)]);
    click(10, 0, { altKey: true });
    expect(pipes()[0]!.points).toEqual([pt(0, 0), pt(4, 0), pt(10, 6)]);
    editor.undo();
    editor.undo();
    expect(pipes()[0]!.points).toHaveLength(3);
  });

  it('renders pipes, risers and tees with data colors as attributes', () => {
    const main = pipe('main', [pt(0, 0, 0.5), pt(0, 0, 3), pt(10, 0, 3)], { color: '#facc15' });
    const branch = pipe('branch', [pt(5, 0, 3), pt(5, 4, 3)]);
    const { editor } = setup(planWith({ pipelines: [main, branch] }));
    const el = editor.element;
    const lines = el.querySelectorAll('.vl-editor__pipe');
    expect(lines).toHaveLength(2);
    expect([...lines].map((l) => l.getAttribute('stroke'))).toContain('#facc15');
    expect(el.querySelectorAll('.vl-editor__pipe-riser')).toHaveLength(1);
    expect(el.querySelectorAll('.vl-editor__pipe-tee')).toHaveLength(1);
    editor.select({ kind: 'pipeline', id: 'main', levelId: editor.getActiveLevel().id });
    expect([...el.querySelectorAll('.vl-editor__pipe-z')].map((t) => t.textContent)).toEqual(['0.50 → 3.00 m', '3.00 m']);
  });
});

describe('pipe snapping helpers', () => {
  it('keeps segments orthogonal along the longer axis', () => {
    expect(orthoPoint({ x: 0, y: 0 }, { x: 3, y: 1 })).toEqual({ x: 3, y: 0 });
    expect(orthoPoint({ x: 0, y: 0 }, { x: 1, y: -3 })).toEqual({ x: 0, y: -3 });
  });

  it('finds wall faces on both sides and around corners, but not along parallel segments', () => {
    const walls = [{ id: 'w', start: { x: 0, y: 0 }, end: { x: 10, y: 0 }, thickness: 0.2 }];
    expect(snapToWallFace({ x: 3, y: -0.3 }, undefined, walls, 0.05, 0.2)?.point).toEqual({ x: 3, y: -0.2 });
    expect(snapToWallFace({ x: 10.1, y: 0.25 }, undefined, walls, 0.05, 0.2)?.point).toEqual({ x: 10.1, y: 0.2 });
    expect(snapToWallFace({ x: 11, y: 0.2 }, undefined, walls, 0.05, 0.2)).toBeNull();
    expect(snapToWallFace({ x: 5, y: 0.3 }, { x: 1, y: 0.3 }, walls, 0.05, 0.2)).toBeNull();
    expect(snapToWallFace({ x: 5, y: 0.3 }, { x: 5, y: 3 }, walls, 0.05, 0.2)?.point).toEqual({ x: 5, y: 0.2 });
  });
});
