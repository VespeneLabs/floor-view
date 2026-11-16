import { Emitter } from '../core/emitter';
import { POINT_GLYPHS, pointShape, type PointShape } from '../core/shapes';
import { centerDuration, easeOutCubic, type CenterOnOptions, type CenterOnTarget } from '../core/motion';
import { History } from '../core/history';
import { indexAssets, markerFootprint, type ModelAsset } from '../model/assets';
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
import {
  alignRotation,
  isRiser,
  nearestPointOnPipeline,
  pipelineEndRun,
  pipelineJunctions,
  segmentRotation,
  syncPipelineLinks,
} from '../model/pipeline';
import { routePipeline } from '../model/routing';
import type { Entity, EntityRef, FloorPlan, Level, Marker, PipePoint, Pipeline, Point, Room, Underlay, Wall } from '../model/types';
import { orthoPoint, snapToWallFace } from './pipes';
import { pointsAttr, svg } from './svg';

export type EditorTool = 'select' | 'wall' | 'room' | 'marker' | 'pipe' | 'pan';

export const ALL_EDITOR_TOOLS: readonly EditorTool[] = ['select', 'wall', 'room', 'marker', 'pipe', 'pan'];
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
  /**
   * Glyph, matching the viewer's 2D point glyphs: sphere → circle (default), box → square,
   * cylinder → hexagon, cone → triangle, diamond → diamond.
   */
  shape?: PointShape;
  /** Outline ring color around the point (e.g. alert state), like the viewer's `ring`. Null/undefined: none. */
  ring?: string | null;
  /** Text shown next to the point. */
  label?: string;
  /** Can be dragged with the select tool. Default true. */
  draggable?: boolean;
}

/**
 * Properties for markers placed with the marker tool (see `setMarkerTemplate`), e.g. a 3D model
 * to place: `{ name: 'Desk', kind: 'desk', model: 'kenney/furniture/desk' }`.
 */
export type MarkerTemplate = Partial<Pick<Marker, 'name' | 'kind' | 'color' | 'model' | 'rotation' | 'scale' | 'data'>>;

/**
 * Settings for new pipelines drawn with the pipe tool (see `setPipeSettings`). `elevation` is the
 * height (m above the level floor) of the next pipe point; changing it while drawing adds a riser.
 */
export interface PipeSettings {
  /** Default 2.6 (overhead, like the Gas kit pipe runs). */
  elevation: number;
  /** Outer diameter in meters. Default 0.05. */
  diameter: number;
  medium?: string;
  color?: string;
  /** Base name, numbered like "Gas supply 2". Default "Pipeline". */
  name?: string;
}

const DEFAULT_PIPE: PipeSettings = { elevation: 2.6, diameter: 0.05 };
/** Elevation step of the `[` / `]` and Page Up/Down keys in the pipe tool (Shift: 1 m). */
const PIPE_ELEVATION_STEP = 0.1;

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
  /** 3D models that markers can show; the editor draws their footprints. See `setAssets`. */
  assets?: readonly ModelAsset[];
  /** Settings for new pipelines (see `setPipeSettings`). */
  pipe?: Partial<PipeSettings>;
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
  /** The marker template changed (`setMarkerTemplate`, Q/E while placing, Escape). */
  templatechange: MarkerTemplate | null;
  /** The pipe settings changed (`setPipeSettings`, or the elevation keys in the pipe tool). */
  pipesettingschange: PipeSettings;
}

type EntityPatch =
  | Partial<Omit<Wall, 'id'>>
  | Partial<Omit<Room, 'id'>>
  | Partial<Omit<Marker, 'id'>>
  | Partial<Omit<Pipeline, 'id'>>;

type Drag =
  | { type: 'pan'; startX: number; startY: number; ox: number; oy: number }
  | {
      type: 'move';
      ref: EntityRef;
      start: Point;
      before: FloorPlan;
      original: Point[];
      moved: boolean;
      /** Fittings on a moved pipeline travel with it. */
      fittings?: { id: string; original: Point }[];
    }
  | { type: 'handle'; ref: EntityRef; index: number; before: FloorPlan; moved: boolean }
  /** A pipeline segment (`original[index]` to `original[index + 1]`) dragged sideways. */
  | { type: 'segment'; ref: EntityRef; index: number; start: Point; before: FloorPlan; original: PipePoint[]; moved: boolean }
  | { type: 'overlay'; id: string; start: Point; original: Point; moved: boolean };

type Draft = { kind: 'wall' | 'room'; points: Point[] } | { kind: 'pipe'; points: PipePoint[]; from?: string };

/** Snapped pointer position for drawing tools; `rotation` previews a fitting aligned to a pipe. */
type Cursor = { point: Point; snapped: boolean; rotation?: number; marker?: string; pipeline?: string };

/** A pipe tool point: snapped onto a marker (equipment) or a pipeline (a tee), or free. */
interface PipeTarget {
  point: Point;
  snapped: boolean;
  marker?: string;
  pipeline?: string;
  /** The pipeline's height at a tee. */
  z?: number;
}

