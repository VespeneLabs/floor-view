import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';

import type { Point } from '../model/types';

/**
 * What an overlay is attached to: a plan position on a level (`elevation` in meters above the
 * level floor, default 0), the top of a marker (of its 3D model, if it has one) or the top of a
 * data point. Marker and point anchors follow their target when it moves.
 */
export type OverlayAnchor =
  | { levelId: string; position: Point; elevation?: number }
  | { kind: 'marker'; id: string }
  | { kind: 'point'; layerId: string; id: string };

/** A host-provided HTML element kept attached to a place in the plan (`viewer.setOverlay`). */
export interface ViewerOverlay {
  id: string;
  /** The host's element. The viewer puts it inside a positioned wrapper and never styles it. */
  element: HTMLElement;
  anchor: OverlayAnchor;
  /**
   * Which point of the element sits on the anchor, as fractions of its width and height.
   * Default `{ x: 0.5, y: 1 }`: bottom center, so the element stands above the anchor.
   */
  align?: { x: number; y: number };
  /** Screen offset from the anchor in CSS pixels (y down), e.g. `{ x: 0, y: -8 }` to clear a model. */
  offset?: { x: number; y: number };
  /**
   * Called when the overlay starts or stops being shown, and once with the initial state. It is
   * not shown while its level is hidden, its anchor doesn't exist (yet), its point layer is
   * hidden or the anchor is behind the camera. Walls and models in front don't hide it.
   */
  onVisibilityChange?: (visible: boolean) => void;
}

/** Where an anchor currently is: the scene object to hang the overlay on and the position inside it. */
export interface OverlayPlace {
  parent: THREE.Object3D;
  position: THREE.Vector3;
}

interface Item {
  overlay: ViewerOverlay;
  object: CSS2DObject;
  visible: boolean | null;
}

/** Whether something between the wheel event's target and `root` scrolls vertically itself. */
function scrollsInside(target: EventTarget | null, root: HTMLElement): boolean {
  for (let el = target instanceof Element ? target : null; el && el !== root; el = el.parentElement) {
    if (el.scrollHeight > el.clientHeight && /auto|scroll/.test(getComputedStyle(el).overflowY)) return true;
  }
  return false;
}

/**
 * The overlays of a viewer: one `CSS2DObject` per overlay, wrapping the host element, so the
 * label renderer positions it. `place` runs before every label render and re-resolves each
 * anchor, which is what makes overlays follow drags, layer updates and plan rebuilds.
 * Pure three.js and DOM, no renderer needed.
 */
export class OverlaySet {
  private readonly items = new Map<string, Item>();

  /** `forwardWheel` gets wheel events over an overlay that the overlay doesn't use itself. */
  constructor(private readonly forwardWheel: (event: WheelEvent) => void = () => {}) {}

  get size(): number {
    return this.items.size;
  }

  list(): ViewerOverlay[] {
    return [...this.items.values()].map((item) => item.overlay);
  }

  /** Add an overlay, or replace the one with the same id (keeping its place until the next `place`). */
  set(overlay: ViewerOverlay): void {
    let item = this.items.get(overlay.id);
    if (!item) {
      const wrapper = document.createElement('div');
      wrapper.className = 'vl-viewer__overlay';
      wrapper.addEventListener('wheel', this.onWheel, { passive: false });
      const object = new CSS2DObject(wrapper);
      object.name = 'overlay';
      item = { overlay, object, visible: null };
      this.items.set(overlay.id, item);
    }
    const wrapper = item.object.element;
    const previous = item.overlay.element;
    if (previous !== overlay.element && previous.parentNode === wrapper) previous.remove();
    if (overlay.element.parentNode !== wrapper) wrapper.appendChild(overlay.element);
    wrapper.dataset.overlay = overlay.id;
    wrapper.style.marginLeft = `${overlay.offset?.x ?? 0}px`;
    wrapper.style.marginTop = `${overlay.offset?.y ?? 0}px`;
    item.object.center.set(overlay.align?.x ?? 0.5, overlay.align?.y ?? 1);
    item.overlay = overlay;
  }

  /** Remove an overlay and hand its element back (detached). False if there is no such overlay. */
  remove(id: string): boolean {
    const item = this.items.get(id);
    if (!item) return false;
    this.items.delete(id);
    const wrapper = item.object.element;
    item.object.removeFromParent();
    wrapper.remove();
    wrapper.removeEventListener('wheel', this.onWheel);
    if (item.overlay.element.parentNode === wrapper) item.overlay.element.remove();
    return true;
  }

  /** Attach every overlay where its anchor is now; an overlay whose anchor doesn't resolve is taken off screen. */
  place(resolve: (anchor: OverlayAnchor) => OverlayPlace | null): void {
    for (const { overlay, object } of this.items.values()) {
      const place = resolve(overlay.anchor);
      if (!place) {
        this.unhook(object);
        continue;
      }
      if (object.parent !== place.parent) place.parent.add(object);
      object.position.copy(place.position);
    }
  }

  /** Call after the label render: tells hosts about overlays that appeared or disappeared. */
  report(): void {
    for (const item of this.items.values()) {
      const visible = item.object.parent !== null && item.object.element.style.display !== 'none';
      if (visible === item.visible) continue;
      item.visible = visible;
      item.overlay.onVisibilityChange?.(visible);
    }
  }

  /** Take every overlay out of the scene (keeping it registered), e.g. before the scene is disposed. */
  detach(): void {
    for (const { object } of this.items.values()) this.unhook(object);
  }

  dispose(): void {
    for (const id of [...this.items.keys()]) this.remove(id);
  }

  private unhook(object: CSS2DObject): void {
    object.removeFromParent();
    object.element.remove();
  }

  private onWheel = (event: WheelEvent): void => {
    if (event.defaultPrevented || scrollsInside(event.target, event.currentTarget as HTMLElement)) return;
    event.preventDefault(); // don't scroll the page instead
    this.forwardWheel(event);
  };
}
