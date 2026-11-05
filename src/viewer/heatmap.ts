import * as THREE from 'three';

import { pointInPolygon } from '../model/geometry';
import type { Level, Point } from '../model/types';
import { toThreeColor } from './color';
import type { HeatmapLayer, HeatmapPoint } from './layers';

/** A color stop resolved to linear 0–255 sRGB channels. */
interface ResolvedStop {
  value: number;
  rgb: [number, number, number];
}

/** Max texture size per side; larger plans get coarser cells. */
const MAX_CELLS = 512;

export function resolveStops(stops: HeatmapLayer['colorStops']): ResolvedStop[] {
  const color = new THREE.Color();
  return [...stops]
    .sort((a, b) => a.value - b.value)
    .map((s) => {
      // getHex() converts three's linear working space back to sRGB, which the texture stores.
      const hex = toThreeColor(s.color, color).getHex();
      return { value: s.value, rgb: [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255] };
    });
}

/** Color for `value`, linearly interpolated between the surrounding stops and clamped at the ends. */
export function sampleStops(stops: readonly ResolvedStop[], value: number): [number, number, number] {
  const first = stops[0];
  const last = stops[stops.length - 1];
  if (!first || !last) return [0, 0, 0];
  if (value <= first.value) return first.rgb;
  if (value >= last.value) return last.rgb;
  for (let i = 1; i < stops.length; i++) {
    const b = stops[i]!;
    if (value <= b.value) {
      const a = stops[i - 1]!;
      const t = (value - a.value) / (b.value - a.value || 1);
      return [a.rgb[0] + (b.rgb[0] - a.rgb[0]) * t, a.rgb[1] + (b.rgb[1] - a.rgb[1]) * t, a.rgb[2] + (b.rgb[2] - a.rgb[2]) * t];
    }
  }
  return last.rgb;
}

/**
 * Inverse-distance-weighted value at `p`, or null when no point lies within `maxDistance`.
 * A point closer than 1 mm returns its own value exactly.
 */
export function interpolateIDW(
  points: readonly HeatmapPoint[],
  p: Point,
  power = 2,
  maxDistance = Infinity,
): number | null {
  let weighted = 0;
  let weights = 0;
  for (const q of points) {
    const d = Math.hypot(q.position.x - p.x, q.position.y - p.y);
    if (d > maxDistance) continue;
    if (d < 1e-3) return q.value;
    const w = 1 / d ** power;
    weighted += w * q.value;
    weights += w;
  }
  return weights > 0 ? weighted / weights : null;
}

export interface HeatmapRaster {
  /** RGBA, row 0 = smallest plan y. */
  data: Uint8Array;
  width: number;
  height: number;
  /** Plan-space rectangle covered by the raster. */
  minX: number;
  minY: number;
  cellSize: number;
}

/**
 * Rasterize a heatmap for one level. Cells outside every room (when `clipToRooms`) or farther
 * than `maxDistance` from all points are transparent. Returns null when the level has no points.
 */
export function rasterizeHeatmap(level: Level, layer: HeatmapLayer): HeatmapRaster | null {
  const points = layer.points.filter((p) => p.levelId === level.id && Number.isFinite(p.value));
  if (points.length === 0) return null;

  const clip = layer.clipToRooms ?? true;
  const outline = clip ? level.rooms.flatMap((r) => r.points) : [...level.walls.flatMap((w) => [w.start, w.end]), ...points.map((p) => p.position)];
  if (outline.length === 0) return null;
  const minX = Math.min(...outline.map((p) => p.x));
  const minY = Math.min(...outline.map((p) => p.y));
  const maxX = Math.max(...outline.map((p) => p.x));
  const maxY = Math.max(...outline.map((p) => p.y));

  let cellSize = layer.resolution ?? 0.2;
  cellSize = Math.max(cellSize, (maxX - minX) / MAX_CELLS, (maxY - minY) / MAX_CELLS, 1e-3);
  const width = Math.max(1, Math.ceil((maxX - minX) / cellSize));
  const height = Math.max(1, Math.ceil((maxY - minY) / cellSize));

  const stops = resolveStops(layer.colorStops);
  const alpha = Math.round((layer.opacity ?? 0.8) * 255);
  const data = new Uint8Array(width * height * 4);

  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const p = { x: minX + (col + 0.5) * cellSize, y: minY + (row + 0.5) * cellSize };
      if (clip && !level.rooms.some((r) => pointInPolygon(p, r.points))) continue;
      const value = interpolateIDW(points, p, layer.power, layer.maxDistance);
      if (value === null) continue;
      const [r, g, b] = sampleStops(stops, value);
      const i = (row * width + col) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = alpha;
    }
  }
  return { data, width, height, minX, minY, cellSize };
}

/** A flat textured plane for the raster, in level-local coordinates. Not pickable. */
export function buildHeatmapMesh(raster: HeatmapRaster, elevation = 0.05): THREE.Mesh {
  const texture = new THREE.DataTexture(raster.data, raster.width, raster.height, THREE.RGBAFormat);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;

  const w = raster.width * raster.cellSize;
  const h = raster.height * raster.cellSize;
  const geometry = new THREE.PlaneGeometry(w, h);
  // Like room floors: +90° about X maps plane y -> world z, so texture row 0 lands at the smallest plan y.
  geometry.rotateX(Math.PI / 2);
  const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(raster.minX + w / 2, elevation, raster.minY + h / 2);
  mesh.raycast = () => undefined; // let picks fall through to the rooms underneath
  mesh.renderOrder = 1;
  return mesh;
}
