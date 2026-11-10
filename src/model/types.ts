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
  /**
   * Id of a 3D model (`ModelAsset.id`) to show instead of the default marker glyph. Resolved
   * against the assets given to the viewer/editor; unknown ids fall back to the glyph.
   */
  model?: string;
  /** Rotation around the vertical axis in degrees, clockwise in plan view. Default 0. */
  rotation?: number;
  /** Uniform scale applied to the model. Default 1. */
  scale?: number;
  /**
   * Height above the level floor in meters, e.g. a model on a mezzanine, shelf or table top, or a
   * wall-mounted model moved up or down. Added to the model's own height. Default 0.
   */
  elevation?: number;
  /**
   * Id of the pipeline this marker sits on (a valve, regulator or meter placed on a pipe). The
   * marker keeps its own position, rotation and elevation; the link tells hosts what it belongs to.
   */
  pipelineId?: string;
  data?: Metadata;
}

/** A pipeline vertex: a plan point plus its height above the level floor, in meters. */
export interface PipePoint extends Point {
  z: number;
}

/**
 * A pipe route: an open polyline in 3D. Consecutive points differ; two points with the same
 * `x`/`y` and different `z` form a vertical riser. Tees and joints between pipelines are not
 * stored: they follow from the geometry (see `pipelineJunctions`).
 */
export interface Pipeline {
  id: string;
  name: string;
  /** At least 2 points. */
  points: PipePoint[];
  /** Outer diameter in meters. */
  diameter: number;
  /** Free-form medium, e.g. "natural-gas", "N2", "compressed-air". The library never interprets it. */
  medium?: string;
  /** CSS color for the pipe; without one, the editor and viewer use their default pipe color. */
  color?: string;
  /** Id of the marker (equipment) the first point is attached to. */
  from?: string;
  /** Id of the marker (equipment) the last point is attached to. */
  to?: string;
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
  pipelines: Pipeline[];
}

export interface FloorPlan {
  version: typeof PLAN_FORMAT_VERSION;
  id: string;
  name: string;
  levels: Level[];
}

export type EntityKind = 'wall' | 'room' | 'marker' | 'pipeline';

/** Reference to one entity inside a plan. */
export interface EntityRef {
  kind: EntityKind;
  id: string;
  levelId: string;
}

export type Entity = Wall | Room | Marker | Pipeline;

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
