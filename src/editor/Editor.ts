import { Emitter } from '../core/emitter';
import { centerDuration, easeOutCubic, type CenterOnOptions, type CenterOnTarget } from '../core/motion';
import { History } from '../core/history';
import {
  constrainAngle,
  distance,
  distanceToSegment,
  pointInPolygon,
  pointsEqual,
  polygonArea,
  polygonCentroid,
  snapPoint,
  snapToGrid,
} from '../model/geometry';
import {
  clonePlan,
  createId,
  createLevel,
  createPlan,
  entityPoints,
  findEntity,
  getLevel,
  levelBounds,
  levelSnapTargets,
  nextLevelElevation,
  removeEntity,
} from '../model/plan';
import type { Entity, EntityRef, FloorPlan, Level, Marker, Point, Room, Underlay, Wall } from '../model/types';
import { pointsAttr, svg } from './svg';

export type EditorTool = 'select' | 'wall' | 'room' | 'marker' | 'pan';

export const ALL_EDITOR_TOOLS: readonly EditorTool[] = ['select', 'wall', 'room', 'marker', 'pan'];
/** Tools available in read-only mode. */
const READ_ONLY_TOOLS: readonly EditorTool[] = ['select', 'pan'];

/**
 * A host-managed point drawn on top of the plan (e.g. a sensor position). Not part of the plan:
 * not saved, not in `change` events and not in the undo history. Set with `setOverlayPoints`.
 */
export interface OverlayPoint {
  id: string;
  levelId: string;
  position: Point;
  /** Fill color (any CSS color). Default: `--vl-overlay`. */
  color?: string;
  /** Text shown next to the point. */
  label?: string;
  /** Can be dragged with the select tool. Default true. */
  draggable?: boolean;
}

/** `overlaypointmove`: a drag ended with the point at `position` (plan meters, snapped like markers). */
export interface OverlayPointMove {
  id: string;
  levelId: string;
  position: Point;
}

export interface EditorOptions {
  plan?: FloorPlan;
  /** Initially active level id (default: first level). */
  levelId?: string;
  tool?: EditorTool;
  /** Grid size in meters. Default 0.25. */
  grid?: number;
  /** Snap to grid and existing points. Default true. Hold Alt while drawing to bypass. */
  snap?: boolean;
  /** Thickness for new walls, in meters. Default 0.15. */
  wallThickness?: number;
  /**
   * Tools the user may use (others are ignored by `setTool` and keyboard shortcuts).
   * Default: all. The editor has no toolbar of its own, so this limits what a host offers.
   */
  tools?: EditorTool[];
  /** Read-only: the user can select, pan and zoom but not change the plan. Default false. */
  readOnly?: boolean;
  /** Host-managed points drawn on top (see `setOverlayPoints`). */
  overlayPoints?: OverlayPoint[];
}

export interface EditorEvents {
  /** Fired after every committed change (not on each pointer move during a drag). */
  change: FloorPlan;
  selectionchange: EntityRef | null;
  toolchange: EditorTool;
  levelchange: string;
  historychange: { canUndo: boolean; canRedo: boolean };
  /** An overlay point was dropped after dragging. Update your own data, then `setOverlayPoints`. */
  overlaypointmove: OverlayPointMove;
  /** The selected overlay point changed (null: none). Independent of `selectionchange`. */
  overlaypointselect: string | null;
}

type EntityPatch = Partial<Omit<Wall, 'id'>> | Partial<Omit<Room, 'id'>> | Partial<Omit<Marker, 'id'>>;

type Drag =
  | { type: 'pan'; startX: number; startY: number; ox: number; oy: number }
  | { type: 'move'; ref: EntityRef; start: Point; before: FloorPlan; original: Point[]; moved: boolean }
  | { type: 'handle'; ref: EntityRef; index: number; before: FloorPlan; moved: boolean }
  | { type: 'overlay'; id: string; start: Point; original: Point; moved: boolean };

type Draft = { kind: 'wall' | 'room'; points: Point[] };

/** Pointer hit tolerance in screen pixels. */
const HIT_PX = 6;
/** Snap-to-point tolerance in screen pixels. */
const SNAP_PX = 10;
/** Overlay point radius and hit tolerance in screen pixels. */
const OVERLAY_PX = 7;
const MIN_SCALE = 4;
const MAX_SCALE = 400;


/**
 * 2D SVG floor plan editor: draw walls, rooms and markers on a snapping grid,
 * select/move/reshape them, manage levels, with undo/redo.
 */
export class FloorplanEditor {
  readonly element: HTMLDivElement;

  private readonly events = new Emitter<EditorEvents>();
  private readonly history = new History<FloorPlan>();
  private readonly svgEl: SVGSVGElement;
  private readonly gridLayer: SVGGElement;
  private readonly underlayLayer: SVGGElement;
  private readonly world: SVGGElement;
  private underlay: Underlay | null = null;
  private readonly resizeObserver: ResizeObserver;

