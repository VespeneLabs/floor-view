import type { Point } from '../model/types';

/** Shape of a data point: a solid in the 3D viewer, a flat glyph in the 2D viewer and the editor. */
export type PointShape = 'sphere' | 'box' | 'cylinder' | 'cone' | 'diamond';

export const POINT_SHAPES: readonly PointShape[] = ['sphere', 'box', 'cylinder', 'cone', 'diamond'];

/** Unknown or missing shapes fall back to `fallback`. */
export function pointShape(shape: unknown, fallback: PointShape = 'sphere'): PointShape {
  return POINT_SHAPES.includes(shape as PointShape) ? (shape as PointShape) : fallback;
}

const hexagon: Point[] = Array.from({ length: 6 }, (_, i) => ({ x: Math.cos((i * Math.PI) / 3), y: Math.sin((i * Math.PI) / 3) }));

/**
 * Top-down glyph outlines for unit size (the shape's "radius" is about 1), in plan
 * coordinates (y down, so the triangle points up on screen). `sphere` is a circle: null.
 * Shared by the 2D viewer and the editor so both draw the same glyphs:
 * sphere → circle, box → square, cylinder → hexagon, cone → triangle, diamond → diamond.
 */
export const POINT_GLYPHS: Readonly<Record<PointShape, readonly Point[] | null>> = {
  sphere: null,
  box: [
    { x: -0.85, y: -0.85 },
    { x: 0.85, y: -0.85 },
    { x: 0.85, y: 0.85 },
    { x: -0.85, y: 0.85 },
  ],
  cylinder: hexagon,
  cone: [
    { x: 0, y: -1.2 },
    { x: 1.1, y: 0.75 },
    { x: -1.1, y: 0.75 },
  ],
  diamond: [
    { x: 0, y: -1.2 },
    { x: 1.2, y: 0 },
    { x: 0, y: 1.2 },
    { x: -1.2, y: 0 },
  ],
};
