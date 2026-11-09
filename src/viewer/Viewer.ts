import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DObject, CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { Emitter } from '../core/emitter';
import { centerDuration, easeOutCubic, reducedMotionQuery, type CenterOnOptions, type CenterOnTarget } from '../core/motion';
import { indexAssets, type ModelAsset } from '../model/assets';
import { clonePlan } from '../model/plan';
import type { FloorPlan, Level, Point, Underlay } from '../model/types';
import { toThreeColor } from './color';
import { buildHighlight, resolveFocus, type FocusOptions, type FocusTarget } from './focus';
import { buildHeatmapMesh, fillHeatmap, heatmapGrid, heatmapPointsOn, type HeatmapGrid } from './heatmap';
import type { DataLayer, HeatmapLayer, PointLayer, RoomLayer } from './layers';
import { ModelCache, type ModelStyle } from './models';
import { PointLayerView } from './pointLayer';
import {
  buildPlan,
  DEFAULT_SCENE_COLORS,
  disposeObject,
  type BuiltLevel,
  type ModelSlot,
  type PickInfo,
  type SceneColors,
} from './sceneBuilder';

export type ViewMode = '2d' | '3d';
/** A level id, or `'all'` to show every level stacked (3D only). */
export type LevelSelection = string | 'all';

export interface ViewerOptions {
  plan?: FloorPlan;
  mode?: ViewMode;
  level?: LevelSelection;
  background?: string;
  showLabels?: boolean;
  colors?: Partial<SceneColors>;
  /** 3D models that markers can show (`marker.model`). See `setAssets`. */
  assets?: readonly ModelAsset[];
  /** Show markers' 3D models (default true). See `setShowModels`. */
  showModels?: boolean;
  /** Let the user drag markers (and their 3D models) across the floor. See `setMovableMarkers`. */
  movableMarkers?: boolean;
  /** Grid (m) that dragged markers snap to; 0 turns snapping off. Alt bypasses it. Default 0.25. */
  moveGrid?: number;
}

/** `markermove`: a marker was dragged in the viewer and dropped at `position` (plan meters, snapped). */
export interface MarkerMoveEvent {
  id: string;
  levelId: string;
  position: Point;
}

/**
 * A translucent box shown on a level, e.g. where a dragged asset would land (`setGhost`). Sizes in
 * meters (`width` along plan x, `depth` along plan y); `rotation` in degrees clockwise.
 */
export interface Ghost {
  levelId: string;
  position: Point;
  size: { width: number; depth: number; height: number };
  rotation?: number;
  color?: string;
}

export interface PickEvent {
  /** The entity or data point under the pointer, or null for empty space. */
  target: PickInfo | null;
  /** Pointer position projected onto the plan (meters), or null if it missed the floor. */
  point: Point | null;
  originalEvent: PointerEvent;
}

export interface ViewerEvents {
  click: PickEvent;
  /** A marker was dragged and dropped (only with `movableMarkers`). Update the plan, e.g. `editor.updateEntity`. */
  markermove: MarkerMoveEvent;
  /** Fired when the hovered target changes (including to null). */
  hover: PickEvent;
  modechange: ViewMode;
  levelchange: LevelSelection;
}

interface HeatmapLevel {
  group: THREE.Group;
  mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  grid: HeatmapGrid;
  /** Settings the grid depends on; a change rebuilds it. */
  key: string;
}

/** Max pointer travel (px) between down and up that still counts as a click. */
const CLICK_TOLERANCE = 4;
const HOVER_EMISSIVE = new THREE.Color('#2a3550');

/**
 * Interactive 2D/3D floor plan viewer backed by Three.js.
 *
 * ```ts
 * const viewer = new FloorplanViewer(document.getElementById('app')!, { plan, mode: '3d' });
 * viewer.on('click', (e) => console.log(e.target));
 * ```
 */
export class FloorplanViewer {
  readonly element: HTMLDivElement;

