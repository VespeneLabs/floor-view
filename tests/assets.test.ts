import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as THREE from 'three';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { FloorplanEditor } from '../src/editor/Editor';
import { createKenneyDemoPlan, humanizeModelName, KENNEY_KITS, kenneyAssets } from '../src/kenney/index';
import { kitAssetId, kitAssets, markerFootprint, type ModelAsset, type ModelKit } from '../src/model/assets';
import { createPlan } from '../src/model/plan';
import type { Marker } from '../src/model/types';
import { parsePlan } from '../src/model/validate';
import { buildLevel, disposeObject } from '../src/viewer/sceneBuilder';

const DESK: ModelAsset = { id: 'desk', name: 'Desk', url: '/desk.glb', size: { width: 2, depth: 1, height: 0.8 } };
const marker = (patch: Partial<Marker> = {}): Marker => ({ id: 'm', name: 'Desk', position: { x: 5, y: 5 }, model: 'desk', ...patch });

describe('marker models in the plan format', () => {
  it('keeps model, rotation and scale, and validates them', () => {
    const plan = createPlan();
    plan.levels[0]!.markers.push(marker({ rotation: 90, scale: 1.5 }));
    expect(parsePlan(JSON.parse(JSON.stringify(plan))).levels[0]!.markers[0]).toMatchObject({ model: 'desk', rotation: 90, scale: 1.5 });
    plan.levels[0]!.markers[0]!.scale = 0;
    expect(() => parsePlan(plan)).toThrow('$.levels[0].markers[0].scale');
  });

  it('keeps and validates the height above the floor, and raises the model slot by it', () => {
    const plan = createPlan();
    plan.levels[0]!.markers.push(marker({ elevation: 0.75 }));
    const parsed = parsePlan(JSON.parse(JSON.stringify(plan)));
    expect(parsed.levels[0]!.markers[0]!.elevation).toBe(0.75);
    const built = buildLevel(parsed.levels[0]!, undefined, new Map([['desk', DESK]]));
    expect(built.models[0]!.slot.position.y).toBe(0.75);
    plan.levels[0]!.markers[0]!.elevation = Number.NaN;
    expect(() => parsePlan(plan)).toThrow('$.levels[0].markers[0].elevation');
  });

  it('computes the rotated footprint, clockwise in plan view', () => {
    expect(markerFootprint(marker(), DESK)).toEqual([
      { x: 4, y: 4.5 },
      { x: 6, y: 4.5 },
      { x: 6, y: 5.5 },
      { x: 4, y: 5.5 },
    ]);
    const turned = markerFootprint(marker({ rotation: 90, scale: 2 }), DESK);
    // 4 × 2 m, turned a quarter: now 2 m wide (x) and 4 m deep (y); the first corner moves to the top right.
    expect(turned[0]!.x).toBeCloseTo(6);
    expect(turned[0]!.y).toBeCloseTo(3);
    expect(turned[2]!.x).toBeCloseTo(4);
    expect(turned[2]!.y).toBeCloseTo(7);
  });
});

describe('sceneBuilder model slots', () => {
  it('puts a pickable placeholder of the asset size at the marker, rotated like the plan', () => {
    const level = createPlan().levels[0]!;
    level.markers = [marker({ rotation: 90 }), { id: 'plain', name: 'Exit', position: { x: 1, y: 1 }, model: 'unknown' }];
    const built = buildLevel(level, undefined, new Map([['desk', DESK]]));
    expect(built.models).toHaveLength(1);
    const { slot, placeholder } = built.models[0]!;
    expect(slot.userData.modelSlot).toBe(true);
    expect(placeholder!.userData.pick).toEqual({ kind: 'marker', id: 'm', levelId: level.id });
    built.group.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(placeholder!);
    expect(box.min.x).toBeCloseTo(4.5); // 1 m deep along x after a quarter turn
    expect(box.max.x).toBeCloseTo(5.5);
    expect(box.min.z).toBeCloseTo(4); // 2 m wide along plan y
    expect(box.max.z).toBeCloseTo(6);
    expect(box.max.y).toBeCloseTo(0.8);
    // Unknown model ids fall back to the default sphere.
    expect((built.markers.get('plain') as THREE.Mesh).geometry).toBeInstanceOf(THREE.SphereGeometry);
  });

  it('disposes only the material of shared model meshes', () => {
    const geometry = new THREE.BoxGeometry();
    const texture = new THREE.Texture();
    const material = new THREE.MeshStandardMaterial({ map: texture });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.userData.sharedAsset = true;
    const disposed: string[] = [];
    geometry.addEventListener('dispose', () => disposed.push('geometry'));
    texture.addEventListener('dispose', () => disposed.push('texture'));
    material.addEventListener('dispose', () => disposed.push('material'));
    disposeObject(mesh);
    expect(disposed).toEqual(['material']);
  });
});

