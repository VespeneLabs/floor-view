import type { ModelAsset } from '@vespenelabs/floorview';

/** MIME type of an asset dragged from the asset library (its id is the data). */
export const ASSET_MIME = 'application/x-floorview-asset';

/**
 * The asset being dragged from the library, for drop targets. `dataTransfer.getData` is only
 * readable on `drop`, but `dragover` needs the asset to show a placement preview.
 */
let dragged: ModelAsset | null = null;

export function startAssetDrag(event: React.DragEvent, asset: ModelAsset): void {
  dragged = asset;
  event.dataTransfer.setData(ASSET_MIME, asset.id);
  event.dataTransfer.effectAllowed = 'copy';
}

export function endAssetDrag(): void {
  dragged = null;
}

/** The dragged library asset if this drag event carries one, else null. */
export function draggedAsset(event: React.DragEvent): ModelAsset | null {
  return dragged && event.dataTransfer.types.includes(ASSET_MIME) ? dragged : null;
}

/** Round a plan position to the editor's default grid. */
export function snapToGrid(p: { x: number; y: number }, grid = 0.25): { x: number; y: number } {
  return { x: Math.round(p.x / grid) * grid, y: Math.round(p.y / grid) * grid };
}

/** The marker template for an asset (named, kind = its category, showing its model). */
export function assetTemplate(asset: ModelAsset) {
  return { name: asset.name, kind: asset.category?.toLowerCase(), model: asset.id };
}