  private plan: FloorPlan;
  private levelId: string;
  private tool: EditorTool;
  private selection: EntityRef | null = null;
  private grid: number;
  private snapEnabled: boolean;
  private wallThickness: number;
  /** Screen = world * scale + offset. */
  private view = { scale: 40, ox: 40, oy: 40 };
  private drag: Drag | null = null;
  private draft: Draft | null = null;
  private cursor: { point: Point; snapped: boolean } | null = null;
  private tools: EditorTool[];
  private readOnly: boolean;
  private overlayPoints: OverlayPoint[] = [];
  private overlaySelection: string | null = null;
  /** rAF id of a running `centerOn` animation. */
  private viewAnimation: number | null = null;

  constructor(container: HTMLElement, options: EditorOptions = {}) {
    this.plan = clonePlan(options.plan ?? createPlan());
    this.levelId = options.levelId ?? this.plan.levels[0]!.id;
    this.tools = sanitizeTools(options.tools);
    this.readOnly = options.readOnly ?? false;
    this.overlayPoints = structuredClone(options.overlayPoints ?? []);
    this.tool = this.allowedTool(options.tool ?? 'select');
    this.grid = options.grid ?? 0.25;
    this.snapEnabled = options.snap ?? true;
    this.wallThickness = options.wallThickness ?? 0.15;

    this.element = document.createElement('div');
    this.element.className = 'vl-editor';
    this.element.tabIndex = 0;
    this.element.dataset.tool = this.tool;
    this.element.toggleAttribute('data-readonly', this.readOnly);
    container.appendChild(this.element);

    this.svgEl = svg('svg', { class: 'vl-editor__svg', width: '100%', height: '100%' }, this.element);
    this.gridLayer = svg('g', { class: 'vl-editor__grid' }, this.svgEl);
    // Persistent (not re-rendered per frame) so the image isn't re-decoded while dragging.
    this.underlayLayer = svg('g', { class: 'vl-editor__underlay' }, this.svgEl);
    this.world = svg('g', {}, this.svgEl);

    this.svgEl.addEventListener('pointerdown', this.onPointerDown);
    this.svgEl.addEventListener('pointermove', this.onPointerMove);
    this.svgEl.addEventListener('pointerup', this.onPointerUp);
    this.svgEl.addEventListener('pointerleave', this.onPointerLeave);
    this.svgEl.addEventListener('wheel', this.onWheel, { passive: false });
    this.svgEl.addEventListener('contextmenu', this.onContextMenu);
    this.element.addEventListener('keydown', this.onKeyDown);

    this.resizeObserver = new ResizeObserver(() => this.render());
    this.resizeObserver.observe(this.element);
    this.fitView();
  }

  // ---------------------------------------------------------------- public API

  on<K extends keyof EditorEvents>(type: K, handler: (payload: EditorEvents[K]) => void): () => void {
    return this.events.on(type, handler);
  }

  off<K extends keyof EditorEvents>(type: K, handler: (payload: EditorEvents[K]) => void): void {
    this.events.off(type, handler);
  }

  /** A copy of the current plan. */
  getPlan(): FloorPlan {
    return clonePlan(this.plan);
  }

  /** Replace the plan. Clears undo history unless `keepHistory` is true (then it is undoable). */
  setPlan(plan: FloorPlan, { keepHistory = false }: { keepHistory?: boolean } = {}): void {
    if (keepHistory) this.history.push(clonePlan(this.plan));
    else this.history.clear();
    this.plan = clonePlan(plan);
    this.draft = null;
    this.selection = null;
    if (!getLevel(this.plan, this.levelId)) this.levelId = this.plan.levels[0]!.id;
    this.fitView();
    this.emitChange();
    this.events.emit('selectionchange', null);
    this.events.emit('levelchange', this.levelId);
  }

  getTool(): EditorTool {
    return this.tool;
  }

  /** Switch tools. Ignored for tools that `tools` or read-only mode don't allow. */
  setTool(tool: EditorTool): void {
    if (tool === this.tool || !this.availableTools().includes(tool)) return;
    this.finishDraft();
    this.tool = tool;
    this.element.dataset.tool = tool;
    this.render();
    this.events.emit('toolchange', tool);
  }

  /** The tools the user can currently use (the `tools` option, narrowed by read-only mode). */
  availableTools(): EditorTool[] {
    return this.tools.filter((t) => !this.readOnly || READ_ONLY_TOOLS.includes(t));
  }

  /** Restrict the tools (default: all). Switches to the first allowed tool if the current one isn't. */
  setTools(tools: EditorTool[]): void {
    this.tools = sanitizeTools(tools);
    this.ensureAllowedTool();
  }

  isReadOnly(): boolean {
    return this.readOnly;
  }

