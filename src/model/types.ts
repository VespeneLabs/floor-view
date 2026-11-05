/**
 * Floor plan data model.
 *
 * All lengths are in meters. Plan coordinates are 2D: `x` grows to the right and
 * `y` grows "down" the page (same as SVG). In 3D, plan `x` maps to world X,
 * plan `y` maps to world Z and world Y is up.
 */

export const PLAN_FORMAT_VERSION = 1;

export interface Point {
  x: number;
  y: number;
}

/** Arbitrary JSON-serializable metadata attached by the host application. */
export type Metadata = Record<string, unknown>;

export interface Wall {
  id: string;
  start: Point;
  end: Point;
  /** Wall thickness in meters. */
  thickness: number;
  /** Overrides the level height for this wall. */
  height?: number;
}

export interface Room {
  id: string;
  name: string;
  /** Polygon outline (at least 3 points, not closed: last point != first point). */
  points: Point[];
  /** CSS color used for the floor fill. */
  color?: string;
  data?: Metadata;
}

export interface Marker {
  id: string;
  name: string;
  position: Point;
  /** Free-form category, e.g. "desk", "sensor", "exit". */
  kind?: string;
  color?: string;
  data?: Metadata;
}

export interface Level {
  id: string;
  name: string;
  /** Height of the level floor above ground, in meters. */
  elevation: number;
  /** Default wall height, in meters. */
  height: number;
  walls: Wall[];
  rooms: Room[];
  markers: Marker[];
}

export interface FloorPlan {
  version: typeof PLAN_FORMAT_VERSION;
  id: string;
  name: string;
  levels: Level[];
}

export type EntityKind = 'wall' | 'room' | 'marker';

/** Reference to one entity inside a plan. */
export interface EntityRef {
  kind: EntityKind;
  id: string;
  levelId: string;
}

export type Entity = Wall | Room | Marker;

/**
 * A reference image (e.g. a scanned drawing) placed in plan coordinates under the plan, for
 * checking or tracing. Not part of the saved plan format.
 */
export interface Underlay {
  /** Image URL (a data: or blob: URL works). */
  url: string;
  /** Plan position (m) of the image's top-left corner. */
  x: number;
  y: number;
  /** Size of the image in plan meters. */
  width: number;
  height: number;
  /** 0–1. Default 0.5. */
  opacity?: number;
}