describe('FloorplanEditor with assets', () => {
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
  const setup = () => {
    editor = new FloorplanEditor(document.body, { plan: createPlan(), grid: 0.5, assets: [DESK] });
    (editor as unknown as { view: { scale: number; ox: number; oy: number } }).view = { scale: 50, ox: 0, oy: 0 };
    const svgEl = editor.element.querySelector('svg')!;
    const fire = (x: number, y: number, type: string) =>
      svgEl.dispatchEvent(new MouseEvent(type, { clientX: x * 50, clientY: y * 50, bubbles: true, button: 0 }));
    const click = (x: number, y: number) => {
      fire(x, y, 'pointerdown');
      fire(x, y, 'pointerup');
    };
    const key = (k: string, init: KeyboardEventInit = {}) => editor!.element.dispatchEvent(new KeyboardEvent('keydown', { key: k, ...init }));
    return { editor, click, key };
  };

  it('places numbered models from the template, rotated with Q/E, and stops on Escape', () => {
    const { editor, click, key } = setup();
    const templates: unknown[] = [];
    editor.on('templatechange', (t) => templates.push(t));
    editor.setMarkerTemplate({ name: 'Desk', kind: 'furniture', model: 'desk' });
    editor.setTool('marker');
    key('e', { shiftKey: true });
    click(5, 5);
    click(10, 5);
    const markers = editor.getActiveLevel().markers;
    expect(markers.map((m) => m.name)).toEqual(['Desk 1', 'Desk 2']);
    expect(markers[0]).toMatchObject({ model: 'desk', kind: 'furniture', rotation: 90, position: { x: 5, y: 5 } });
    expect(editor.element.querySelectorAll('.vl-editor__asset:not(.is-ghost)')).toHaveLength(2);
    key('Escape');
    expect(editor.getMarkerTemplate()).toBeNull();
    expect(editor.getTool()).toBe('select');
    expect(templates).toHaveLength(3); // set, rotate, clear
  });

  it('adds a dropped model with addMarker as one undo step and selects it', () => {
    const { editor } = setup();
    const level = editor.getActiveLevel();
    const added = editor.addMarker(level.id, { name: 'Desk', kind: 'furniture', model: 'desk' }, { x: 3, y: 4 });
    editor.addMarker(level.id, { name: 'Desk', model: 'desk' }, { x: 6, y: 4 });
    expect(added).toMatchObject({ name: 'Desk 1', model: 'desk', position: { x: 3, y: 4 } });
    expect(editor.getActiveLevel().markers.map((m) => m.name)).toEqual(['Desk 1', 'Desk 2']);
    expect(editor.getSelection()?.kind).toBe('marker');
    expect(editor.addMarker('nope', { name: 'Desk' }, { x: 0, y: 0 })).toBeNull();
    editor.undo();
    expect(editor.getActiveLevel().markers).toHaveLength(1);
  });

  it('selects a model by its footprint and rotates the selection as one undo step', () => {
    const { editor, click, key } = setup();
    editor.setMarkerTemplate({ name: 'Desk', model: 'desk' });
    editor.setTool('marker');
    click(5, 5);
    editor.setTool('select');
    click(5.9, 5.4); // inside the 2 × 1 m footprint, outside the default marker radius
    expect(editor.getSelection()?.kind).toBe('marker');
    key('q');
    expect(editor.getActiveLevel().markers[0]!.rotation).toBe(345);
    editor.undo();
    expect(editor.getActiveLevel().markers[0]!.rotation).toBeUndefined();
  });
});

describe('Kenney catalog and demo plan', () => {
  const assets = kenneyAssets('/kenney/');

  it('builds unique ids and URLs under the base, with files that exist', () => {
    expect(new Set(assets.map((a) => a.id)).size).toBe(assets.length);
    expect(assets.find((a) => a.id === 'kenney/furniture/desk')).toMatchObject({
      name: 'Desk',
      url: '/kenney/furniture/desk.glb',
      preview: '/kenney/furniture/previews/desk.png',
      category: 'Furniture',
    });
    expect(kenneyAssets('x', { kits: ['factory'] }).every((a) => a.category === 'Factory')).toBe(true);
    for (const asset of assets) {
      const path = resolve(import.meta.dirname, '../assets', asset.url.slice(1));
      expect(existsSync(path), path).toBe(true);
      expect(asset.size.width > 0 && asset.size.depth >= 0 && asset.size.height >= 0).toBe(true);
    }
    expect(KENNEY_KITS.length).toBeGreaterThan(0);
  });

  it('humanizes model names', () => {
    expect(humanizeModelName('bedSingle')).toBe('Bed single');
    expect(humanizeModelName('robot-arm-a')).toBe('Robot arm A');
    expect(humanizeModelName('desk_chairArms')).toBe('Desk chair arms');
    expect(humanizeModelName('plantSmall1')).toBe('Plant small 1');
  });

  it('demo plan is valid and only uses models from the catalog', () => {
    const plan = createKenneyDemoPlan();
    expect(parsePlan(JSON.parse(JSON.stringify(plan)))).toEqual(plan);
    const ids = new Set(assets.map((a) => a.id));
    const models = plan.levels.flatMap((l) => l.markers.map((m) => m.model));
    expect(models.length).toBeGreaterThan(100);
    for (const model of models) expect(ids.has(model!), model).toBe(true);
  });
});