  /**
   * Read-only mode: the user can select, pan and zoom, and drag draggable overlay points, but not
   * draw, move, reshape or delete plan entities, or undo/redo with the keyboard. API calls
   * (`setPlan`, `updateEntity`…) still apply. Drawing tools fall back to select.
   */
  setReadOnly(readOnly: boolean): void {
    if (readOnly === this.readOnly) return;
    this.readOnly = readOnly;
    this.element.toggleAttribute('data-readonly', readOnly);
    if (readOnly) {
      this.draft = null;
      if (this.drag?.type === 'move' || this.drag?.type === 'handle') this.cancelDrag();
    }
    this.ensureAllowedTool();
    this.render();
  }

  /** Replace the host-managed overlay points (no undo history, no `change` event). */
  setOverlayPoints(points: OverlayPoint[]): void {
    // A drag in progress keeps its live position until it's dropped.
    const dragging = this.drag?.type === 'overlay' ? this.overlayPoints.find((p) => p.id === (this.drag as { id: string }).id) : undefined;
    this.overlayPoints = structuredClone(points);
    if (dragging) {
      const next = this.overlayPoints.find((p) => p.id === dragging.id);
      if (next) next.position = dragging.position;
      else this.drag = null;
    }
    if (this.overlaySelection && !this.overlayPoints.some((p) => p.id === this.overlaySelection)) this.selectOverlayPoint(null);
    this.render();
  }

  getOverlayPoints(): OverlayPoint[] {
    return structuredClone(this.overlayPoints);
  }

  getOverlaySelection(): string | null {
    return this.overlaySelection;
  }

  /** Select an overlay point (clears the entity selection), or null to deselect. */
  selectOverlayPoint(id: string | null): void {
    const next = id && this.overlayPoints.some((p) => p.id === id) ? id : null;
    if (next) this.select(null);
    if (next === this.overlaySelection) return;
    this.overlaySelection = next;
    this.render();
    this.events.emit('overlaypointselect', next);
  }

