/**
 * `@vespenelabs/floorview/kenney`: a ready-made catalog of 3D models for markers, from the
 * Kenney kits (kenney.nl, CC0 1.0: free for any use, credit appreciated) shipped in the package's
 * `assets/kenney/` folder. Serve that folder from your app and pass its URL:
 *
 * ```ts
 * const assets = kenneyAssets('/floorview-assets/kenney');
 * new FloorplanViewer(el, { plan, assets });
 * new FloorplanEditor(el, { plan, assets });
 * ```
 *
 * Pure data (no Three.js, no DOM). Regenerate the catalog with `scripts/import-kenney.mjs`.
 */
import type { ModelAsset } from '../model/assets';
import { KENNEY_KITS, KENNEY_MODELS, type KenneyKitId } from './catalog';
import { KENNEY_AI_EXCLUDED, KENNEY_DESCRIPTIONS } from './descriptions';

export { KENNEY_KITS, type KenneyKitId } from './catalog';
export { KENNEY_AI_EXCLUDED, KENNEY_AI_EXCLUSIONS, KENNEY_DESCRIPTIONS } from './descriptions';
export { createKenneyDemoPlan } from './demo';

/** Asset id of a Kenney model, e.g. `kenneyAssetId('furniture', 'desk')` → `"kenney/furniture/desk"`. */
export function kenneyAssetId(kit: KenneyKitId, model: string): string {
  return `kenney/${kit}/${model}`;
}

/** "bedSingle" → "Bed single", "robot-arm-a" → "Robot arm A", "desk_chairArms" → "Desk chair arms". */
export function humanizeModelName(model: string): string {
  const words = model
    .replace(/([a-z])([A-Z0-9])/g, '$1 $2')
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((w) => (w.length === 1 ? w.toUpperCase() : w.toLowerCase()));
  const text = words.join(' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export interface KenneyAssetOptions {
  /** Only these kits (default: all). */
  kits?: readonly KenneyKitId[];
}

/**
 * The Kenney models as `ModelAsset`s. `baseUrl` is where the `assets/kenney` folder is served
 * (absolute, or relative to the page), with or without a trailing slash. Models carry their
 * `description`; those not suited to AI placement (decor, kit parts, game pieces) have `ai: false`.
 */
export function kenneyAssets(baseUrl: string, { kits }: KenneyAssetOptions = {}): ModelAsset[] {
  const base = baseUrl.replace(/\/+$/, '');
  const labels = new Map<string, { label: string; scale: number }>(KENNEY_KITS.map((k) => [k.id, k]));
  return KENNEY_MODELS.filter(([kit]) => !kits || kits.includes(kit)).map(([kit, model, width, depth, height]) => {
    const id = kenneyAssetId(kit, model);
    const description = KENNEY_DESCRIPTIONS[id];
    return {
      id,
      name: humanizeModelName(model),
      url: `${base}/${kit}/${model}.glb`,
      preview: `${base}/${kit}/previews/${model}.png`,
      category: labels.get(kit)!.label,
      scale: labels.get(kit)!.scale,
      size: { width, depth, height },
      ...(description ? { description } : {}),
      ...(KENNEY_AI_EXCLUDED.has(id) ? { ai: false } : {}),
    };
  });
}