describe('model color styles', () => {
  it('draws every instance in matte clay with its own accent uniforms, restyled without recompiling', async () => {
    const { ModelCache, applyModelStyle } = await import('../src/viewer/models');
    const template = new THREE.Group().add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial({ roughness: 0.3, metalness: 1 })));
    const cache = new ModelCache();
    const pick = { kind: 'marker' as const, id: 'm', levelId: 'l' };
    const clay = new THREE.Color('#eeeeee');
    const a = cache.instantiate(template, pick, { clay, accent: new THREE.Color('#14b8a6') });
    const b = cache.instantiate(template, pick, { clay, accent: null });
    const uniforms = (o: THREE.Object3D) => ((o.children[0] as THREE.Mesh).material as THREE.Material).userData.vlStyle;
    expect(uniforms(a).vlAccentOn.value).toBe(1); // no accent parts: the whole model is tinted
    expect(uniforms(b).vlAccentOn.value).toBe(0);
    expect(uniforms(a).vlAccent.value.getHexString()).toBe('14b8a6');
    const material = (a.children[0] as THREE.Mesh).material as THREE.MeshStandardMaterial;
    expect(material.customProgramCacheKey()).toBe('vl-model-style');
    expect([material.roughness, material.metalness]).toEqual([0.7, 0]);
    applyModelStyle(a, { clay, accent: null });
    expect(uniforms(a).vlAccentOn.value).toBe(0);
    expect((template.children[0] as THREE.Mesh).material).not.toBe(material); // template untouched
  });
});

describe('custom model kits', () => {
  const kit: ModelKit = {
    prefix: 'acme/pumps',
    category: 'Pumps',
    models: [
      ['booster', 'Booster pump', 0.6, 0.4, 0.8, 'Booster pump on a skid.'],
      ['wall-panel', 'Pump panel', 0.5, 0.2, 1.6, undefined, true],
      { model: 'tank', name: 'Tank', size: { width: 1, depth: 1, height: 2 }, ai: false, scale: 0.01, category: 'Tanks' },
    ],
  };

  it('turns tuple and object entries into ModelAssets under the base URL', () => {
    const [booster, panel, tank] = kitAssets(kit, 'https://cdn.example.com/kits/pumps/');
    expect(booster).toEqual({
      id: 'acme/pumps/booster',
      name: 'Booster pump',
      url: 'https://cdn.example.com/kits/pumps/booster.glb',
      preview: 'https://cdn.example.com/kits/pumps/previews/booster.png',
      category: 'Pumps',
      size: { width: 0.6, depth: 0.4, height: 0.8 },
      description: 'Booster pump on a skid.',
    });
    expect(panel!.mounted).toBe(true);
    expect(panel!.description).toBeUndefined();
    expect(tank).toMatchObject({ id: 'acme/pumps/tank', category: 'Tanks', scale: 0.01, ai: false });
    expect(kitAssetId(kit, 'booster')).toBe('acme/pumps/booster');
  });

  it('applies the kit scale and can leave out previews', () => {
    const [booster] = kitAssets({ ...kit, scale: 2, previews: false }, '/pumps');
    expect(booster!.scale).toBe(2);
    expect(booster!.preview).toBeUndefined();
    expect(booster!.url).toBe('/pumps/booster.glb');
  });
});