/** Pointer hit tolerance in screen pixels. */
const HIT_PX = 6;
/** Snap-to-point tolerance in screen pixels. */
const SNAP_PX = 10;
/** Overlay point radius and hit tolerance in screen pixels. */
const OVERLAY_PX = 7;
/** Segments of the selected pipeline shorter than this on screen get no drag handle. */
const SEGMENT_HANDLE_MIN_PX = 36;
/** Rotation step (degrees) of the Q/E keys; Shift: 90°. */
const ROTATE_STEP = 15;
const MIN_SCALE = 4;
const MAX_SCALE = 1500;


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
  /** The vertex of the selected pipeline that was pressed last: Delete removes it. */
  private activeVertex: number | null = null;
  private grid: number;
  private snapEnabled: boolean;
  private wallThickness: number;
  /** Screen = world * scale + offset. */
  private view = { scale: 40, ox: 40, oy: 40 };
  private drag: Drag | null = null;
  private draft: Draft | null = null;
  private cursor: Cursor | null = null;
  private pipe: PipeSettings;
  private tools: EditorTool[];
  private readOnly: boolean;
  private overlayPoints: OverlayPoint[] = [];
  private overlaySelection: string | null = null;
  private assets = new Map<string, ModelAsset>();
  private markerTemplate: MarkerTemplate | null = null;
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
    this.assets = indexAssets(options.assets ?? []);
    this.pipe = sanitizePipeSettings({ ...DEFAULT_PIPE }, options.pipe ?? {});

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
      if (this.drag?.type === 'move' || this.drag?.type === 'handle' || this.drag?.type === 'segment') this.cancelDrag();
    }
    this.ensureAllowedTool();
    this.render();
  }

  /**
   * Set the 3D models that markers can show. Markers whose `model` matches an asset id are drawn
   * as the asset's footprint (scaled and rotated like the marker), with a tick on the front edge.
   */
  setAssets(assets: readonly ModelAsset[]): void {
    this.assets = indexAssets(assets);
    this.render();
  }

  getAssets(): ModelAsset[] {
    return [...this.assets.values()];
  }

  /**
   * Properties for the next markers placed with the marker tool (null: plain markers named
   * "Marker N"). With a `model`, the marker tool previews the footprint under the cursor and Q/E
   * rotate it. A template `name` is numbered like "Desk 3". Escape in the marker tool clears the
   * template and switches to select.
   */
  setMarkerTemplate(template: MarkerTemplate | null): void {
    this.markerTemplate = template ? structuredClone(template) : null;
    this.render();
    this.events.emit('templatechange', this.getMarkerTemplate());
  }

  getMarkerTemplate(): MarkerTemplate | null {
    return this.markerTemplate ? structuredClone(this.markerTemplate) : null;
  }

  /**
   * Settings for the next pipelines drawn with the pipe tool: elevation of the next point,
   * diameter, medium, color and base name. Merged into the current settings; pass `undefined` to
   * clear `medium`, `color` or `name`. Changing `elevation` while drawing adds a riser at the last
   * point.
   */
  setPipeSettings(patch: Partial<PipeSettings>): void {
    const before = this.pipe.elevation;
    this.pipe = sanitizePipeSettings({ ...this.pipe }, patch);
    if (this.pipe.elevation !== before) this.applyDraftElevation();
    this.render();
    this.events.emit('pipesettingschange', this.getPipeSettings());
  }

  getPipeSettings(): PipeSettings {
    return { ...this.pipe };
  }

  /**
   * Connect two markers on a level with a new pipeline, routed automatically (`routePipeline`:
   * orthogonal, few bends, beside walls) at the pipe settings' elevation, as one undoable step, and
   * select it. The pipe tool does the same when a pipeline started on one marker is ended on
   * another with the next click. Returns a copy of the pipeline, or null for unknown or identical
   * markers and in read-only mode.
   */
  connectMarkers(fromId: string, toId: string, levelId: string = this.levelId): Pipeline | null {
    const level = getLevel(this.plan, levelId);
    const from = level?.markers.find((m) => m.id === fromId);
    const to = level?.markers.find((m) => m.id === toId);
    if (!level || !from || !to || this.readOnly) return null;
    const points = this.route(level, from.position, to.position, this.pipe.elevation);
    if (!points) return null;
    if (levelId !== this.levelId) this.setActiveLevel(levelId);
    const pipe = this.commitPipe(points, fromId, toId);
    return pipe && structuredClone(pipe);
  }

  /**
   * Route an existing pipeline again between its two ends (`routePipeline`), e.g. after its
   * equipment moved, as one undoable step. The run takes the pipeline's greatest height; risers at
   * its ends, its links and its other properties stay. Returns false when there is nothing to route
   * (unknown pipeline, both ends at one position, read-only).
   */
  reroutePipeline(ref: EntityRef): boolean {
    const level = getLevel(this.plan, ref.levelId);
    const pipe = ref.kind === 'pipeline' ? level?.pipelines.find((p) => p.id === ref.id) : undefined;
    if (!level || !pipe || this.readOnly) return false;
    const z = Math.max(...pipe.points.map((p) => p.z));
    const head = pipelineEndRun(pipe, 'start').map((i) => ({ ...pipe.points[i]! }));
    const tail = pipelineEndRun(pipe, 'end').map((i) => ({ ...pipe.points[i]! })).reverse();
    const route = this.route(level, head[0]!, tail.at(-1)!, z, pipe.diameter);
    if (!route) return false;
    this.activeVertex = null;
    this.mutate(() => {
      pipe.points = dedupePoints([...head, ...route, ...tail]);
      this.alignFittings(level, pipe);
    });
    return true;
  }

  private route(level: Level, from: Point, to: Point, elevation: number, diameter = this.pipe.diameter): PipePoint[] | null {
    return routePipeline(level, from, to, { elevation, diameter, ...(this.grid > 0 ? { grid: this.grid } : {}) });
  }

  /**
   * Add a marker from a template at `position` on a level (e.g. a 3D model dropped from an asset
   * library), as one undoable step, and select it. A template `name` is numbered like the marker
   * tool's ("Desk 3"). Returns a copy of the new marker, or null for an unknown level or in
   * read-only mode.
   */
  addMarker(levelId: string, template: MarkerTemplate, position: Point): Marker | null {
    const level = getLevel(this.plan, levelId);
    if (!level || this.readOnly) return null;
    const marker = this.newMarker(level, template, { ...position });
    this.mutate(() => level.markers.push(marker));
    if (levelId !== this.levelId) this.setActiveLevel(levelId);
    this.select({ kind: 'marker', id: marker.id, levelId });
    return structuredClone(marker);
  }

  /**
   * Rotate the selected marker by `degrees` (clockwise in plan view), as one undoable change.
   * Returns false when no marker is selected or the editor is read-only.
   */
  rotateSelection(degrees: number): boolean {
    const sel = this.selection;
    const marker = sel?.kind === 'marker' && !this.readOnly ? (findEntity(this.plan, sel) as Marker | undefined) : undefined;
    if (!marker) return false;
    this.mutate(() => {
      marker.rotation = normalizeDegrees((marker.rotation ?? 0) + degrees);
    });
    return true;
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
    if (!same) this.activeVertex = null;
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

  /** Apply a single undoable change. Pipe ends and fittings follow what they are attached to. */
  private mutate(fn: () => void): void {
    this.history.push(clonePlan(this.plan));
    fn();
    for (const level of this.plan.levels) this.syncPipes(level);
    this.emitChange();
  }

  private syncPipes(level: Level): void {
    syncPipelineLinks(level, { fittingOffset: this.fittingOffset });
  }

  /** Fittings sit centered on the pipe: half the model height (none for mounted or unknown models). */
  private fittingOffset = (marker: Marker): number | null => {
    if (!marker.model) return 0;
    const asset = this.assets.get(marker.model);
    if (!asset || asset.mounted) return null;
    return (asset.size.height * (marker.scale ?? 1)) / 2;
  };

  private restore(plan: FloorPlan): void {
    this.plan = plan;
    this.draft = null;
    this.activeVertex = null;
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
    if (draft?.kind === 'pipe') this.commitPipe(draft.points, draft.from);
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
    if (drag?.type === 'move' || drag?.type === 'handle' || drag?.type === 'segment') this.plan = drag.before;
  }

  private commitRoom(points: Point[]): void {
    if (points.length < 3 || polygonArea(points) < 1e-6) return;
    const level = this.getActiveLevel();
    const room: Room = { id: createId('room'), name: `Room ${level.rooms.length + 1}`, points };
    this.mutate(() => level.rooms.push(room));
    this.select({ kind: 'room', id: room.id, levelId: level.id });
  }

  private commitPipe(draftPoints: PipePoint[], from?: string, to?: string): Pipeline | null {
    const points: PipePoint[] = [];
    for (const p of draftPoints) {
      const last = points.at(-1);
      if (!last || last.x !== p.x || last.y !== p.y || last.z !== p.z) points.push({ ...p });
    }
    if (points.length < 2) return null;
    const level = this.getActiveLevel();
    const { name, diameter, medium, color } = this.pipe;
    const base = name || 'Pipeline';
    const pipe: Pipeline = {
      id: createId('pipe'),
      name: `${base} ${level.pipelines.filter((p) => numberedAfter(p.name, base)).length + 1}`,
      points,
      diameter,
    };
    if (medium) pipe.medium = medium;
    if (color) pipe.color = color;
    if (from) pipe.from = from;
    if (to && to !== from) pipe.to = to;
    this.mutate(() => level.pipelines.push(pipe));
    this.select({ kind: 'pipeline', id: pipe.id, levelId: level.id });
    return pipe;
  }

  /**
   * Keep the pipe draft's last point at the current elevation: add a riser point there, move the
   * riser that is already there, or drop it when it is back at the height before it.
   */
  private applyDraftElevation(): void {
    if (this.draft?.kind !== 'pipe') return;
    const pts = this.draft.points;
    const z = this.pipe.elevation;
    const last = pts.at(-1);
    if (!last || last.z === z) return;
    const prev = pts.at(-2);
    if (prev && prev.x === last.x && prev.y === last.y) {
      if (prev.z === z) pts.pop();
      else last.z = z;
    } else {
      pts.push({ x: last.x, y: last.y, z });
    }
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

  /**
   * Pipe tool point. Snaps (unless Alt or snapping is off) to, in order: a marker (its center, also
   * when the pointer is over its footprint), a pipeline (a vertex or the closest point: a tee),
   * then the grid, kept orthogonal to the previous point (Shift: 45° steps) and slid onto a wall
   * face. `exclude` skips one pipeline (the one being reshaped).
   */
  private pipeTarget(raw: Point, event: { altKey: boolean; shiftKey: boolean }, last?: Point, exclude?: string): PipeTarget {
    if (!this.snapEnabled || event.altKey) return { point: raw, snapped: false };
    const level = this.getActiveLevel();
    const tol = SNAP_PX / this.view.scale;

    // Near the center only: in a furnished plan footprints cover much of the floor, and snapping
    // anywhere on them would attach (and finish) pipes on ordinary clicks. Big equipment gets a
    // bigger target: a quarter of its footprint's smaller side.
    for (const m of [...level.markers].reverse()) {
      const asset = m.model ? this.assets.get(m.model) : undefined;
      const reach = asset ? Math.max(tol, (Math.min(asset.size.width, asset.size.depth) * (m.scale ?? 1)) / 4) : tol;
      if (distance(raw, m.position) <= reach) return { point: { ...m.position }, snapped: true, marker: m.id };
    }
    const pipe = this.pipeAt(raw, exclude);
    if (pipe) {
      const vertex = pipe.pipeline.points.find((q) => distance(raw, q) <= tol);
      const at = vertex ?? pipe.point;
      return { point: { x: at.x, y: at.y }, snapped: true, pipeline: pipe.pipeline.id, z: at.z };
    }

    const constrain = (q: Point) => (!last ? q : event.shiftKey ? constrainAngle(last, q) : orthoPoint(last, q));
    // Wall faces are checked against the pointer itself: the grid could pull it out of reach.
    const face = snapToWallFace(constrain(raw), last, level.walls, this.pipe.diameter / 2, tol);
    if (face) {
      const p = face.point;
      // A first point along an axis-aligned wall still snaps to the grid along the wall.
      if (!last && this.grid > 0) {
        const g = snapToGrid(raw, this.grid);
        if (Math.abs(face.direction.x) > 0.999) p.x = g.x;
        else if (Math.abs(face.direction.y) > 0.999) p.y = g.y;
      }
      return { point: p, snapped: true };
    }
    return { point: constrain(snapToGrid(raw, this.grid)), snapped: false };
  }

  /** The closest pipeline on the active level within snapping reach of `p` (top one first). */
  private pipeAt(p: Point, exclude?: string): { pipeline: Pipeline; point: PipePoint; segment: number } | null {
    const tol = SNAP_PX / this.view.scale;
    let best: { pipeline: Pipeline; point: PipePoint; segment: number; distance: number } | null = null;
    for (const pipeline of this.getActiveLevel().pipelines) {
      if (pipeline.id === exclude) continue;
      const hit = nearestPointOnPipeline(pipeline, p);
      if (hit && hit.distance <= Math.max(tol, pipeline.diameter / 2) && (!best || hit.distance < best.distance)) {
        best = { pipeline, point: hit.point, segment: hit.segment, distance: hit.distance };
      }
    }
    return best;
  }

  /**
   * Where the marker tool (or a fitting being dragged) puts a marker: onto a pipeline within reach
   * (aligned with its segment, linked by `pipelineId`), else snapped as usual.
   */
  private markerPlacement(raw: Point, event: { altKey: boolean }, rotation = 0): { point: Point; snapped: boolean; pipelineId?: string; rotation?: number } {
    const pipe = this.snapEnabled && !event.altKey ? this.pipeAt(raw) : null;
    if (!pipe) return this.snap(raw, event);
    return {
      point: { x: pipe.point.x, y: pipe.point.y },
      snapped: true,
      pipelineId: pipe.pipeline.id,
      rotation: fittingRotation(pipe.pipeline, pipe.segment, rotation),
    };
  }

  /** The topmost draggable-or-not overlay point on the active level within reach of `p`. */
  private overlayHit(p: Point): OverlayPoint | null {
    const tol = (OVERLAY_PX + 3) / this.view.scale;
    for (const point of [...this.overlayPoints].reverse()) {
      if (point.levelId === this.levelId && distance(p, point.position) <= tol) return point;
    }
    return null;
  }

  private newMarker(level: Level, template: MarkerTemplate, position: Point): Marker {
    const { name, ...rest } = structuredClone(template);
    const base = name || 'Marker';
    return {
      id: createId('marker'),
      ...rest,
      name: name ? `${base} ${level.markers.filter((m) => numberedAfter(m.name, base)).length + 1}` : `Marker ${level.markers.length + 1}`,
      position,
    };
  }

  /** Plan outline of a marker that shows a known 3D model, else null. */
  private footprint(marker: Marker): Point[] | null {
    const asset = marker.model ? this.assets.get(marker.model) : undefined;
    return asset ? markerFootprint(marker, asset) : null;
  }

  private hitTest(p: Point): { ref: EntityRef; handle?: number; segment?: number } | null {
    const level = this.getActiveLevel();
    const tol = HIT_PX / this.view.scale;
    const ref = (kind: EntityRef['kind'], id: string): EntityRef => ({ kind, id, levelId: level.id });

    // Handles of the selected entity take priority (none in read-only mode).
    if (this.selection && this.selection.kind !== 'marker' && !this.readOnly) {
      const entity = findEntity(this.plan, this.selection);
      if (entity) {
        const index = entityPoints(this.selection.kind, entity).findIndex((q) => distance(p, q) <= tol * 1.5);
        if (index >= 0) return { ref: this.selection, handle: index };
        if (this.selection.kind === 'pipeline') {
          const grip = segmentHandles(entity as Pipeline, 1 / this.view.scale).find((h) => distance(p, h.point) <= tol * 1.5);
          if (grip) return { ref: this.selection, segment: grip.segment };
        }
      }
    }
    for (const m of [...level.markers].reverse()) {
      const footprint = this.footprint(m);
      const hit = footprint
        ? pointInPolygon(p, footprint) || footprint.some((q, i) => distanceToSegment(p, q, footprint[(i + 1) % 4]!) <= tol)
        : distance(p, m.position) <= 0.2 + tol;
      if (hit) return { ref: ref('marker', m.id) };
    }
    for (const pipe of pipelineDrawOrder(level).reverse()) {
      const reach = Math.max(pipe.diameter / 2, 2 / this.view.scale) + tol;
      if (pipe.points.some((q, i) => i > 0 && distanceToSegment(p, pipe.points[i - 1]!, q) <= reach)) return { ref: ref('pipeline', pipe.id) };
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
        if (event.altKey && hit.ref.kind === 'pipeline' && this.selection?.id === hit.ref.id) {
          this.editPipelineVertex(entity as Pipeline, raw, hit.handle);
          return;
        }
        this.activeVertex = hit.handle !== undefined && hit.ref.kind === 'pipeline' ? hit.handle : null;
        if (hit.handle !== undefined) {
          this.drag = { type: 'handle', ref: hit.ref, index: hit.handle, before: clonePlan(this.plan), moved: false };
          this.render();
        } else if (hit.segment !== undefined) {
          const original = (entity as Pipeline).points.map((q) => ({ ...q }));
          this.drag = { type: 'segment', ref: hit.ref, index: hit.segment, start: raw, before: clonePlan(this.plan), original, moved: false };
        } else {
          this.select(hit.ref);
          const level = this.getActiveLevel();
          this.drag = {
            type: 'move',
            ref: hit.ref,
            start: raw,
            before: clonePlan(this.plan),
            original: entityPoints(hit.ref.kind, entity).map((q) => ({ ...q })),
            moved: false,
            fittings:
              hit.ref.kind === 'pipeline'
                ? level.markers.filter((m) => m.pipelineId === hit.ref.id).map((m) => ({ id: m.id, original: { ...m.position } }))
                : undefined,
          };
        }
        return;
      }
      case 'pipe':
        this.pipeClick(raw, event);
        return;
      case 'wall':
        this.wallClick(this.drawPoint(raw, event).point);
        return;
      case 'room':
        this.roomClick(this.drawPoint(raw, event).point);
        return;
      case 'marker': {
        const level = this.getActiveLevel();
        const template = this.markerTemplate ?? {};
        const place = this.markerPlacement(raw, event, template.rotation ?? 0);
        const marker = this.newMarker(level, template, place.point);
        if (place.pipelineId) {
          marker.pipelineId = place.pipelineId;
          marker.rotation = place.rotation ?? 0;
        }
        this.mutate(() => level.markers.push(marker));
        return;
      }
    }
  };

  /**
   * Pipe tool click. The first click starts a pipeline (attached to a marker it lands on, or at a
   * pipeline's height for a tee). Later clicks add points at the current elevation; a click on a
   * marker or another pipeline adds the last point there and finishes (a riser is added if that
   * pipeline is at another height). Clicking the last point again finishes. A pipeline started on
   * a marker and ended on another marker with the very next click is routed automatically.
   */
  private pipeClick(raw: Point, event: PointerEvent): void {
    const draft = this.draft?.kind === 'pipe' ? this.draft : null;
    const last = draft?.points.at(-1);
    const t = this.pipeTarget(raw, event, last);
    if (!draft || !last) {
      if (t.z !== undefined && t.z !== this.pipe.elevation) this.setPipeSettings({ elevation: t.z });
      this.draft = { kind: 'pipe', points: [roundPoint({ ...t.point, z: this.pipe.elevation })], from: t.marker };
      this.render();
      return;
    }
    if (pointsEqual(last, t.point)) {
      this.finishDraft();
      return;
    }
    const z = this.pipe.elevation;
    const at = roundPoint(t.point);
    const direct = t.marker && draft.from && t.marker !== draft.from && draft.points.every((q) => q.x === last.x && q.y === last.y);
    const routed = direct ? this.route(this.getActiveLevel(), last, at, z) : null;
    if (routed) draft.points.push(...routed.slice(1, -1));
    draft.points.push({ ...at, z });
    if (t.z !== undefined && t.z !== z) draft.points.push({ ...at, z: t.z });
    if (t.marker || t.pipeline) {
      this.draft = null;
      this.commitPipe(draft.points, draft.from, t.marker);
    }
    this.render();
  }

  /**
   * Alt-click on the selected pipeline: on a vertex handle, remove that vertex (with its riser);
   * elsewhere on the pipeline, insert a vertex there.
   */
  private editPipelineVertex(pipe: Pipeline, p: Point, handle: number | undefined): void {
    if (handle !== undefined) {
      this.removePipelineVertex(pipe, handle);
      return;
    }
    const hit = nearestPointOnPipeline(pipe, p);
    if (!hit || hit.t <= 0 || hit.t >= 1) return;
    this.mutate(() => pipe.points.splice(hit.segment + 1, 0, roundPoint(hit.point)));
  }

  /**
   * Remove a vertex of a pipeline (with its riser) as one undoable step. False when that would
   * leave fewer than two points.
   */
  private removePipelineVertex(pipe: Pipeline, index: number): boolean {
    const anchor = pipe.points[index];
    if (!anchor) return false;
    const keep = dedupePoints(pipe.points.filter((q) => q.x !== anchor.x || q.y !== anchor.y));
    if (keep.length < 2) return false;
    this.activeVertex = null;
    this.mutate(() => {
      // Removing an end detaches it from its marker.
      if (pointsEqual(pipe.points[0]!, anchor)) delete pipe.from;
      if (pointsEqual(pipe.points.at(-1)!, anchor)) delete pipe.to;
      pipe.points = keep;
    });
    return true;
  }

  /**
   * Drag a segment of the selected pipeline sideways (perpendicular to itself, on the grid), with
   * the risers at its ends; the neighbouring segments stretch. An end attached to equipment stays
   * there: the pipe gets a new corner next to it instead.
   */
  private dragPipelineSegment(drag: Extract<Drag, { type: 'segment' }>, pipe: Pipeline, raw: Point, event: PointerEvent): void {
    const level = getLevel(this.plan, drag.ref.levelId);
    const a = drag.original[drag.index];
    const b = drag.original[drag.index + 1];
    if (!level || !a || !b) return;
    const length = distance(a, b);
    if (length < 1e-9) return;
    const normal = { x: -(b.y - a.y) / length, y: (b.x - a.x) / length };
    let d = (raw.x - drag.start.x) * normal.x + (raw.y - drag.start.y) * normal.y;
    if (this.snapEnabled && !event.altKey && this.grid > 0) {
      // An axis-aligned segment lands on a grid line; any other moves in grid steps.
      const axis = Math.abs(normal.x) > 0.999 ? 'x' : Math.abs(normal.y) > 0.999 ? 'y' : null;
      d = axis ? (snapToGrid({ x: a.x + normal.x * d, y: a.y + normal.y * d }, this.grid)[axis] - a[axis]) * normal[axis] : Math.round(d / this.grid) * this.grid;
    }
    const shift = <T extends Point>(q: T): T => roundPoint({ ...q, x: q.x + normal.x * d, y: q.y + normal.y * d });

    const runA = sameSpotRun(drag.original, drag.index);
    const runB = sameSpotRun(drag.original, drag.index + 1);
    const last = drag.original.length - 1;
    const holdA = runA.includes(0) && !!pipe.from;
    const holdB = runB.includes(last) && !!pipe.to;
    const points: PipePoint[] = [];
    drag.original.forEach((q, i) => {
      const inA = runA.includes(i);
      const inB = runB.includes(i);
      if (inB && holdB && i === drag.index + 1) points.push(shift(q)); // the new corner before a held end
      points.push((inA && !holdA) || (inB && !holdB) ? shift(q) : { ...q });
      if (inA && holdA && i === drag.index) points.push(shift(q)); // the new corner after a held start
    });
    pipe.points = dedupePoints(points);
    drag.moved = d !== 0;
    this.syncPipes(level);
    this.alignFittings(level, pipe);
  }

  /** Turn the fittings of a reshaped pipeline along the segments they are on now. */
  private alignFittings(level: Level, pipe: Pipeline): void {
    for (const m of level.markers) {
      if (m.pipelineId !== pipe.id) continue;
      const hit = nearestPointOnPipeline(pipe, m.position);
      if (hit) m.rotation = fittingRotation(pipe, hit.segment, m.rotation ?? 0);
    }
  }

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
    if (this.draft?.kind !== 'room') {
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
        this.afterMove(drag, entity, delta, event);
      }
    } else if (drag?.type === 'overlay') {
      const point = this.overlayPoints.find((p) => p.id === drag.id);
      if (point) {
        const target = { x: drag.original.x + raw.x - drag.start.x, y: drag.original.y + raw.y - drag.start.y };
        const next = this.snap(target, event).point;
        drag.moved ||= !pointsEqual(next, drag.original);
        point.position = next;
      }
    } else if (drag?.type === 'segment') {
      const entity = findEntity(this.plan, drag.ref);
      if (entity) this.dragPipelineSegment(drag, entity as Pipeline, raw, event);
    } else if (drag?.type === 'handle') {
      const entity = findEntity(this.plan, drag.ref);
      if (drag.ref.kind === 'pipeline' && entity) {
        this.dragPipelineVertex(drag, entity as Pipeline, raw, event);
      } else {
        const target = entity && entityPoints(drag.ref.kind, entity)[drag.index];
        if (target) {
          const { point } = this.snap(raw, event, target);
          drag.moved ||= !pointsEqual(point, target);
          target.x = point.x;
          target.y = point.y;
        }
      }
    }

    this.cursor = this.toolCursor(raw, event);
    this.render();
  };

  private toolCursor(raw: Point, event: PointerEvent): Cursor | null {
    switch (this.tool) {
      case 'wall':
      case 'room':
        return this.drawPoint(raw, event);
      case 'pipe':
        return this.pipeTarget(raw, event, this.draft?.kind === 'pipe' ? this.draft.points.at(-1) : undefined);
      case 'marker':
        return this.markerPlacement(raw, event, this.markerTemplate?.rotation ?? 0);
      default:
        return null;
    }
  }

  /**
   * Live follow-up of a move drag: a moved pipeline detaches from its markers and carries its
   * fittings; a fitting slides along its pipeline (Alt: detaches it); pipe ends follow markers.
   */
  private afterMove(drag: Extract<Drag, { type: 'move' }>, entity: Entity, delta: Point, event: PointerEvent): void {
    const level = getLevel(this.plan, drag.ref.levelId);
    if (!level) return;
    if (drag.ref.kind === 'pipeline' && drag.moved) {
      const pipe = entity as Pipeline;
      delete pipe.from;
      delete pipe.to;
      for (const f of drag.fittings ?? []) {
        const m = level.markers.find((q) => q.id === f.id);
        if (m) m.position = { x: f.original.x + delta.x, y: f.original.y + delta.y };
      }
    } else if (drag.ref.kind === 'marker') {
      const marker = entity as Marker;
      const pipe = marker.pipelineId ? level.pipelines.find((p) => p.id === marker.pipelineId) : undefined;
      if (pipe && event.altKey) delete marker.pipelineId;
      else if (pipe) {
        const was = nearestPointOnPipeline(pipe, drag.original[0]!);
        const now = nearestPointOnPipeline(pipe, marker.position);
        const before = drag.before.levels.find((l) => l.id === level.id)?.markers.find((m) => m.id === marker.id);
        if (was && now) marker.rotation = carryRotation(pipe, was.segment, now.segment, before?.rotation ?? 0);
      }
    }
    this.syncPipes(level);
  }

  /**
   * Drag a pipeline vertex with the pipe tool's snapping (no ortho). The vertex moves with any
   * riser at the same spot. An end attaches to a marker it is dropped on (and detaches otherwise),
   * and takes the height of a pipeline it meets (a tee).
   */
  private dragPipelineVertex(drag: Extract<Drag, { type: 'handle' }>, pipe: Pipeline, raw: Point, event: PointerEvent): void {
    const level = getLevel(this.plan, drag.ref.levelId);
    const anchor = pipe.points[drag.index];
    if (!level || !anchor) return;
    const start = pipelineEndRun(pipe, 'start');
    const end = pipelineEndRun(pipe, 'end');
    const run = start.includes(drag.index) ? start : end.includes(drag.index) ? end : sameSpotRun(pipe.points, drag.index);
    const t = this.pipeTarget(raw, event, undefined, pipe.id);
    const at = roundPoint(t.point);
    drag.moved ||= !pointsEqual(at, anchor);
    for (const i of run) {
      pipe.points[i]!.x = at.x;
      pipe.points[i]!.y = at.y;
    }
    const isStart = run === start;
    const isEnd = run === end;
    if (isStart || isEnd) {
      const key = isStart ? 'from' : 'to';
      if (t.marker) pipe[key] = t.marker;
      else delete pipe[key];
      if (t.z !== undefined && run.length === 1) pipe.points[drag.index]!.z = t.z;
    }
    this.syncPipes(level);
    this.alignFittings(level, pipe);
  }

  private onPointerUp = (event: PointerEvent): void => {
    if (this.svgEl.hasPointerCapture(event.pointerId)) this.svgEl.releasePointerCapture(event.pointerId);
    const drag = this.drag;
    this.drag = null;
    this.element.classList.remove('is-panning');
    if ((drag?.type === 'move' || drag?.type === 'handle' || drag?.type === 'segment') && drag.moved) {
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

    const toolKeys: Record<string, EditorTool> = { v: 'select', w: 'wall', r: 'room', m: 'marker', p: 'pipe', h: 'pan' };
    const elevationKey =
      event.code === 'BracketRight' || key === 'pageup' ? 1 : event.code === 'BracketLeft' || key === 'pagedown' ? -1 : 0;
    if (elevationKey && this.tool === 'pipe') {
      event.preventDefault();
      const step = (event.shiftKey ? 1 : PIPE_ELEVATION_STEP) * elevationKey;
      this.setPipeSettings({ elevation: this.pipe.elevation + step });
    } else if (key === 'escape') {
      if (this.draft) {
        this.draft = null;
        this.render();
      } else if (this.tool === 'marker' && this.markerTemplate) {
        this.setMarkerTemplate(null);
        this.setTool('select');
      } else {
        this.select(null);
        this.selectOverlayPoint(null);
      }
    } else if (key === 'enter') {
      this.finishDraft();
    } else if ((key === 'delete' || key === 'backspace') && !this.readOnly) {
      event.preventDefault();
      // A pressed pipeline vertex goes first; the pipeline itself when that was its last corner.
      const sel = this.selection;
      const pipe = sel?.kind === 'pipeline' && this.activeVertex !== null ? (findEntity(this.plan, sel) as Pipeline | undefined) : undefined;
      if (!pipe || !this.removePipelineVertex(pipe, this.activeVertex!)) this.deleteSelection();
    } else if (key === 'f') {
      this.fitView();
    } else if (key === 'q' || key === 'e') {
      const step = (event.shiftKey ? 90 : ROTATE_STEP) * (key === 'q' ? -1 : 1);
      if (this.tool === 'marker' && this.markerTemplate?.model) {
        this.setMarkerTemplate({ ...this.markerTemplate, rotation: normalizeDegrees((this.markerTemplate.rotation ?? 0) + step) });
      } else {
        this.rotateSelection(step);
      }
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

    // 3D model footprints lie on the floor: under walls and labels, so room names stay readable.
    for (const marker of level.markers) {
      const footprint = !marker.pipelineId && this.footprint(marker);
      if (footprint) this.renderFootprint(footprint, cls('vl-editor__asset', isSel('marker', marker.id)), marker.color);
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

    this.renderPipelines(level, px);

    // Fittings sit on their pipe, so they are drawn above it.
    for (const marker of level.markers) {
      const footprint = marker.pipelineId && this.footprint(marker);
      if (footprint) this.renderFootprint(footprint, cls('vl-editor__asset', isSel('marker', marker.id)), marker.color);
    }

    for (const marker of level.markers) {
      if (this.footprint(marker)) continue; // footprints are drawn above
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
        if (sel.kind === 'pipeline') {
          for (const { point, angle } of segmentHandles(entity as Pipeline, px)) {
            const half = 4 * px;
            svg('rect', {
              x: point.x - half * 1.75,
              y: point.y - half,
              width: half * 3.5,
              height: half * 2,
              rx: half / 2,
              transform: `rotate(${angle} ${point.x} ${point.y})`,
              class: 'vl-editor__handle vl-editor__handle--segment',
            }, w);
          }
        }
        for (const [i, p] of entityPoints(sel.kind, entity).entries()) {
          const active = sel.kind === 'pipeline' && this.activeVertex !== null && pointsEqual(p, (entity as Pipeline).points[this.activeVertex] ?? { x: NaN, y: NaN });
          svg('circle', { cx: p.x, cy: p.y, r: 5 * px, class: active ? 'vl-editor__handle is-active' : 'vl-editor__handle', 'data-index': i }, w);
        }
      }
    }

    this.renderOverlay(px);
    this.renderDraft(px);
  }

  /**
   * Pipelines, lowest first: a polyline as wide as the pipe (at least a few pixels) in its color,
   * a ring at each riser, a dot at each tee, and the heights of the selected pipeline's vertices.
   */
  private renderPipelines(level: Level, px: number): void {
    const w = this.world;
    const sel = this.selection;
    for (const pipe of pipelineDrawOrder(level)) {
      const width = Math.max(pipe.diameter, 3 * px);
      const points = pointsAttr(pipe.points);
      const selected = sel?.kind === 'pipeline' && sel.id === pipe.id;
      if (selected) svg('polyline', { points, 'stroke-width': width + 6 * px, class: 'vl-editor__pipe-selection' }, w);
      svg('polyline', { points, 'stroke-width': width, stroke: pipe.color, class: 'vl-editor__pipe' }, w);
      for (let i = 1; i < pipe.points.length; i++) {
        const a = pipe.points[i - 1]!;
        if (isRiser(a, pipe.points[i]!)) {
          svg('circle', { cx: a.x, cy: a.y, r: width / 2 + 2.5 * px, stroke: pipe.color, class: 'vl-editor__pipe-riser' }, w);
        }
      }
      if (selected) this.renderPipeHeights(pipe, px);
    }
    for (const j of pipelineJunctions(level)) {
      if (j.kind !== 'tee') continue;
      const pipe = level.pipelines.find((p) => p.id === j.otherId);
      const r = Math.max(pipe?.diameter ?? 0, 3 * px) / 2 + 2 * px;
      svg('circle', { cx: j.point.x, cy: j.point.y, r, fill: pipe?.color, class: 'vl-editor__pipe-tee' }, w);
    }
  }

  /** Height labels next to each vertex of a pipeline ("2.60 m", or "0.50 → 2.60 m" at a riser). */
  private renderPipeHeights(pipe: Pipeline, px: number): void {
    const spots: { at: PipePoint; zs: number[] }[] = [];
    for (const p of pipe.points) {
      const spot = spots.at(-1);
      if (spot && spot.at.x === p.x && spot.at.y === p.y) spot.zs.push(p.z);
      else spots.push({ at: p, zs: [p.z] });
    }
    for (const { at, zs } of spots) {
      svg('text', { x: at.x + 8 * px, y: at.y - 8 * px, 'font-size': 11 * px, class: 'vl-editor__pipe-z' }, this.world).textContent =
        `${zs.map((z) => z.toFixed(2)).join(' → ')} m`;
    }
  }

  /** A model footprint, with a tick marking its front edge (the model's +z side, plan +y at 0°). */
  private renderFootprint(points: Point[], className: string, fill?: string): void {
    const g = svg('g', { class: className }, this.world);
    svg('polygon', { points: pointsAttr(points), fill, class: 'vl-editor__asset-body' }, g);
    const [, , c, d] = points as [Point, Point, Point, Point];
    const mid = { x: (c.x + d.x) / 2, y: (c.y + d.y) / 2 };
    const center = { x: (points[0]!.x + c.x) / 2, y: (points[0]!.y + c.y) / 2 };
    const inward = { x: mid.x + (center.x - mid.x) * 0.25, y: mid.y + (center.y - mid.y) * 0.25 };
    svg('line', { ...lineAttrs(mid, inward), class: 'vl-editor__asset-front' }, g);
  }

  /** Host-managed overlay points on the active level, at a fixed screen size, above the plan. */
  private renderOverlay(px: number): void {
    for (const point of this.overlayPoints) {
      if (point.levelId !== this.levelId) continue;
      const { x, y } = point.position;
      const selected = point.id === this.overlaySelection;
      const g = svg('g', { class: cls('vl-editor__overlay-point', selected), 'data-overlay-id': point.id }, this.world);
      if (point.ring) svg('circle', { cx: x, cy: y, r: (OVERLAY_PX + 5) * px, stroke: point.ring, class: 'vl-editor__overlay-ring' }, g);
      const shape = pointShape(point.shape);
      const glyph = POINT_GLYPHS[shape];
      const r = OVERLAY_PX * px;
      const attrs = { fill: point.color, class: 'vl-editor__overlay-glyph', 'data-shape': shape };
      if (glyph) svg('polygon', { ...attrs, points: pointsAttr(glyph.map((p) => ({ x: x + p.x * r, y: y + p.y * r }))) }, g);
      else svg('circle', { ...attrs, cx: x, cy: y, r }, g);
      if (point.label) {
        svg('text', { x: x + (OVERLAY_PX + (point.ring ? 10 : 4)) * px, y, 'font-size': 11 * px, 'dominant-baseline': 'central', class: 'vl-editor__overlay-label' }, g).textContent = point.label;
      }
    }
  }

  private renderDraft(px: number): void {
    const w = this.world;
    const cursor = this.cursor?.point;
    const draft = this.draft;

    if (draft?.kind === 'pipe') {
      const pts: Point[] = cursor ? [...draft.points, cursor] : draft.points;
      const width = Math.max(this.pipe.diameter, 3 * px);
      svg('polyline', { points: pointsAttr(pts), 'stroke-width': width, stroke: this.pipe.color, class: 'vl-editor__pipe is-draft' }, w);
      for (const p of draft.points) svg('circle', { cx: p.x, cy: p.y, r: 4 * px, class: 'vl-editor__draft-point' }, w);
      const last = draft.points.at(-1);
      if (cursor && last) {
        const len = distance(last, cursor);
        svg('text', { x: cursor.x + 10 * px, y: cursor.y - 10 * px, 'font-size': 12 * px, class: 'vl-editor__measure' }, w).textContent =
          `${len > 0 ? `${len.toFixed(2)} m · ` : ''}z ${this.pipe.elevation.toFixed(2)} m`;
      }
    } else if (this.tool === 'pipe' && cursor) {
      svg('text', { x: cursor.x + 10 * px, y: cursor.y - 10 * px, 'font-size': 12 * px, class: 'vl-editor__measure' }, w).textContent =
        `z ${this.pipe.elevation.toFixed(2)} m`;
    } else if (draft) {
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

    const asset = this.tool === 'marker' && this.markerTemplate?.model ? this.assets.get(this.markerTemplate.model) : undefined;
    if (this.cursor && asset) {
      const ghost: Marker = { id: '', name: '', ...this.markerTemplate, position: this.cursor.point };
      if (this.cursor.rotation !== undefined) ghost.rotation = this.cursor.rotation;
      this.renderFootprint(markerFootprint(ghost, asset), 'vl-editor__asset is-ghost', ghost.color);
    }

    // A pipe click here connects: to equipment, or to another pipe (a tee).
    if (this.tool === 'pipe' && (this.cursor?.marker || this.cursor?.pipeline)) {
      svg('circle', { cx: this.cursor.point.x, cy: this.cursor.point.y, r: 11 * px, class: 'vl-editor__pipe-target' }, w);
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

/**
 * Rotation for a fitting on segment `segment` of a pipeline, closest to `current` (see
 * `alignRotation`). On a riser it follows the neighbouring segment.
 */
function fittingRotation(pipe: Pipeline, segment: number, current: number): number {
  return alignRotation(current, ...segmentEnds(pipe, segment));
}

/** A segment's plan direction as two points; a riser takes its neighbouring segment's. */
function segmentEnds(pipe: Pipeline, segment: number): [Point, Point] {
  const pts = pipe.points;
  const a = pts[segment]!;
  const b = pts[segment + 1] ?? a;
  if (!isRiser(a, b)) return [a, b];
  const prev = pts[segment - 1];
  const next = pts[segment + 2];
  return prev ? [prev, a] : next ? [b, next] : [a, b];
}

/**
 * Rotation for a fitting moved from segment `from` to segment `to` of a pipeline: it keeps
 * facing the same way along the pipe (forwards or backwards, plus any extra turn it had).
 */
function carryRotation(pipe: Pipeline, from: number, to: number, rotation: number): number {
  const [a0, b0] = segmentEnds(pipe, from);
  const aligned = alignRotation(rotation, a0, b0);
  const backwards = aligned !== segmentRotation(a0, b0);
  const [a1, b1] = segmentEnds(pipe, to);
  return normalizeDegrees(segmentRotation(a1, b1) + (backwards ? 180 : 0) + (rotation - aligned));
}

/**
 * Drag handles of a pipeline's segments: the middle of every plan segment (not risers) long enough
 * on screen, with the segment's angle in degrees. `px` is one screen pixel in meters.
 */
function segmentHandles(pipe: Pipeline, px: number): { segment: number; point: Point; angle: number }[] {
  const out: { segment: number; point: Point; angle: number }[] = [];
  for (let i = 0; i + 1 < pipe.points.length; i++) {
    const a = pipe.points[i]!;
    const b = pipe.points[i + 1]!;
    if (distance(a, b) < SEGMENT_HANDLE_MIN_PX * px) continue;
    out.push({ segment: i, point: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, angle: segmentRotation(a, b) });
  }
  return out;
}

/** Drop points that repeat the one before them (same position and height). */
function dedupePoints(points: PipePoint[]): PipePoint[] {
  return points.filter((p, i) => {
    const prev = points[i - 1];
    return !prev || prev.x !== p.x || prev.y !== p.y || prev.z !== p.z;
  });
}

/** Round to µm, so snapped and constrained points serialize cleanly. */
function roundPoint<T extends Point>(p: T): T {
  const r = (v: number) => Math.round(v * 1e6) / 1e6 + 0;
  return { ...p, x: r(p.x), y: r(p.y) };
}

/** Indices of the points around `index` at the same plan position (a vertex and its riser). */
function sameSpotRun(points: readonly Point[], index: number): number[] {
  const at = points[index]!;
  const same = (i: number) => points[i] !== undefined && points[i]!.x === at.x && points[i]!.y === at.y;
  let lo = index;
  let hi = index;
  while (same(lo - 1)) lo--;
  while (same(hi + 1)) hi++;
  return Array.from({ length: hi - lo + 1 }, (_, k) => lo + k);
}

/** Pipelines in drawing order: lower ones first, so the highest pipe is on top in plan view. */
function pipelineDrawOrder(level: Level): Pipeline[] {
  const top = (p: Pipeline) => Math.max(...p.points.map((q) => q.z));
  return [...level.pipelines].sort((a, b) => top(a) - top(b));
}

function sanitizePipeSettings(current: PipeSettings, patch: Partial<PipeSettings>): PipeSettings {
  const next = { ...current };
  if (typeof patch.elevation === 'number' && Number.isFinite(patch.elevation)) {
    next.elevation = Math.max(0, Math.round(patch.elevation * 1000) / 1000);
  }
  if (typeof patch.diameter === 'number' && patch.diameter > 0) next.diameter = patch.diameter;
  for (const key of ['medium', 'color', 'name'] as const) {
    if (!(key in patch)) continue;
    const value = patch[key];
    if (value) next[key] = value;
    else delete next[key];
  }
  return next;
}

function cls(base: string, selected: boolean): string {
  return selected ? `${base} is-selected` : base;
}

/** True for names like "Desk 3" when `base` is "Desk". */
function numberedAfter(name: string, base: string): boolean {
  return name.startsWith(`${base} `) && /^\d+$/.test(name.slice(base.length + 1));
}

function normalizeDegrees(degrees: number): number {
  const d = degrees % 360;
  return d < 0 ? d + 360 : d;
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
