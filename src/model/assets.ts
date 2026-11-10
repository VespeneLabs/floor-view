import type { Marker, Point } from './types';

/**
 * A 3D model that markers can show (`marker.model` is its `id`). Hosts pass a list of these to the
 * viewer (which loads the glTF/GLB at `url`) and the editor (which draws the footprint). The plan
 * stores only the id, so the same plan works with any catalog that provides it.
 */
export interface ModelAsset {
  /** Stable id stored in `marker.model`, e.g. `"kenney/furniture/desk"`. */
  id: string;
  /** Display name. */
  name: string;
  /** URL of a glTF/GLB file. Relative resources (textures) resolve against it. */
  url: string;
  /** Grouping for pickers, e.g. `"Furniture"`. */
  category?: string;
  /** Uniform scale from model units to meters. Default 1. */
  scale?: number;
  /**
   * Size in meters (after `scale`, before the marker's own scale): `width` along plan x, `depth`
   * along plan y, `height` up. Used for the editor footprint and the viewer placeholder while the
   * model loads; the viewer centers the loaded model on the marker by its own bounding box.
   */
  size: { width: number; depth: number; height: number };
  /** Thumbnail image URL for pickers. */
  preview?: string;
  /**
   * What the model shows, for search and AI assistants: what it is, how it looks on a plan
   * drawing, where it is typically used, synonyms. One or two plain sentences.
   */
  description?: string;
  /** `false` keeps the model out of AI assistants' catalogs (decor, game pieces, kit parts). Default true. */
  ai?: boolean;
  /**
   * Wall-mounted (or otherwise raised) model, authored at its mounting height above the file's
   * origin (the floor). The viewer keeps that height instead of setting the model's lowest point
   * on the floor; `size.height` is then the height of its top above the floor. Default false.
   */
  mounted?: boolean;
}

/**
 * One model of a {@link ModelKit}, as a compact tuple (handy for generated catalogs):
 * `[file name, display name, width, depth, height, description?, mounted?]`, sizes in meters.
 */
export type KitModelTuple = readonly [
  model: string,
  name: string,
  width: number,
  depth: number,
  height: number,
  description?: string,
  mounted?: boolean,
];

/** One model of a {@link ModelKit}, as an object (handy for hand-written catalogs). */
export interface KitModelEntry {
  /** File name without extension: the GLB is `<model>.glb`, the id `<prefix>/<model>`. */
  model: string;
  name: string;
  size: ModelAsset['size'];
  description?: string;
  mounted?: boolean;
  ai?: boolean;
  /** Overrides the kit's `scale`. */
  scale?: number;
  /** Overrides the kit's `category`. */
  category?: string;
}

/**
 * A kit of 3D models served from one folder: `<base>/<model>.glb`, with optional previews at
 * `<base>/previews/<model>.png`. Turn it into `ModelAsset`s with {@link kitAssets}. See
 * docs/assets.md, "Making your own kit".
 */
export interface ModelKit {
  /** Id namespace: asset ids are `<prefix>/<model>`, e.g. `"acme/pumps"`. Keep it stable; plans store the ids. */
  prefix: string;
  /** Category shown in pickers, e.g. `"Pumps"`. */
  category: string;
  models: readonly (KitModelTuple | KitModelEntry)[];
  /** Model units → meters for every model (default 1). */
  scale?: number;
  /** Whether `previews/<model>.png` exists next to the models (default true). */
  previews?: boolean;
}

/** Asset id of a kit model: `<prefix>/<model>`. */
export function kitAssetId(kit: Pick<ModelKit, 'prefix'>, model: string): string {
  return `${kit.prefix}/${model}`;
}

/**
 * The kit's models as `ModelAsset`s, with files under `baseUrl` (where the kit folder is served,
 * with or without a trailing slash). Pass the result, alone or with other kits, to the viewer and
 * editor `assets`.
 */
export function kitAssets(kit: ModelKit, baseUrl: string): ModelAsset[] {
  const base = baseUrl.replace(/\/+$/, '');
  return kit.models.map((m) => {
    const e = isTuple(m) ? tupleEntry(m) : m;
    const scale = e.scale ?? kit.scale;
    return {
      id: kitAssetId(kit, e.model),
      name: e.name,
      url: `${base}/${e.model}.glb`,
      category: e.category ?? kit.category,
      size: { ...e.size },
      ...(kit.previews === false ? {} : { preview: `${base}/previews/${e.model}.png` }),
      ...(e.description ? { description: e.description } : {}),
      ...(scale !== undefined && scale !== 1 ? { scale } : {}),
      ...(e.mounted ? { mounted: true } : {}),
      ...(e.ai === false ? { ai: false } : {}),
    };
  });
}

function isTuple(m: KitModelTuple | KitModelEntry): m is KitModelTuple {
  return Array.isArray(m);
}

function tupleEntry([model, name, width, depth, height, description, mounted]: KitModelTuple): KitModelEntry {
  return { model, name, size: { width, depth, height }, description, mounted };
}

/** Index assets by id (later entries win). */
export function indexAssets(assets: readonly ModelAsset[]): Map<string, ModelAsset> {
  return new Map(assets.map((a) => [a.id, a]));
}

/** Rotate `p` around `center` by `degrees` (clockwise on screen, since plan y grows down). */
export function rotatePoint(p: Point, center: Point, degrees: number): Point {
  const r = (degrees * Math.PI) / 180;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  const dx = p.x - center.x;
  const dy = p.y - center.y;
  return { x: center.x + dx * cos - dy * sin, y: center.y + dx * sin + dy * cos };
}

/**
 * The plan-space outline (4 corners) of a marker showing `asset`: the asset footprint scaled by
 * `marker.scale`, centered on the marker and rotated by `marker.rotation`.
 */
export function markerFootprint(marker: Marker, asset: Pick<ModelAsset, 'size'>): Point[] {
  const s = marker.scale ?? 1;
  const hw = (asset.size.width * s) / 2;
  const hd = (asset.size.depth * s) / 2;
  const { x, y } = marker.position;
  const corners = [
    { x: x - hw, y: y - hd },
    { x: x + hw, y: y - hd },
    { x: x + hw, y: y + hd },
    { x: x - hw, y: y + hd },
  ];
  return corners.map((p) => rotatePoint(p, marker.position, marker.rotation ?? 0));
}
