/**
 * `@vespenelabs/floorview/gas`: the "Gas" kit, industrial gas and cleanroom models made for
 * Floorview (cylinders and bulk supply, gas cabinets and valve boxes, overhead pipe / duct / cable
 * tray runs, safety equipment, cleanroom and fab tools, plant, forklifts and drums). Built from code with Blender (`scripts/blender/gas_kit.py`); files in the
 * package's `assets/gas/` folder. Serve that folder and pass its URL:
 *
 * ```ts
 * const assets = [...gasAssets('/floorview-assets/gas'), ...kenneyAssets('/floorview-assets/kenney')];
 * ```
 *
 * Models have real-world sizes (scale 1) and an `accent` material: in the viewer's clay look the
 * body stays neutral and the accent parts (cylinders, pipes, ducts, valves) take the marker color.
 * Pure data (no Three.js, no DOM). It is a plain {@link ModelKit}, the same shape apps use for
 * their own kits.
 */
import { kitAssetId, kitAssets, type ModelAsset, type ModelKit } from '../model/assets';
import { GAS_MODELS } from './catalog';

/** Category label of the kit's assets. */
export const GAS_CATEGORY = 'Gas';

/** The Gas kit as a `ModelKit` (ids `floorview/gas/<model>`). */
export const GAS_KIT: ModelKit = { prefix: 'floorview/gas', category: GAS_CATEGORY, models: GAS_MODELS };

/** Asset id of a Gas kit model, e.g. `gasAssetId('gas-cabinet')` → `"floorview/gas/gas-cabinet"`. */
export function gasAssetId(model: string): string {
  return kitAssetId(GAS_KIT, model);
}

/** The Gas kit as `ModelAsset`s. `baseUrl` is where `assets/gas` is served, with or without a trailing slash. */
export function gasAssets(baseUrl: string): ModelAsset[] {
  return kitAssets(GAS_KIT, baseUrl);
}