  /**
   * Converts client (viewport) coordinates, e.g. from a `drop` event, to a position on the active
   * level in plan meters. Returns null outside the editor. `snap: true` applies the grid and
   * point snapping used for markers.
   */
  clientToPlan(clientX: number, clientY: number, { snap = false }: { snap?: boolean } = {}): { levelId: string; position: Point } | null {
    const rect = this.svgEl.getBoundingClientRect();
    if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) return null;
    const raw = this.toWorld({ clientX, clientY });
    return { levelId: this.levelId, position: snap ? this.snap(raw, { altKey: false }).point : raw };
  }

  getActiveLevel(): Level {
    return getLevel(this.plan, this.levelId)!;
  }

  setActiveLevel(levelId: string): void {
    if (levelId === this.levelId || !getLevel(this.plan, levelId)) return;
    this.draft = null;
    this.levelId = levelId;
    this.select(null);
    this.render();
    this.events.emit('levelchange', levelId);
  }

  /** Add a level stacked above the others and make it active. */
  addLevel(name?: string): Level {
    const height = this.getActiveLevel().height;
    const level = createLevel({
      name: name ?? `Level ${this.plan.levels.length}`,
      elevation: nextLevelElevation(this.plan),
      height,
    });
    this.mutate(() => this.plan.levels.push(level));
    this.setActiveLevel(level.id);
    return level;
  }

  /** Remove a level. The last remaining level cannot be removed. */
  removeLevel(levelId: string): boolean {
    if (this.plan.levels.length <= 1 || !getLevel(this.plan, levelId)) return false;
    const wasActive = levelId === this.levelId;
    this.mutate(() => {
      this.plan.levels = this.plan.levels.filter((l) => l.id !== levelId);
      if (wasActive) {
        this.levelId = this.plan.levels[0]!.id;
        this.draft = null;
        this.selection = null;
      }
    });
    if (wasActive) {
      this.events.emit('selectionchange', null);
      this.events.emit('levelchange', this.levelId);
    }
    return true;
  }

  updateLevel(levelId: string, patch: Partial<Pick<Level, 'name' | 'elevation' | 'height'>>): void {
    const level = getLevel(this.plan, levelId);
    if (!level) return;
    this.mutate(() => Object.assign(level, patch));
  }

  setPlanName(name: string): void {
    this.mutate(() => {
      this.plan.name = name;
    });
  }

  getSelection(): EntityRef | null {
    return this.selection ? { ...this.selection } : null;
  }

  /** A copy of the selected entity, if any. */
  getSelectedEntity(): Entity | null {
    const e = this.selection && findEntity(this.plan, this.selection);
    return e ? structuredClone(e) : null;
  }

  select(ref: EntityRef | null): void {
    const same = ref?.id === this.selection?.id && ref?.kind === this.selection?.kind;
    this.selection = ref && findEntity(this.plan, ref) ? { ...ref } : null;
    if (this.selection && this.overlaySelection) {
      this.overlaySelection = null;
      this.events.emit('overlaypointselect', null);
    }
    this.render();
    if (!same) this.events.emit('selectionchange', this.getSelection());
  }

  /** Merge `patch` into an entity (the `id` cannot be changed). */
  updateEntity(ref: EntityRef, patch: EntityPatch): void {
    const entity = findEntity(this.plan, ref);
    if (!entity) return;
    const { id: _ignored, ...rest } = patch as EntityPatch & { id?: string };
    this.mutate(() => Object.assign(entity, structuredClone(rest)));
  }

  deleteSelection(): void {
    const sel = this.selection;
    if (!sel) return;
    this.mutate(() => removeEntity(this.plan, sel));
    this.select(null);
  }

  undo(): void {
    const prev = this.history.undo(clonePlan(this.plan));
    if (prev) this.restore(prev);
  }

  redo(): void {
    const next = this.history.redo(clonePlan(this.plan));
    if (next) this.restore(next);
  }

  canUndo(): boolean {
    return this.history.canUndo;
  }

  canRedo(): boolean {
    return this.history.canRedo;
  }

  setGrid(grid: number): void {
    this.grid = Math.max(0, grid);
    this.render();
  }

  setSnap(enabled: boolean): void {
    this.snapEnabled = enabled;
  }

  setWallThickness(thickness: number): void {
    if (thickness > 0) this.wallThickness = thickness;
  }

  /**
   * Pan so `target.position` is in the middle of the editor, keeping the zoom. Switches to
   * `target.levelId` first if needed. Eases there (default 300 ms, ease-out) unless
   * `animate: false` or the user prefers reduced motion. User panning or zooming cancels the
   * animation. Returns false for an unknown level.
   */
  centerOn(target: CenterOnTarget, options: CenterOnOptions = {}): boolean {
    if (!getLevel(this.plan, target.levelId)) return false;
    this.setActiveLevel(target.levelId);
    this.cancelViewAnimation();
    const { width, height } = this.size();
    const to = { ox: width / 2 - target.position.x * this.view.scale, oy: height / 2 - target.position.y * this.view.scale };
    const duration = centerDuration(options);
    if (duration === 0) {
      this.view = { ...this.view, ...to };
      this.render();
      return true;
    }
    const from = { ox: this.view.ox, oy: this.view.oy };
    let start: number | null = null;
    const step = (time: number) => {
      start ??= time;
      const t = Math.min((time - start) / duration, 1);
      const e = easeOutCubic(t);
      this.view = { ...this.view, ox: from.ox + (to.ox - from.ox) * e, oy: from.oy + (to.oy - from.oy) * e };
      this.render();
      this.viewAnimation = t < 1 ? requestAnimationFrame(step) : null;
    };
    this.viewAnimation = requestAnimationFrame(step);
    return true;
  }

  /** Zoom/pan so the active level fits the editor. */
  fitView(): void {
    this.cancelViewAnimation();
    const { width, height } = this.size();
    const u = this.underlay;
    const b = levelBounds(this.getActiveLevel()) ??
      (u ? { minX: u.x, minY: u.y, maxX: u.x + u.width, maxY: u.y + u.height } : { minX: 0, minY: 0, maxX: 20, maxY: 12 });
    const pad = 40;
    const w = Math.max(b.maxX - b.minX, 1);
    const h = Math.max(b.maxY - b.minY, 1);
    const scale = clamp(Math.min((width - pad * 2) / w, (height - pad * 2) / h), MIN_SCALE, MAX_SCALE);
    this.view = {
      scale,
      ox: (width - w * scale) / 2 - b.minX * scale,
      oy: (height - h * scale) / 2 - b.minY * scale,
    };
    this.render();
  }

  /** Show a reference image under the plan (e.g. the scanned drawing), or remove it with null. */
  setUnderlay(underlay: Underlay | null): void {
    this.underlay = underlay ? { ...underlay } : null;
    this.underlayLayer.replaceChildren();
    if (this.underlay) {
      const { url, x, y, width, height, opacity = 0.5 } = this.underlay;
      svg('image', { href: url, x, y, width, height, opacity, preserveAspectRatio: 'none' }, this.underlayLayer);
    }
    this.render();
  }

  getUnderlay(): Underlay | null {
    return this.underlay ? { ...this.underlay } : null;
  }

  dispose(): void {
    this.cancelViewAnimation();
    this.resizeObserver.disconnect();
    this.events.clear();
    this.element.remove();
  }

  // ---------------------------------------------------------------- mutations

  /** Apply a single undoable change. */
  private mutate(fn: () => void): void {
    this.history.push(clonePlan(this.plan));
    fn();
    this.emitChange();
  }

  private restore(plan: FloorPlan): void {
    this.plan = plan;
    this.draft = null;
    if (!getLevel(this.plan, this.levelId)) {
      this.levelId = this.plan.levels[0]!.id;
      this.events.emit('levelchange', this.levelId);
    }
    if (this.selection && !findEntity(this.plan, this.selection)) this.select(null);
    this.emitChange();
  }

  private emitChange(): void {
    this.render();
    this.events.emit('change', this.getPlan());
    this.events.emit('historychange', { canUndo: this.canUndo(), canRedo: this.canRedo() });
  }

  private finishDraft(): void {
    const draft = this.draft;
    this.draft = null;
    if (draft?.kind === 'room') this.commitRoom(draft.points);
    this.render();
  }

  private allowedTool(tool: EditorTool): EditorTool {
    const tools = this.availableTools();
    return tools.includes(tool) ? tool : (tools[0] ?? 'pan');
  }

  private ensureAllowedTool(): void {
    const tool = this.allowedTool(this.tool);
    if (tool === this.tool) return;
    this.draft = null;
    this.tool = tool;
    this.element.dataset.tool = tool;
    this.render();
    this.events.emit('toolchange', tool);
  }

  /** Abandon an entity drag, restoring the plan as it was before it. */
  private cancelDrag(): void {
    const drag = this.drag;
    this.drag = null;
    if (drag?.type === 'move' || drag?.type === 'handle') this.plan = drag.before;
  }

  private commitRoom(points: Point[]): void {
    if (points.length < 3 || polygonArea(points) < 1e-6) return;
    const level = this.getActiveLevel();
    const room: Room = { id: createId('room'), name: `Room ${level.rooms.length + 1}`, points };
    this.mutate(() => level.rooms.push(room));
    this.select({ kind: 'room', id: room.id, levelId: level.id });
  }

  // ---------------------------------------------------------------- geometry helpers

  private cancelViewAnimation(): void {
    if (this.viewAnimation !== null) cancelAnimationFrame(this.viewAnimation);
    this.viewAnimation = null;
  }

  private size(): { width: number; height: number } {
    const rect = this.element.getBoundingClientRect();
    return { width: rect.width || 800, height: rect.height || 600 };
  }

  private toWorld(event: { clientX: number; clientY: number }): Point {
    const rect = this.svgEl.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left - this.view.ox) / this.view.scale,
      y: (event.clientY - rect.top - this.view.oy) / this.view.scale,
    };
  }

  private snap(p: Point, event: { altKey: boolean }, exclude?: Point): { point: Point; snapped: boolean } {
    if (!this.snapEnabled || event.altKey) return { point: p, snapped: false };
    const r = snapPoint(p, {
      grid: this.grid,
      targets: levelSnapTargets(this.getActiveLevel(), exclude),
      tolerance: SNAP_PX / this.view.scale,
    });
    return { point: r.point, snapped: r.snappedToTarget };
  }

  /** Snapped drawing point, optionally constrained to 45° steps from the previous draft point (Shift). */
  private drawPoint(raw: Point, event: { altKey: boolean; shiftKey: boolean }): { point: Point; snapped: boolean } {
    const last = this.draft?.points.at(-1);
    const s = this.snap(raw, event);
    if (event.shiftKey && last && !s.snapped) return { point: constrainAngle(last, s.point), snapped: false };
    return s;
  }

  /** The topmost draggable-or-not overlay point on the active level within reach of `p`. */
  private overlayHit(p: Point): OverlayPoint | null {
    const tol = (OVERLAY_PX + 3) / this.view.scale;
    for (const point of [...this.overlayPoints].reverse()) {
      if (point.levelId === this.levelId && distance(p, point.position) <= tol) return point;
    }
    return null;
  }

  private hitTest(p: Point): { ref: EntityRef; handle?: number } | null {
    const level = this.getActiveLevel();
    const tol = HIT_PX / this.view.scale;
    const ref = (kind: EntityRef['kind'], id: string): EntityRef => ({ kind, id, levelId: level.id });

    // Handles of the selected entity take priority (none in read-only mode).
    if (this.selection && this.selection.kind !== 'marker' && !this.readOnly) {
      const entity = findEntity(this.plan, this.selection);
      if (entity) {
        const index = entityPoints(this.selection.kind, entity).findIndex((q) => distance(p, q) <= tol * 1.5);
        if (index >= 0) return { ref: this.selection, handle: index };
      }
    }
    for (const m of [...level.markers].reverse()) {
      if (distance(p, m.position) <= 0.2 + tol) return { ref: ref('marker', m.id) };
    }
    for (const w of [...level.walls].reverse()) {
      if (distanceToSegment(p, w.start, w.end) <= w.thickness / 2 + tol) return { ref: ref('wall', w.id) };
    }
    for (const r of [...level.rooms].reverse()) {
      if (pointInPolygon(p, r.points)) return { ref: ref('room', r.id) };
    }
    return null;
  }

  // ---------------------------------------------------------------- pointer & keyboard

  private onPointerDown = (event: PointerEvent): void => {
    this.element.focus({ preventScroll: true });
    if (event.button === 2) return; // handled by contextmenu
    this.svgEl.setPointerCapture(event.pointerId);
    const raw = this.toWorld(event);

    if (event.button === 1 || this.tool === 'pan') {
      this.startPan(event);
      return;
    }

    switch (this.tool) {
      case 'select': {
        const overlay = this.overlayHit(raw);
        if (overlay) {
          this.selectOverlayPoint(overlay.id);
          if (overlay.draggable ?? true) this.drag = { type: 'overlay', id: overlay.id, start: raw, original: { ...overlay.position }, moved: false };
          return;
        }
        const hit = this.hitTest(raw);
        if (!hit) {
          this.select(null);
          this.selectOverlayPoint(null);
          this.startPan(event);
          return;
        }
        const entity = findEntity(this.plan, hit.ref)!;
        if (this.readOnly) {
          this.select(hit.ref); // inspect only
          return;
        }
        if (hit.handle !== undefined) {
          this.drag = { type: 'handle', ref: hit.ref, index: hit.handle, before: clonePlan(this.plan), moved: false };
        } else {
          this.select(hit.ref);
          this.drag = {
            type: 'move',
            ref: hit.ref,
            start: raw,
            before: clonePlan(this.plan),
            original: entityPoints(hit.ref.kind, entity).map((q) => ({ ...q })),
            moved: false,
          };
        }
        return;
      }
      case 'wall':
        this.wallClick(this.drawPoint(raw, event).point);
        return;
      case 'room':
        this.roomClick(this.drawPoint(raw, event).point);
        return;
      case 'marker': {
        const level = this.getActiveLevel();
        const marker: Marker = {
          id: createId('marker'),
          name: `Marker ${level.markers.length + 1}`,
          position: this.snap(raw, event).point,
        };
        this.mutate(() => level.markers.push(marker));
        return;
      }
    }
  };

  private startPan(event: PointerEvent): void {
    this.cancelViewAnimation();
    this.drag = { type: 'pan', startX: event.clientX, startY: event.clientY, ox: this.view.ox, oy: this.view.oy };
    this.element.classList.add('is-panning');
  }

  private wallClick(p: Point): void {
    const last = this.draft?.points.at(-1);
    if (!this.draft || !last) {
      this.draft = { kind: 'wall', points: [p] };
    } else if (pointsEqual(last, p)) {
      this.draft = null; // clicking the same point again (or double-click) ends the chain
    } else {
      const level = this.getActiveLevel();
      const wall: Wall = { id: createId('wall'), start: { ...last }, end: { ...p }, thickness: this.wallThickness };
      this.mutate(() => level.walls.push(wall));
      this.draft = { kind: 'wall', points: [p] };
    }
    this.render();
  }

  private roomClick(p: Point): void {
    if (!this.draft) {
      this.draft = { kind: 'room', points: [p] };
    } else {
      const pts = this.draft.points;
      const closes = pts.length >= 3 && (distance(p, pts[0]!) <= SNAP_PX / this.view.scale || pointsEqual(p, pts.at(-1)!));
      if (closes) {
        this.finishDraft();
        return;
      }
      if (!pointsEqual(p, pts.at(-1)!)) pts.push(p);
    }
    this.render();
  }

  private onPointerMove = (event: PointerEvent): void => {
    const raw = this.toWorld(event);
    const drag = this.drag;

    if (drag?.type === 'pan') {
      this.view.ox = drag.ox + event.clientX - drag.startX;
      this.view.oy = drag.oy + event.clientY - drag.startY;
    } else if (drag?.type === 'move') {
      const entity = findEntity(this.plan, drag.ref);
      if (entity) {
        let delta = { x: raw.x - drag.start.x, y: raw.y - drag.start.y };
        if (this.snapEnabled && !event.altKey) delta = snapToGrid(delta, this.grid);
        entityPoints(drag.ref.kind, entity).forEach((q, i) => {
          q.x = drag.original[i]!.x + delta.x;
          q.y = drag.original[i]!.y + delta.y;
        });
        drag.moved ||= delta.x !== 0 || delta.y !== 0;
      }
    } else if (drag?.type === 'overlay') {
      const point = this.overlayPoints.find((p) => p.id === drag.id);
      if (point) {
        const target = { x: drag.original.x + raw.x - drag.start.x, y: drag.original.y + raw.y - drag.start.y };
        const next = this.snap(target, event).point;
        drag.moved ||= !pointsEqual(next, drag.original);
        point.position = next;
      }
    } else if (drag?.type === 'handle') {
      const entity = findEntity(this.plan, drag.ref);
      const target = entity && entityPoints(drag.ref.kind, entity)[drag.index];
      if (target) {
        const { point } = this.snap(raw, event, target);
        drag.moved ||= !pointsEqual(point, target);
        target.x = point.x;
        target.y = point.y;
      }
    }

    this.cursor = this.tool === 'wall' || this.tool === 'room' ? this.drawPoint(raw, event) : this.tool === 'marker' ? this.snap(raw, event) : null;
    this.render();
  };

  private onPointerUp = (event: PointerEvent): void => {
    if (this.svgEl.hasPointerCapture(event.pointerId)) this.svgEl.releasePointerCapture(event.pointerId);
    const drag = this.drag;
    this.drag = null;
    this.element.classList.remove('is-panning');
    if ((drag?.type === 'move' || drag?.type === 'handle') && drag.moved) {
      this.history.push(drag.before);
      this.emitChange();
    } else if (drag?.type === 'overlay' && drag.moved) {
      const point = this.overlayPoints.find((p) => p.id === drag.id);
      if (point) this.events.emit('overlaypointmove', { id: point.id, levelId: point.levelId, position: { ...point.position } });
    }
  };

  private onPointerLeave = (): void => {
    this.cursor = null;
    this.render();
  };

  private onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    this.cancelViewAnimation();
    const rect = this.svgEl.getBoundingClientRect();
    const sx = event.clientX - rect.left;
    const sy = event.clientY - rect.top;
    const scale = clamp(this.view.scale * Math.exp(-event.deltaY * 0.0015), MIN_SCALE, MAX_SCALE);
    const k = scale / this.view.scale;
    this.view = { scale, ox: sx - (sx - this.view.ox) * k, oy: sy - (sy - this.view.oy) * k };
    this.render();
  };

  private onContextMenu = (event: MouseEvent): void => {
    event.preventDefault();
    this.finishDraft();
  };

  private onKeyDown = (event: KeyboardEvent): void => {
    const mod = event.metaKey || event.ctrlKey;
    const key = event.key.toLowerCase();
    if (mod && (key === 'z' || key === 'y') && this.readOnly) return;
    if (mod && key === 'z') {
      event.preventDefault();
      if (event.shiftKey) this.redo();
      else this.undo();
      return;
    }
    if (mod && key === 'y') {
      event.preventDefault();
      this.redo();
      return;
    }
    if (mod || event.altKey) return;

    const toolKeys: Record<string, EditorTool> = { v: 'select', w: 'wall', r: 'room', m: 'marker', h: 'pan' };
    if (key === 'escape') {
      if (this.draft) {
        this.draft = null;
        this.render();
      } else {
        this.select(null);
        this.selectOverlayPoint(null);
      }
    } else if (key === 'enter') {
      this.finishDraft();
    } else if ((key === 'delete' || key === 'backspace') && !this.readOnly) {
      event.preventDefault();
      this.deleteSelection();
    } else if (key === 'f') {
      this.fitView();
    } else if (toolKeys[key]) {
      this.setTool(toolKeys[key]);
    }
  };

  // ---------------------------------------------------------------- rendering

  private render(): void {
    this.renderGrid();
    const { scale, ox, oy } = this.view;
    const px = 1 / scale; // one screen pixel in world units
    const w = this.world;
    w.replaceChildren();
    w.setAttribute('transform', `translate(${ox} ${oy}) scale(${scale})`);
    this.underlayLayer.setAttribute('transform', `translate(${ox} ${oy}) scale(${scale})`);

    const level = this.getActiveLevel();
    const sel = this.selection;
    const isSel = (kind: EntityRef['kind'], id: string) => sel?.kind === kind && sel.id === id;

    // Colors come from CSS classes (themable via --vl-* custom properties in styles.css).
    // Entity colors from plan data are set as `fill` attributes; CSS only fills `:not([fill])`.
    for (const room of level.rooms) {
      svg('polygon', {
        points: pointsAttr(room.points),
        fill: room.color,
        class: cls('vl-editor__room', isSel('room', room.id)),
      }, w);
    }

    for (const wall of level.walls) {
      if (isSel('wall', wall.id)) {
        svg('line', { ...lineAttrs(wall.start, wall.end), 'stroke-width': wall.thickness + 6 * px, class: 'vl-editor__wall-selection' }, w);
      }
      svg('line', { ...lineAttrs(wall.start, wall.end), 'stroke-width': wall.thickness, class: 'vl-editor__wall' }, w);
    }

    for (const room of level.rooms) {
      if (!room.name) continue;
      const c = polygonCentroid(room.points);
      const label = svg('text', { x: c.x, y: c.y, 'font-size': 12 * px, class: 'vl-editor__label', 'text-anchor': 'middle' }, w);
      svg('tspan', { x: c.x, dy: 0 }, label).textContent = room.name;
      svg('tspan', { x: c.x, dy: 14 * px, class: 'vl-editor__sublabel' }, label).textContent = `${polygonArea(room.points).toFixed(1)} m²`;
    }

    for (const marker of level.markers) {
      svg('circle', {
        cx: marker.position.x,
        cy: marker.position.y,
        r: 0.2,
        fill: marker.color,
        class: cls('vl-editor__marker', isSel('marker', marker.id)),
      }, w);
    }

    // Handles for the selected wall/room.
    if (sel && sel.kind !== 'marker' && !this.readOnly) {
      const entity = findEntity(this.plan, sel);
      if (entity) {
        for (const p of entityPoints(sel.kind, entity)) {
          svg('circle', { cx: p.x, cy: p.y, r: 5 * px, class: 'vl-editor__handle' }, w);
        }
      }
    }

    this.renderOverlay(px);
    this.renderDraft(px);
  }

  /** Host-managed overlay points on the active level, at a fixed screen size, above the plan. */
  private renderOverlay(px: number): void {
    for (const point of this.overlayPoints) {
      if (point.levelId !== this.levelId) continue;
      const { x, y } = point.position;
      const selected = point.id === this.overlaySelection;
      const g = svg('g', { class: cls('vl-editor__overlay-point', selected), 'data-overlay-id': point.id }, this.world);
      svg('circle', { cx: x, cy: y, r: OVERLAY_PX * px, fill: point.color }, g);
      if (point.label) {
        svg('text', { x: x + (OVERLAY_PX + 4) * px, y, 'font-size': 11 * px, 'dominant-baseline': 'central', class: 'vl-editor__overlay-label' }, g).textContent = point.label;
      }
    }
  }

  private renderDraft(px: number): void {
    const w = this.world;
    const cursor = this.cursor?.point;
    const draft = this.draft;

    if (draft) {
      const pts = cursor ? [...draft.points, cursor] : draft.points;
      if (draft.kind === 'room' && pts.length >= 3) {
        svg('polygon', { points: pointsAttr(pts), class: 'vl-editor__draft-area' }, w);
      }
      if (draft.kind === 'wall' && cursor) {
        svg('line', { ...lineAttrs(draft.points[0]!, cursor), 'stroke-width': this.wallThickness, class: 'vl-editor__wall is-draft' }, w);
      }
      svg('polyline', { points: pointsAttr(pts), class: 'vl-editor__draft-line' }, w);
      for (const [i, p] of draft.points.entries()) {
        svg('circle', { cx: p.x, cy: p.y, r: (i === 0 && draft.kind === 'room' ? 6 : 4) * px, class: 'vl-editor__draft-point' }, w);
      }
      const last = draft.points.at(-1);
      if (cursor && last) {
        const len = distance(last, cursor);
        if (len > 0) {
          svg('text', { x: cursor.x + 10 * px, y: cursor.y - 10 * px, 'font-size': 12 * px, class: 'vl-editor__measure' }, w).textContent = `${len.toFixed(2)} m`;
        }
      }
    }

    if (this.cursor) {
      svg('circle', {
        cx: this.cursor.point.x,
        cy: this.cursor.point.y,
        r: 4 * px,
        class: this.cursor.snapped ? 'vl-editor__cursor is-snapped' : 'vl-editor__cursor',
      }, w);
    }
  }

  private renderGrid(): void {
    const g = this.gridLayer;
    g.replaceChildren();
    const { scale, ox, oy } = this.view;
    const { width, height } = this.size();
    let step = this.grid > 0 ? this.grid : 1;
    while (step * scale < 12) step *= 2;

    const x0 = Math.floor(-ox / scale / step) * step;
    const x1 = (width - ox) / scale;
    const y0 = Math.floor(-oy / scale / step) * step;
    const y1 = (height - oy) / scale;
    const isMajor = (v: number) => Math.abs(v - Math.round(v)) < 1e-6 && Math.round(v) % 5 === 0;

    for (let x = x0; x <= x1; x += step) {
      const sx = Math.round(x * scale + ox) + 0.5;
      svg('line', { x1: sx, y1: 0, x2: sx, y2: height, class: isMajor(x) ? 'is-major' : undefined }, g);
    }
    for (let y = y0; y <= y1; y += step) {
      const sy = Math.round(y * scale + oy) + 0.5;
      svg('line', { x1: 0, y1: sy, x2: width, y2: sy, class: isMajor(y) ? 'is-major' : undefined }, g);
    }
  }
}

function cls(base: string, selected: boolean): string {
  return selected ? `${base} is-selected` : base;
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

function lineAttrs(a: Point, b: Point) {
  return { x1: a.x, y1: a.y, x2: b.x, y2: b.y };
}

function sanitizeTools(tools: readonly EditorTool[] | undefined): EditorTool[] {
  const allowed = (tools ?? ALL_EDITOR_TOOLS).filter((t) => ALL_EDITOR_TOOLS.includes(t));
  return allowed.length ? [...new Set(allowed)] : ['pan'];
}