  private readonly events = new Emitter<ViewerEvents>();
  private readonly renderer: THREE.WebGLRenderer;
  private readonly labelRenderer: CSS2DRenderer;
  private readonly tooltip: HTMLDivElement;
  private readonly scene = new THREE.Scene();
  private readonly planGroup = new THREE.Group();
  private readonly perspective = new THREE.PerspectiveCamera(45, 1, 0.1, 5000);
  private readonly ortho = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 5000);
  private readonly raycaster = new THREE.Raycaster();
  private readonly resizeObserver: ResizeObserver;
  private readonly colors: SceneColors;
  private readonly reducedMotion = reducedMotionQuery();
  private readonly models = new ModelCache();
  private assets = new Map<string, ModelAsset>();
  private showModels: boolean;
  private movableMarkers: boolean;
  private moveGrid: number;
  private markerDrag: {
    id: string;
    levelId: string;
    object: THREE.Object3D;
    elevation: number;
    offset: { x: number; z: number };
    original: { x: number; z: number };
    moved: boolean;
    pointerId: number;
  } | null = null;
  private ghost: { spec: Ghost; mesh: THREE.Mesh } | null = null;

  private controls: OrbitControls;
  private plan: FloorPlan | null = null;
  private built: BuiltLevel[] = [];
  private layers: DataLayer[] = [];
  private pointViews = new Map<string, PointLayerView>();
  /** Heatmap layer id → level id → its mesh, cached grid (room mask) and pixel buffer. */
  private heatmaps = new Map<string, Map<string, HeatmapLevel>>();
  private focusState: { target: FocusTarget; color: string; mesh: THREE.Mesh | null; timer: ReturnType<typeof setTimeout> | null } | null = null;
  private underlay: { spec: Underlay; levelId?: string; mesh: THREE.Mesh } | null = null;
  private mode: ViewMode;
  private level: LevelSelection;
  private showLabels: boolean;
  private hovered: PickInfo | null = null;
  private hoveredMesh: THREE.Mesh | null = null;
  private downAt: { x: number; y: number } | null = null;
  private frame = 0;
  /** A running `centerOn` animation of the orbit target. */
  private pan: { from: THREE.Vector3; to: THREE.Vector3; duration: number; start: number | null } | null = null;
  private dirty = true;
  private disposed = false;

  constructor(container: HTMLElement, options: ViewerOptions = {}) {
    this.mode = options.mode ?? '3d';
    this.level = options.level ?? 'all';
    this.showLabels = options.showLabels ?? true;
    this.colors = { ...DEFAULT_SCENE_COLORS, ...options.colors };
    this.assets = indexAssets(options.assets ?? []);
    this.showModels = options.showModels ?? true;
    this.movableMarkers = options.movableMarkers ?? false;
    this.moveGrid = options.moveGrid ?? 0.25;

    this.element = document.createElement('div');
    this.element.className = 'vl-viewer';
    container.appendChild(this.element);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.element.appendChild(this.renderer.domElement);

    this.labelRenderer = new CSS2DRenderer();
    this.labelRenderer.domElement.className = 'vl-viewer__labels';
    this.element.appendChild(this.labelRenderer.domElement);

    this.tooltip = document.createElement('div');
    this.tooltip.className = 'vl-viewer__tooltip';
    this.tooltip.hidden = true;
    this.element.appendChild(this.tooltip);

    this.scene.background = toThreeColor(options.background ?? '#f8fafc');
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x94a3b8, 2.2));
    const sun = new THREE.DirectionalLight(0xffffff, 1.4);
    sun.position.set(20, 40, 25);
    this.scene.add(sun);
    this.scene.add(this.planGroup);

    this.controls = this.createControls();

    const canvas = this.renderer.domElement;
    // Capture phase: runs before OrbitControls, so a marker drag can keep the camera still.
    canvas.addEventListener('pointerdown', this.onPointerDown, { capture: true });
    canvas.addEventListener('pointerup', this.onPointerUp);
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerleave', this.onPointerLeave);

    this.reducedMotion?.addEventListener('change', this.onReducedMotionChange);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.element);
    this.resize();

    if (options.plan) this.setPlan(options.plan, { fit: true });
    this.frame = requestAnimationFrame(this.loop);
  }

  // ---------------------------------------------------------------- public API

  on<K extends keyof ViewerEvents>(type: K, handler: (payload: ViewerEvents[K]) => void): () => void {
    return this.events.on(type, handler);
  }

  off<K extends keyof ViewerEvents>(type: K, handler: (payload: ViewerEvents[K]) => void): void {
    this.events.off(type, handler);
  }

  /** Returns a copy of the displayed plan. */
  getPlan(): FloorPlan | null {
    return this.plan ? clonePlan(this.plan) : null;
  }

  /**
   * Replace the displayed plan. The camera is kept unless `fit` is true
   * (default: fit only when no plan was shown before).
   */
  setPlan(plan: FloorPlan, { fit }: { fit?: boolean } = {}): void {
    const first = this.plan === null;
    this.clearPlan();
    this.plan = clonePlan(plan);
    if (this.level !== 'all' && !this.plan.levels.some((l) => l.id === this.level)) {
      this.level = this.plan.levels[0]?.id ?? 'all';
    }
    this.built = buildPlan(this.plan, this.colors, this.assets);
    for (const b of this.built) {
      this.planGroup.add(b.group);
      for (const anchor of b.labelAnchors) {
        const el = document.createElement('div');
        el.className = 'vl-viewer__label';
        el.textContent = anchor.text;
        const label = new CSS2DObject(el);
        label.position.copy(anchor.position);
        label.name = 'label';
        label.visible = this.showLabels;
        b.group.add(label);
      }
    }
    for (const layer of this.layers) this.applyLayer(layer);
    this.attachUnderlay();
    this.attachGhost();
    this.applyRoomColors();
    this.applyLevelVisibility();
    this.updateHighlight();
    this.applyModelVisibility();
    this.loadModels();
    if (fit ?? first) this.fitView();
    this.requestRender();
  }

  /**
   * Set the 3D models that markers can show: a marker whose `model` matches an asset id is drawn
   * as that model (a box of the asset's size until it loads), others keep the default glyph.
   * Models load once per URL and are shared by every marker using them. Rebuilds the plan.
   */
  setAssets(assets: readonly ModelAsset[]): void {
    this.assets = indexAssets(assets);
    if (this.plan) this.setPlan(this.plan, { fit: false });
  }

  getAssets(): ModelAsset[] {
    return [...this.assets.values()];
  }

  /**
   * Let the user drag markers and their 3D models across the floor (snapped to `moveGrid`; Alt
   * bypasses it). The viewer moves the marker live and emits `markermove` on drop; it does not
   * change its own plan, so update the source of truth (e.g. `editor.updateEntity`) and call
   * `setPlan`. A drop without movement is a normal `click`.
   */
  setMovableMarkers(movable: boolean): void {
    this.movableMarkers = movable;
  }

  /**
   * The level and plan position under client (viewport) coordinates, e.g. for a `drop` event:
   * the room floor under the pointer, else the floor plane of the lowest shown level. Null when
   * the pointer is outside the viewer or misses the floor.
   */
  clientToPlan(clientX: number, clientY: number): { levelId: string; position: Point } | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) return null;
    this.setRay(clientX, clientY);
    const rooms: THREE.Object3D[] = [];
    for (const b of this.built) if (b.group.visible) rooms.push(...b.rooms.values());
    const hit = this.raycaster.intersectObjects(rooms, false)[0];
    if (hit) {
      const pick = hit.object.userData.pick as PickInfo;
      return { levelId: pick.levelId, position: { x: hit.point.x, y: hit.point.z } };
    }
    const lowest = this.built.filter((b) => b.group.visible).sort((a, b) => a.group.position.y - b.group.position.y)[0];
    if (!lowest) return null;
    const p = this.floorPoint(lowest.group.position.y);
    return p ? { levelId: lowest.levelId, position: { x: p.x, y: p.z } } : null;
  }

  /** Show a translucent placement box (e.g. while an asset is dragged over the viewer), or remove it with null. */
  setGhost(ghost: Ghost | null): void {
    if (this.ghost) {
      this.ghost.mesh.removeFromParent();
      disposeObject(this.ghost.mesh);
      this.ghost = null;
    }
    if (ghost) {
      const { width, depth, height } = ghost.size;
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(Math.max(width, 0.05), Math.max(height, 0.05), Math.max(depth, 0.05)),
        new THREE.MeshBasicMaterial({ color: toThreeColor(ghost.color ?? this.colors.marker), transparent: true, opacity: 0.35, depthWrite: false }),
      );
      mesh.position.set(ghost.position.x, Math.max(height, 0.05) / 2, ghost.position.y);
      mesh.rotation.y = -THREE.MathUtils.degToRad(ghost.rotation ?? 0);
      mesh.raycast = () => undefined;
      this.ghost = { spec: structuredClone(ghost), mesh };
      this.attachGhost();
    }
    this.requestRender();
  }

  getShowModels(): boolean {
    return this.showModels;
  }

  /**
   * Show or hide markers' 3D models (e.g. to see the bare plan). Hidden models can't be picked.
   * Markers without a model keep their glyph.
   */
  setShowModels(show: boolean): void {
    if (show === this.showModels) return;
    this.showModels = show;
    this.applyModelVisibility();
    if (!show && this.hovered?.kind === 'marker') {
      this.hovered = null;
      this.setHover(null);
      this.tooltip.hidden = true;
    }
    this.requestRender();
  }

  getMode(): ViewMode {
    return this.mode;
  }

  setMode(mode: ViewMode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    this.controls.dispose();
    this.controls = this.createControls();
    for (const view of this.pointViews.values()) view.setMode(mode);
    this.applyLevelVisibility();
    this.fitView();
    this.events.emit('modechange', mode);
  }

  getLevel(): LevelSelection {
    return this.level;
  }

  setLevel(level: LevelSelection): void {
    if (level === this.level) return;
    this.level = level;
    this.applyLevelVisibility();
    this.requestRender();
    this.events.emit('levelchange', level);
  }

  /**
   * Show a reference image (e.g. a scanned drawing) on the floor of a level (default: the first
   * level), under the rooms. Pass null to remove it.
   */
  setUnderlay(underlay: Underlay | null, levelId?: string): void {
    this.removeUnderlay();
    if (!underlay) {
      this.requestRender();
      return;
    }
    const texture = new THREE.TextureLoader().load(underlay.url, () => this.requestRender());
    texture.colorSpace = THREE.SRGBColorSpace;
    const geometry = new THREE.PlaneGeometry(underlay.width, underlay.height);
    // Same mapping as room floors: plane y -> world z. Flip V so the image's top row sits at the smallest plan y.
    geometry.rotateX(Math.PI / 2);
    texture.flipY = false;
    const material = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      opacity: underlay.opacity ?? 0.5,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(underlay.x + underlay.width / 2, 0.01, underlay.y + underlay.height / 2);
    mesh.raycast = () => undefined;
    mesh.renderOrder = -1;
    this.underlay = { spec: { ...underlay }, levelId, mesh };
    this.attachUnderlay();
    this.requestRender();
  }

  /** Change the scene background (any CSS color), e.g. when the host app switches theme. */
  setBackground(color: string): void {
    toThreeColor(color, this.scene.background as THREE.Color);
    this.requestRender();
  }

  /**
   * Show or hide the plan's labels, which are the room names (the only text the plan itself
   * puts on screen). Point layer labels are separate: `updateLayer(id, { showLabels })`.
   */
  setShowLabels(show: boolean): void {
    this.showLabels = show;
    for (const b of this.built) b.group.children.forEach((c) => c.name === 'label' && (c.visible = show));
    this.requestRender();
  }

  getLayers(): readonly DataLayer[] {
    return this.layers;
  }

  /**
   * Add a data layer, or replace the layer with the same id. Replacing a points or heatmap layer
   * with one of the same type updates its scene objects in place (points matched by id, the
   * heatmap texture refilled), so calling this every few seconds with fresh values is cheap.
   */
  setLayer(layer: DataLayer): void {
    const index = this.layers.findIndex((l) => l.id === layer.id);
    const previous = index >= 0 ? this.layers[index] : undefined;
    if (previous?.type !== layer.type) this.removeLayerObjects(layer.id);
    if (index >= 0) this.layers[index] = layer;
    else this.layers.push(layer);
    this.applyLayer(layer);
    if (layer.type === 'points' && layer.visible === false && this.hovered?.layerId === layer.id) {
      // The hovered point was just hidden: drop the hover state and its tooltip.
      this.hovered = null;
      this.setHover(null);
      this.tooltip.hidden = true;
    }
    if (layer.type === 'rooms' || previous?.type === 'rooms') this.applyRoomColors();
    if (this.focusState?.target.kind === 'point' && this.focusState.target.layerId === layer.id) this.updateHighlight();
    this.refreshTooltip();
    this.requestRender();
  }

  /**
   * Merge `patch` into an existing layer and apply it like `setLayer` (in place for points and
   * heatmaps), e.g. `updateLayer('sensors', { points })` or `updateLayer('sensors', { showLabels: false })`.
   * Returns false when there is no layer with that id.
   */
  updateLayer<T extends DataLayer>(id: string, patch: Partial<Omit<T, 'id' | 'type'>>): boolean {
    const layer = this.layers.find((l) => l.id === id);
    if (!layer) return false;
    this.setLayer({ ...layer, ...patch } as DataLayer);
    return true;
  }

  removeLayer(id: string): void {
    this.removeLayerObjects(id);
    this.layers = this.layers.filter((l) => l.id !== id);
    this.applyRoomColors();
    this.refreshTooltip();
    this.requestRender();
  }

  /**
   * Center the camera on a data point, plan entity or position (keeping the current zoom),
   * switching to its level when it isn't visible, and highlight it with a ring (points, markers,
   * positions) or an outline (rooms, walls). The highlight stays until `clearHighlight()`, the
   * next `focus()` or its `duration`; it follows a focused point when its layer updates.
   * Returns false when the target doesn't exist.
   */
  focus(target: FocusTarget, options: FocusOptions = {}): boolean {
    if (!this.plan) return false;
    const resolved = resolveFocus(this.plan, target, this.lookupPoint);
    if (!resolved) return false;
    if (!this.visibleLevelIds().has(resolved.levelId)) this.setLevel(resolved.levelId);

    const elevation = this.levelById(resolved.levelId)?.elevation ?? 0;
    this.pan = null;
    this.moveTarget(new THREE.Vector3(resolved.center.x, elevation + resolved.height, resolved.center.y));

    this.clearHighlight();
    const highlight = options.highlight ?? true;
    if (highlight) {
      const spec = typeof highlight === 'object' ? highlight : {};
      this.focusState = { target, color: spec.color ?? this.colors.highlight, mesh: null, timer: null };
      if (spec.duration) this.focusState.timer = setTimeout(() => this.clearHighlight(), spec.duration);
      this.updateHighlight();
    }
    this.requestRender();
    return true;
  }

  /**
   * Pan so a plan position is in the middle of the view, keeping the zoom and, in 3D, the camera's
   * distance and angle (the orbit target moves to the position on the level's floor). Switches to
   * `target.levelId` if it isn't shown. Eases there (default 300 ms, ease-out) unless
   * `animate: false` or the user prefers reduced motion; user camera input cancels it.
   * Returns false for an unknown level.
   */
  centerOn(target: CenterOnTarget, options: CenterOnOptions = {}): boolean {
    const level = this.levelById(target.levelId);
    if (!level) return false;
    if (!this.visibleLevelIds().has(level.id)) this.setLevel(level.id);
    const to = new THREE.Vector3(target.position.x, level.elevation, target.position.y);
    const duration = centerDuration(options);
    this.pan = duration > 0 ? { from: this.controls.target.clone(), to, duration, start: null } : null;
    if (!this.pan) this.moveTarget(to);
    this.requestRender();
    return true;
  }

  /** Remove the `focus()` highlight. */
  clearHighlight(): void {
    if (!this.focusState) return;
    if (this.focusState.timer) clearTimeout(this.focusState.timer);
    if (this.focusState.mesh) {
      this.focusState.mesh.removeFromParent();
      disposeObject(this.focusState.mesh);
    }
    this.focusState = null;
    this.requestRender();
  }

  /** Frame the visible part of the plan. */
  fitView(): void {
    this.pan = null;
    const box = new THREE.Box3();
    for (const b of this.built) if (b.group.visible) box.expandByObject(b.group);
    if (box.isEmpty()) box.set(new THREE.Vector3(-5, 0, -5), new THREE.Vector3(5, 3, 5));
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());

    if (this.mode === '3d') {
      const radius = Math.max(box.getBoundingSphere(new THREE.Sphere()).radius, 1);
      const distance = (radius / Math.sin(THREE.MathUtils.degToRad(this.perspective.fov / 2))) * 1.05;
      const direction = new THREE.Vector3(0.55, 1, 0.9).normalize();
      this.perspective.position.copy(center).addScaledVector(direction, distance);
      this.perspective.near = Math.max(distance / 1000, 0.05);
      this.perspective.far = distance * 20;
      this.perspective.updateProjectionMatrix();
    } else {
      const aspect = this.aspect();
      let halfW = (size.x / 2) * 1.1 + 0.5;
      let halfH = (size.z / 2) * 1.1 + 0.5;
      if (halfW / halfH < aspect) halfW = halfH * aspect;
      else halfH = halfW / aspect;
      Object.assign(this.ortho, { left: -halfW, right: halfW, top: halfH, bottom: -halfH, zoom: 1 });
      // A tiny +z offset keeps the camera "up" well defined: screen-up becomes world -z (plan -y).
      this.ortho.position.set(center.x, box.max.y + 100, center.z + 1e-3);
      this.ortho.updateProjectionMatrix();
    }
    this.controls.target.copy(center);
    this.controls.update();
    this.requestRender();
  }

  /** PNG data URL of the current view. */
  screenshot(): string {
    this.render();
    return this.renderer.domElement.toDataURL('image/png');
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    this.reducedMotion?.removeEventListener('change', this.onReducedMotionChange);
    this.resizeObserver.disconnect();
    this.controls.dispose();
    this.clearHighlight();
    this.setGhost(null);
    this.removeUnderlay();
    this.clearPlan();
    this.models.dispose();
    this.renderer.dispose();
    this.events.clear();
    this.element.remove();
  }

  // ---------------------------------------------------------------- internals

  private get camera(): THREE.Camera {
    return this.mode === '3d' ? this.perspective : this.ortho;
  }

  private createControls(): OrbitControls {
    const controls = new OrbitControls(this.mode === '3d' ? this.perspective : this.ortho, this.renderer.domElement);
    controls.enableRotate = this.mode === '3d';
    controls.maxPolarAngle = Math.PI / 2 - 0.05;
    controls.screenSpacePanning = true;
    controls.addEventListener('change', () => this.requestRender());
    // The user grabbed the camera: stop a running centerOn.
    controls.addEventListener('start', () => (this.pan = null));
    return controls;
  }

  private aspect(): number {
    const { clientWidth: w, clientHeight: h } = this.element;
    return w > 0 && h > 0 ? w / h : 1;
  }

  private resize(): void {
    const { clientWidth: w, clientHeight: h } = this.element;
    if (w === 0 || h === 0) return;
    this.renderer.setSize(w, h);
    this.labelRenderer.setSize(w, h);
    const aspect = w / h;
    this.perspective.aspect = aspect;
    this.perspective.updateProjectionMatrix();
    const halfH = (this.ortho.top - this.ortho.bottom) / 2;
    this.ortho.left = -halfH * aspect;
    this.ortho.right = halfH * aspect;
    this.ortho.updateProjectionMatrix();
    this.requestRender();
  }

  private requestRender(): void {
    this.dirty = true;
  }

  private loop = (time: number): void => {
    this.frame = requestAnimationFrame(this.loop);
    if (this.pan) this.stepPan(time);
    if (this.animateBeams(time)) this.dirty = true;
    if (this.dirty) this.render();
  };

  private stepPan(time: number): void {
    const pan = this.pan!;
    pan.start ??= time;
    const t = Math.min((time - pan.start) / pan.duration, 1);
    this.moveTarget(pan.from.clone().lerp(pan.to, easeOutCubic(t)));
    if (t >= 1) this.pan = null;
  }

  /** Move the orbit target to `center`, shifting the camera by the same amount (same zoom, distance and angle). */
  private moveTarget(center: THREE.Vector3): void {
    this.camera.position.add(center.clone().sub(this.controls.target));
    this.controls.target.copy(center);
    this.controls.update();
    this.requestRender();
  }

  /**
   * Advance the beam pulses. True while a beam is visible and motion is allowed: only then does
   * the viewer render every frame; otherwise it stays on demand.
   */
  private animateBeams(time: number): boolean {
    if (this.reducedMotion?.matches || this.pointViews.size === 0) return false;
    let animating = false;
    let visible: Set<string> | null = null;
    for (const view of this.pointViews.values()) {
      visible ??= this.shownLevelIds();
      if (!view.hasBeams(visible)) continue;
      view.updateBeams(time);
      animating = true;
    }
    return animating;
  }

  private onReducedMotionChange = (): void => {
    if (this.reducedMotion?.matches) for (const view of this.pointViews.values()) view.updateBeams(null);
    this.requestRender();
  };

  private render(): void {
    this.dirty = false;
    this.renderer.render(this.scene, this.camera);
    this.labelRenderer.render(this.scene, this.camera);
  }

  /** Swap each model slot's placeholder for the loaded model (if the slot is still in the scene). */
  private loadModels(): void {
    for (const b of this.built) {
      for (const slot of b.models) {
        this.models.load(slot.asset.url, { mounted: slot.asset.mounted }).then(
          (template) => this.fillSlot(b, slot, template),
          () => undefined, // logged by the cache; the placeholder stays
        );
      }
    }
  }

  private fillSlot(built: BuiltLevel, slot: ModelSlot, template: THREE.Object3D): void {
    if (this.disposed || !this.built.includes(built) || !slot.placeholder) return;
    const instance = this.models.instantiate(template, { kind: 'marker', id: slot.markerId, levelId: built.levelId }, this.modelStyle(slot));
    instance.scale.setScalar(slot.scale);
    if (this.hoveredMesh === slot.placeholder) this.setHover(null);
    slot.placeholder.removeFromParent();
    disposeObject(slot.placeholder);
    slot.placeholder = null;
    slot.slot.add(instance);
    this.requestRender();
  }

  private modelStyle(slot: ModelSlot): ModelStyle {
    return { clay: toThreeColor(this.colors.model), accent: slot.color ? toThreeColor(slot.color) : null };
  }

  private applyModelVisibility(): void {
    for (const b of this.built) for (const slot of b.models) slot.slot.visible = this.showModels;
  }

  private attachGhost(): void {
    if (!this.ghost) return;
    this.built.find((b) => b.levelId === this.ghost?.spec.levelId)?.group.add(this.ghost.mesh);
  }

  private setRay(clientX: number, clientY: number): void {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
  }

  /** Where the current ray meets the horizontal plane at world height `y`. */
  private floorPoint(y: number): THREE.Vector3 | null {
    return this.raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -y), new THREE.Vector3());
  }

  /** Start dragging the marker under the pointer, if any. True when a drag started. */
  private startMarkerDrag(event: PointerEvent): boolean {
    const { target } = this.pick(event);
    if (target?.kind !== 'marker') return false;
    const built = this.built.find((b) => b.levelId === target.levelId);
    const object = built?.markers.get(target.id);
    if (!built || !object) return false;
    const elevation = built.group.position.y;
    const floor = this.floorPoint(elevation);
    if (!floor) return false;
    this.markerDrag = {
      id: target.id,
      levelId: target.levelId,
      object,
      elevation,
      offset: { x: object.position.x - floor.x, z: object.position.z - floor.z },
      original: { x: object.position.x, z: object.position.z },
      moved: false,
      pointerId: event.pointerId,
    };
    this.controls.enabled = false;
    this.pan = null;
    this.renderer.domElement.setPointerCapture(event.pointerId);
    this.renderer.domElement.style.cursor = 'grabbing';
    this.tooltip.hidden = true;
    return true;
  }

  private updateMarkerDrag(event: PointerEvent): void {
    const drag = this.markerDrag!;
    this.setRay(event.clientX, event.clientY);
    const floor = this.floorPoint(drag.elevation);
    if (!floor) return;
    let x = floor.x + drag.offset.x;
    let z = floor.z + drag.offset.z;
    if (this.moveGrid > 0 && !event.altKey) {
      x = Math.round(x / this.moveGrid) * this.moveGrid;
      z = Math.round(z / this.moveGrid) * this.moveGrid;
    }
    drag.moved ||= Math.abs(x - drag.original.x) > 1e-9 || Math.abs(z - drag.original.z) > 1e-9;
    drag.object.position.x = x;
    drag.object.position.z = z;
    this.requestRender();
  }

  /** Finish a marker drag; with an event, emit `markermove` (moved) or a `click` (not moved). */
  private endMarkerDrag(event: PointerEvent | null): void {
    const drag = this.markerDrag;
    if (!drag) return;
    this.markerDrag = null;
    this.controls.enabled = true;
    const canvas = this.renderer.domElement;
    if (canvas.hasPointerCapture(drag.pointerId)) canvas.releasePointerCapture(drag.pointerId);
    canvas.style.cursor = '';
    if (!event) return;
    if (drag.moved) {
      const position = { x: drag.object.position.x, y: drag.object.position.z };
      this.events.emit('markermove', { id: drag.id, levelId: drag.levelId, position });
    } else {
      const { target, point } = this.pick(event);
      this.events.emit('click', { target, point, originalEvent: event });
    }
  }

  private attachUnderlay(): void {
    if (!this.underlay) return;
    const target = this.built.find((b) => b.levelId === this.underlay?.levelId) ?? this.built[0];
    if (target) target.group.add(this.underlay.mesh);
  }

  private removeUnderlay(): void {
    if (!this.underlay) return;
    this.underlay.mesh.removeFromParent();
    disposeObject(this.underlay.mesh);
    this.underlay = null;
  }

  private clearPlan(): void {
    // The underlay outlives plan rebuilds: detach it before the level groups are disposed.
    this.underlay?.mesh.removeFromParent();
    this.ghost?.mesh.removeFromParent();
    this.focusState?.mesh?.removeFromParent();
    this.endMarkerDrag(null);
    for (const id of new Set([...this.pointViews.keys(), ...this.heatmaps.keys()])) this.removeLayerObjects(id);
    for (const b of this.built) {
      disposeObject(b.group);
      this.planGroup.remove(b.group);
    }
    this.built = [];
    this.hovered = null;
    this.hoveredMesh = null;
    this.tooltip.hidden = true;
  }

  private visibleLevelIds(): Set<string> {
    if (!this.plan) return new Set();
    if (this.level !== 'all') return new Set([this.level]);
    // 2D shows one level at a time; with 'all' selected, show the lowest one.
    if (this.mode === '2d') {
      const lowest = [...this.plan.levels].sort((a, b) => a.elevation - b.elevation)[0];
      return new Set(lowest ? [lowest.id] : []);
    }
    return new Set(this.plan.levels.map((l) => l.id));
  }

  /** Levels whose groups are currently shown (the selection, narrowed by the mode). */
  private shownLevelIds(): Set<string> {
    return new Set(this.built.filter((b) => b.group.visible).map((b) => b.levelId));
  }

  private applyLevelVisibility(): void {
    const visible = this.visibleLevelIds();
    for (const b of this.built) b.group.visible = visible.has(b.levelId);
  }

  private levelById(id: string): Level | undefined {
    return this.plan?.levels.find((l) => l.id === id);
  }

  private applyLayer(layer: DataLayer): void {
    if (!this.plan) return;
    if (layer.type === 'points') {
      let view = this.pointViews.get(layer.id);
      if (!view) {
        view = new PointLayerView(layer.id, (levelId, group) => this.built.find((b) => b.levelId === levelId)?.group.add(group));
        view.setMode(this.mode);
        this.pointViews.set(layer.id, view);
      }
      const heights = new Map(this.plan.levels.map((l) => [l.id, l.height]));
      view.sync(layer, new Set(this.built.map((b) => b.levelId)), this.colors.point, heights);
    } else if (layer.type === 'heatmap') {
      this.applyHeatmap(layer);
    }
  }

  /** Per level: reuse the mesh and cached grid when only values changed, else (re)build. */
  private applyHeatmap(layer: HeatmapLayer): void {
    let levels = this.heatmaps.get(layer.id);
    if (!levels) this.heatmaps.set(layer.id, (levels = new Map()));
    const key = `${layer.resolution ?? ''}|${layer.clipToRooms ?? true}|${layer.elevation ?? ''}`;
    for (const b of this.built) {
      const level = this.levelById(b.levelId);
      const points = level ? heatmapPointsOn(layer, b.levelId) : [];
      let entry = levels.get(b.levelId);
      if (!level || points.length === 0) {
        if (entry) this.disposeHeatmapLevel(entry);
        levels.delete(b.levelId);
        continue;
      }
      // Without room clipping the grid bounds follow the points, so it can't be cached.
      const reusable = entry && entry.key === key && (layer.clipToRooms ?? true);
      if (entry && reusable) {
        const texture = entry.mesh.material.map as THREE.DataTexture;
        fillHeatmap(entry.grid, points, layer, texture.image.data as Uint8Array<ArrayBuffer>);
        texture.needsUpdate = true;
        continue;
      }
      if (entry) this.disposeHeatmapLevel(entry);
      const grid = heatmapGrid(level, layer, points);
      if (!grid) {
        levels.delete(b.levelId);
        continue;
      }
      const { width, height, minX, minY, cellSize } = grid;
      const mesh = buildHeatmapMesh({ data: fillHeatmap(grid, points, layer), width, height, minX, minY, cellSize }, layer.elevation) as HeatmapLevel['mesh'];
      const group = new THREE.Group();
      group.name = `layer:${layer.id}`;
      group.add(mesh);
      b.group.add(group);
      entry = { group, mesh, grid, key };
      levels.set(b.levelId, entry);
    }
  }

  private disposeHeatmapLevel(entry: HeatmapLevel): void {
    disposeObject(entry.group);
    entry.group.removeFromParent();
  }

  private removeLayerObjects(id: string): void {
    this.pointViews.get(id)?.dispose();
    this.pointViews.delete(id);
    for (const entry of this.heatmaps.get(id)?.values() ?? []) this.disposeHeatmapLevel(entry);
    this.heatmaps.delete(id);
    if (this.hovered?.layerId === id) {
      this.hovered = null;
      this.hoveredMesh = null;
      this.tooltip.hidden = true;
    }
  }

  private lookupPoint = (layerId: string, id: string) => {
    const found = this.pointViews.get(layerId)?.pointPosition(id);
    if (!found) return null;
    return { levelId: found.levelId, position: { x: found.position.x, y: found.position.z }, height: found.position.y, radius: found.radius };
  };

  /** (Re)draws the focus highlight for the current target, e.g. after a rebuild or a point update. */
  private updateHighlight(): void {
    const state = this.focusState;
    if (!state || !this.plan) return;
    if (state.mesh) {
      state.mesh.removeFromParent();
      disposeObject(state.mesh);
      state.mesh = null;
    }
    const resolved = resolveFocus(this.plan, state.target, this.lookupPoint);
    const group = resolved && this.built.find((b) => b.levelId === resolved.levelId)?.group;
    if (!resolved || !group) return;
    state.mesh = buildHighlight(resolved, toThreeColor(state.color));
    group.add(state.mesh);
    this.requestRender();
  }

  /** Recompute every room floor color from its base color and the room layers. */
  private applyRoomColors(): void {
    const roomLayers = this.layers.filter((l): l is RoomLayer => l.type === 'rooms');
    for (const b of this.built) {
      const level = this.levelById(b.levelId);
      if (!level) continue;
      for (const room of level.rooms) {
        const mesh = b.rooms.get(room.id);
        if (!mesh) continue;
        let color: string = mesh.userData.baseColor;
        let opacity = 1;
        for (const layer of roomLayers) {
          const c = layer.color(room, level);
          if (c) {
            color = c;
            opacity = layer.opacity ?? 0.85;
          }
        }
        toThreeColor(color, mesh.material.color);
        mesh.material.opacity = opacity;
        mesh.material.transparent = opacity < 1;
      }
    }
  }

  private tooltipFor(pick: PickInfo): string | null {
    const level = this.levelById(pick.levelId);
    if (!level) return null;
    if (pick.kind === 'room') {
      const room = level.rooms.find((r) => r.id === pick.id);
      if (!room) return null;
      // Last room layer with a tooltip for this room wins, mirroring color precedence.
      for (const layer of [...this.layers].reverse()) {
        if (layer.type === 'rooms' && layer.tooltip) {
          const text = layer.tooltip(room, level);
          if (text) return text;
        }
      }
      return null;
    }
    if (pick.kind === 'point') {
      const layer = this.layers.find((l): l is PointLayer => l.id === pick.layerId && l.type === 'points');
      const point = layer?.points.find((p) => p.id === pick.id);
      return (point && layer?.tooltip?.(point)) || null;
    }
    if (pick.kind === 'marker') return level.markers.find((m) => m.id === pick.id)?.name || null;
    return null;
  }

  /** Live data changed under an open tooltip: update its text in place (or hide it). */
  private refreshTooltip(): void {
    if (this.tooltip.hidden) return;
    const text = this.hovered ? this.tooltipFor(this.hovered) : null;
    if (text) this.tooltip.textContent = text;
    else this.tooltip.hidden = true;
  }

  private pick(event: { clientX: number; clientY: number }): { target: PickInfo | null; mesh: THREE.Mesh | null; point: Point | null } {
    this.setRay(event.clientX, event.clientY);

    const candidates: THREE.Object3D[] = [];
    for (const b of this.built) {
      if (!b.group.visible) continue;
      b.group.traverseVisible((o) => {
        if (o.userData.pick) candidates.push(o);
      });
    }
    const hit = this.raycaster.intersectObjects(candidates, false)[0];
    if (hit) {
      return {
        target: { ...(hit.object.userData.pick as PickInfo) },
        mesh: hit.object as THREE.Mesh,
        point: { x: hit.point.x, y: hit.point.z },
      };
    }

    // Missed everything: project onto the floor of the lowest visible level.
    const visible = this.built.filter((b) => b.group.visible);
    const floorY = visible.length ? Math.min(...visible.map((b) => b.group.position.y)) : 0;
    const hitPoint = new THREE.Vector3();
    const onFloor = this.raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -floorY), hitPoint);
    return { target: null, mesh: null, point: onFloor ? { x: hitPoint.x, y: hitPoint.z } : null };
  }

  private setHover(mesh: THREE.Mesh | null): void {
    const setEmissive = (m: THREE.Mesh | null, color: THREE.Color | number) => {
      // A part of a 3D model lights up the whole model.
      let slot: THREE.Object3D | null = m;
      while (slot && !slot.userData.modelSlot) slot = slot.parent;
      const meshes: THREE.Mesh[] = [];
      if (slot) slot.traverse((o) => void ((o as THREE.Mesh).isMesh && meshes.push(o as THREE.Mesh)));
      else if (m) meshes.push(m);
      for (const target of meshes) {
        for (const mat of Array.isArray(target.material) ? target.material : [target.material]) {
          (mat as THREE.MeshStandardMaterial).emissive?.set(color);
        }
      }
    };
    setEmissive(this.hoveredMesh, 0x000000);
    setEmissive(mesh, HOVER_EMISSIVE);
    this.hoveredMesh = mesh;
    this.requestRender();
  }

  private onPointerDown = (event: PointerEvent): void => {
    this.downAt = { x: event.clientX, y: event.clientY };
    if (this.movableMarkers && event.button === 0 && !this.markerDrag && this.startMarkerDrag(event)) {
      this.downAt = null;
      event.stopImmediatePropagation(); // keep OrbitControls out of it
    }
  };

  private onPointerUp = (event: PointerEvent): void => {
    if (this.markerDrag) {
      this.endMarkerDrag(event);
      return;
    }
    if (!this.downAt) return;
    const moved = Math.hypot(event.clientX - this.downAt.x, event.clientY - this.downAt.y);
    this.downAt = null;
    if (moved > CLICK_TOLERANCE) return;
    const { target, point } = this.pick(event);
    this.events.emit('click', { target, point, originalEvent: event });
  };

  private onPointerMove = (event: PointerEvent): void => {
    if (this.markerDrag) {
      this.updateMarkerDrag(event);
      return;
    }
    if (event.buttons !== 0) return; // dragging the camera
    const { target, mesh, point } = this.pick(event);
    const changed = target?.kind !== this.hovered?.kind || target?.id !== this.hovered?.id;
    if (changed) {
      this.hovered = target;
      this.setHover(target?.kind === 'wall' ? null : mesh);
      this.renderer.domElement.style.cursor =
        target?.kind === 'marker' && this.movableMarkers ? 'grab' : target && target.kind !== 'wall' ? 'pointer' : '';
      this.events.emit('hover', { target, point, originalEvent: event });
    }
    const text = target ? this.tooltipFor(target) : null;
    this.tooltip.hidden = !text;
    if (text) {
      const rect = this.element.getBoundingClientRect();
      this.tooltip.textContent = text;
      this.tooltip.style.transform = `translate(${event.clientX - rect.left + 14}px, ${event.clientY - rect.top + 14}px)`;
    }
  };

  private onPointerLeave = (event: PointerEvent): void => {
    this.tooltip.hidden = true;
    if (this.hovered) {
      this.hovered = null;
      this.setHover(null);
      this.events.emit('hover', { target: null, point: null, originalEvent: event });
    }
  };
}
