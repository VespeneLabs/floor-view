import type { PointShape } from '../core/shapes';
import type { Level, Point, Room } from '../model/types';

/**
 * Colors rooms from host data, e.g. occupancy or temperature.
 * When several room layers return a color for the same room, the last added layer wins.
 */
export interface RoomLayer {
  id: string;
  type: 'rooms';
  /** Return a CSS color, or null/undefined to leave the room unchanged. */
  color: (room: Room, level: Level) => string | null | undefined;
  /** Floor fill opacity for rooms this layer colors (0–1). Default 0.85. */
  opacity?: number;
  /** Hover tooltip text (plain text, not HTML). */
  tooltip?: (room: Room, level: Level) => string | null | undefined;
}

export interface PointDatum {
  id: string;
  levelId: string;
  position: Point;
  color?: string;
  /** Point "radius" in meters (the sphere radius; other shapes are about as big). */
  size?: number;
  /** Overrides the layer's `shape`. */
  shape?: PointShape;
  /** Outline ring color around the point, e.g. for alert state independent of the fill color. Null/undefined: no ring. */
  ring?: string | null;
  /**
   * Alert beam color (any CSS color). 3D: a translucent light column from the floor to the level's
   * wall height plus a pulsing ground ring; 2D: an expanding, fading ring. Static under
   * `prefers-reduced-motion`. Null/undefined: no beam.
   */
  beam?: string | null;
  data?: Record<string, unknown>;
}

/**
 * Renders data points (sensors, people, assets…) on top of the plan, as solids in 3D and flat
 * glyphs in 2D (sphere → circle, box → square, cylinder → hexagon, cone → triangle, diamond → diamond).
 * Replacing a points layer with `setLayer`/`updateLayer` updates the existing objects in place
 * (matched by point id), so frequent value updates are cheap.
 */
export interface PointLayer {
  id: string;
  type: 'points';
  points: PointDatum[];
  /** Default color for points without their own. */
  color?: string;
  /** Default radius in meters. Default 0.25. */
  size?: number;
  /** Default shape for points without their own. Default 'sphere'. */
  shape?: PointShape;
  /** Height above the level floor in meters. Default 1. */
  elevation?: number;
  tooltip?: (point: PointDatum) => string | null | undefined;
  /**
   * Persistent text label above each point (plain text), e.g. a live reading. Return null or
   * undefined for no label. Independent of the plan's room labels (`setShowLabels`).
   */
  label?: (point: PointDatum) => string | null | undefined;
  /** Show the `label`s. Default true. Toggle with `updateLayer(id, { showLabels })`. */
  showLabels?: boolean;
}

export interface HeatmapPoint {
  levelId: string;
  position: Point;
  value: number;
}

/**
 * A continuous surface interpolated from point values (inverse distance weighting), drawn on the
 * floor, e.g. CO₂ or temperature from sensors. Rendered per level as a texture; not pickable, so
 * hovering still reaches the rooms underneath (pair it with a room layer for tooltips).
 * Replacing it with new values (`setLayer`/`updateLayer`) refills the existing texture; the
 * room mask is cached until the plan or `resolution`/`clipToRooms` change.
 */
export interface HeatmapLayer {
  id: string;
  type: 'heatmap';
  points: HeatmapPoint[];
  /** Value → color stops (any CSS colors); values between stops are interpolated, outside are clamped. */
  colorStops: { value: number; color: string }[];
  /** Cell size in meters. Default 0.2 (capped at 512 cells per side). */
  resolution?: number;
  /** IDW power: higher = more local influence. Default 2. */
  power?: number;
  /** Cells farther than this (m) from every point stay transparent. Default: no limit. */
  maxDistance?: number;
  /** Only paint inside rooms. Default true. */
  clipToRooms?: boolean;
  /** 0–1. Default 0.8. */
  opacity?: number;
  /** Height above the level floor (m). Default 0.05. */
  elevation?: number;
}

export type DataLayer = RoomLayer | PointLayer | HeatmapLayer;