describe('Gas kit', () => {
  it('lists every built model with files, sizes and descriptions', async () => {
    const { gasAssets } = await import('../src/gas/index');
    const assets = gasAssets('/gas/');
    expect(assets.length).toBeGreaterThanOrEqual(50);
    expect(new Set(assets.map((a) => a.id)).size).toBe(assets.length);
    for (const asset of assets) {
      expect(asset.id).toMatch(/^floorview\/gas\/[a-z0-9-]+$/);
      expect(asset.category).toBe('Gas');
      expect(asset.description!.length).toBeGreaterThan(40);
      for (const url of [asset.url, asset.preview!]) expect(existsSync(resolve(import.meta.dirname, '../assets', url.slice(1))), url).toBe(true);
      expect(asset.size.width > 0 && asset.size.depth > 0 && asset.size.height > 0).toBe(true);
    }
  });

  it('uses only the kit materials, with accent parts on nearly every model', async () => {
    const { GAS_MODELS } = await import('../src/gas/catalog');
    const allowed = new Set(['body', 'panel', 'metal', 'dark', 'accent']);
    let withAccent = 0;
    for (const [model] of GAS_MODELS) {
      // GLB: 12-byte header, then the JSON chunk (length, type, data).
      const glb = readFileSync(resolve(import.meta.dirname, '../assets/gas', `${model}.glb`));
      const json = JSON.parse(glb.subarray(20, 20 + glb.readUInt32LE(12)).toString('utf8')) as { materials?: { name: string }[] };
      const names = (json.materials ?? []).map((m) => m.name);
      for (const name of names) expect(allowed.has(name), `${model}: ${name}`).toBe(true);
      if (names.includes('accent')) withAccent++;
    }
    expect(withAccent).toBeGreaterThanOrEqual(GAS_MODELS.length - 2);
  });

  it('tints the whole model, accent parts or not, for a state tint', async () => {
    const { ModelCache, applyModelStyle } = await import('../src/viewer/models');
    const template = new THREE.Group().add(
      new THREE.Mesh(new THREE.BoxGeometry(), [new THREE.MeshStandardMaterial({ name: 'body' }), new THREE.MeshStandardMaterial({ name: 'accent' })]),
    );
    const clay = new THREE.Color('#eeeeee');
    const instance = new ModelCache().instantiate(template, { kind: 'marker', id: 'm', levelId: 'l' }, { clay, accent: null });
    const [b, a] = (instance.children[0] as THREE.Mesh).material as THREE.Material[];
    applyModelStyle(instance, { clay, accent: new THREE.Color('#ef4444'), whole: true });
    expect([b!.userData.vlStyle.vlAccentOn.value, a!.userData.vlStyle.vlAccentOn.value]).toEqual([1, 1]);
    expect(b!.userData.vlStyle.vlAccent.value.getHexString()).toBe('ef4444');
    applyModelStyle(instance, { clay, accent: null }); // tint removed, no marker color
    expect([b!.userData.vlStyle.vlAccentOn.value, a!.userData.vlStyle.vlAccentOn.value]).toEqual([0, 0]);
  });

  it('remembers marker glyph and placeholder base colors so tints can be removed', () => {
    const level = createPlan().levels[0]!;
    level.markers = [marker(), { id: 'dot', name: 'Exit', position: { x: 1, y: 1 }, color: '#16a34a' }];
    const built = buildLevel(level, undefined, new Map([['desk', DESK]]));
    expect(built.models[0]!.placeholder!.userData.baseColor).toBe('#6366f1');
    expect(built.markers.get('dot')!.userData.baseColor).toBe('#16a34a');
  });

  it('marks wall-mounted models so the viewer keeps their height', async () => {
    const { gasAssets } = await import('../src/gas/index');
    const assets = gasAssets('/gas');
    const mounted = assets.filter((a) => a.mounted).map((a) => a.id.split('/').pop());
    expect(mounted).toEqual(expect.arrayContaining(['cylinder-regulator', 'regulator-panel-4', 'regulator-panel-2', 'point-of-use-regulator']));
    expect(assets.find((a) => a.id.endsWith('/gas-cabinet'))!.mounted).toBeUndefined();
  });

  it('colors only accent parts of models that have them, and none without a marker color', async () => {
    const { ModelCache, applyModelStyle } = await import('../src/viewer/models');
    const body = new THREE.MeshStandardMaterial({ name: 'body' });
    const accent = new THREE.MeshStandardMaterial({ name: 'accent' });
    const template = new THREE.Group().add(new THREE.Mesh(new THREE.BoxGeometry(), [body, accent]));
    const clay = new THREE.Color('#eeeeee');
    const instance = new ModelCache().instantiate(template, { kind: 'marker', id: 'm', levelId: 'l' }, { clay, accent: null });
    const [b, a] = (instance.children[0] as THREE.Mesh).material as THREE.Material[];
    expect([b!.userData.vlStyle.vlAccentOn.value, a!.userData.vlStyle.vlAccentOn.value]).toEqual([0, 0]);
    applyModelStyle(instance, { clay, accent: new THREE.Color('#ff0000') });
    expect([b!.userData.vlStyle.vlAccentOn.value, a!.userData.vlStyle.vlAccentOn.value]).toEqual([0, 1]);
    expect(a!.userData.vlStyle.vlAccent.value.getHexString()).toBe('ff0000');
  });
});
