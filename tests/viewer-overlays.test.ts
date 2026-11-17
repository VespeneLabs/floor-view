import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';

import { OverlaySet, type OverlayAnchor, type OverlayPlace } from '../src/viewer/overlays';

const el = (text = '') => Object.assign(document.createElement('div'), { textContent: text });
const marker = (id: string): OverlayAnchor => ({ kind: 'marker', id });

/** A stand-in for the viewer: marker anchors resolve to entries of `places`. */
function setup() {
  const level = new THREE.Group();
  const places = new Map<string, OverlayPlace>([['m1', { parent: level, position: new THREE.Vector3(1, 2, 3) }]]);
  const resolve = (anchor: OverlayAnchor) => ('kind' in anchor ? (places.get(anchor.id) ?? null) : null);
  const objects = () => level.children.filter((c) => c.name === 'overlay') as (THREE.Object3D & { element: HTMLElement; center: THREE.Vector2 })[];
  return { level, places, resolve, objects };
}

describe('OverlaySet', () => {
  it('wraps the host element and places it at its anchor, following it', () => {
    const { places, resolve, objects } = setup();
    const set = new OverlaySet();
    const card = el('Tank 1');
    set.set({ id: 'a', element: card, anchor: marker('m1'), offset: { x: 4, y: -8 } });
    set.place(resolve);

    const [object] = objects();
    expect(object!.position.toArray()).toEqual([1, 2, 3]);
    expect(object!.center.toArray()).toEqual([0.5, 1]); // bottom center: the element stands above the anchor
    const wrapper = object!.element;
    expect(wrapper.className).toBe('vl-viewer__overlay');
    expect(card.parentElement).toBe(wrapper);
    expect([wrapper.style.marginLeft, wrapper.style.marginTop]).toEqual(['4px', '-8px']);
    expect(card.getAttribute('style')).toBeNull(); // the host element is never styled

    places.get('m1')!.position.set(5, 2, 6); // the marker was dragged
    set.place(resolve);
    expect(objects()).toEqual([object]);
    expect(object!.position.toArray()).toEqual([5, 2, 6]);
  });

  it('updates an overlay in place and swaps its element', () => {
    const { resolve, objects } = setup();
    const set = new OverlaySet();
    const first = el('one');
    const second = el('two');
    set.set({ id: 'a', element: first, anchor: marker('m1') });
    set.place(resolve);
    const [object] = objects();
    set.set({ id: 'a', element: second, anchor: marker('m1'), align: { x: 0, y: 0 } });
    set.place(resolve);
    expect(objects()).toEqual([object]);
    expect(object!.center.toArray()).toEqual([0, 0]);
    expect([first.parentElement, second.parentElement]).toEqual([null, object!.element]);
    expect(set.list().map((o) => o.element)).toEqual([second]);
  });

  it('keeps an overlay whose anchor is missing and shows it when the anchor appears', () => {
    const { level, places, resolve, objects } = setup();
    const set = new OverlaySet();
    const seen: boolean[] = [];
    set.set({ id: 'a', element: el(), anchor: marker('m2'), onVisibilityChange: (v) => seen.push(v) });
    set.place(resolve);
    set.report();
    expect(objects()).toHaveLength(0);
    expect(seen).toEqual([false]); // initial state

    places.set('m2', { parent: level, position: new THREE.Vector3() });
    set.place(resolve);
    set.report();
    set.report(); // unchanged: no second call
    expect(objects()).toHaveLength(1);

    objects()[0]!.element.style.display = 'none'; // what the label renderer does for a hidden level
    set.report();
    expect(seen).toEqual([false, true, false]);
  });

  it('survives a scene rebuild: detach, then place into the new level group', () => {
    const { places, resolve, objects } = setup();
    const set = new OverlaySet();
    const card = el();
    set.set({ id: 'a', element: card, anchor: marker('m1') });
    set.place(resolve);
    const wrapper = objects()[0]!.element;
    document.body.appendChild(wrapper); // the label renderer would have put it in its layer

    set.detach();
    expect(objects()).toHaveLength(0);
    expect(wrapper.isConnected).toBe(false);
    expect(set.size).toBe(1);

    const rebuilt = new THREE.Group();
    places.set('m1', { parent: rebuilt, position: new THREE.Vector3(7, 0, 7) });
    set.place(resolve);
    expect(rebuilt.children).toHaveLength(1);
    expect(card.parentElement).toBe(wrapper); // same wrapper, same host element
  });

  it('removes an overlay and hands the element back detached', () => {
    const { resolve, objects } = setup();
    const set = new OverlaySet();
    const card = el();
    set.set({ id: 'a', element: card, anchor: marker('m1') });
    set.place(resolve);
    expect(set.remove('a')).toBe(true);
    expect(set.remove('a')).toBe(false);
    expect(objects()).toHaveLength(0);
    expect(card.parentElement).toBeNull();
    expect(set.list()).toEqual([]);
  });

  it('forwards the wheel unless the host handled it or the element under the pointer scrolls', () => {
    const { resolve, objects } = setup();
    const forward = vi.fn();
    const set = new OverlaySet(forward);
    const card = el();
    const list = card.appendChild(el());
    const row = list.appendChild(el());
    set.set({ id: 'a', element: card, anchor: marker('m1') });
    set.place(resolve);
    document.body.appendChild(objects()[0]!.element);
    const wheel = (target: Element) => {
      const event = new WheelEvent('wheel', { deltaY: 40, bubbles: true, cancelable: true });
      target.dispatchEvent(event);
      return event;
    };

    expect(wheel(row).defaultPrevented).toBe(true); // the page must not scroll instead
    expect(forward).toHaveBeenCalledTimes(1);

    // An expanded, scrollable list keeps its wheel.
    list.style.overflowY = 'auto';
    Object.defineProperties(list, { scrollHeight: { value: 300 }, clientHeight: { value: 100 } });
    expect(wheel(row).defaultPrevented).toBe(false);
    expect(wheel(card).defaultPrevented).toBe(true); // outside the list it zooms again
    expect(forward).toHaveBeenCalledTimes(2);

    card.addEventListener('wheel', (e) => e.preventDefault());
    wheel(card);
    expect(forward).toHaveBeenCalledTimes(2); // the host used it
    objects()[0]!.element.remove();
  });
});
