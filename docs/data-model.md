# Data model

A floor plan is a plain, JSON-serializable object (`FloorPlan`, see `src/model/types.ts`).

```jsonc
{
  "version": 1,
  "id": "plan_sample",
  "name": "VespeneLabs HQ",
  "levels": [
    {
      "id": "level_ground",
      "name": "Ground floor",
      "elevation": 0,      // floor height above ground (m)
      "height": 3,         // default wall height (m)
      "walls": [
        { "id": "wall_1", "start": { "x": 0, "y": 0 }, "end": { "x": 20, "y": 0 }, "thickness": 0.25 }
      ],
      "rooms": [
        {
          "id": "room_lobby",
          "name": "Lobby",
          "points": [{ "x": 0, "y": 7 }, { "x": 8, "y": 7 }, { "x": 8, "y": 12 }, { "x": 0, "y": 12 }],
          "color": "#bbf7d0",
          "data": { "capacity": 15 }
        }
      ],
      "markers": [
        { "id": "marker_exit", "name": "Main entrance", "kind": "exit", "position": { "x": 4, "y": 11.5 } }
      ]
    }
  ]
}
```

## Units and coordinates

- All lengths are **meters**.
- Plan coordinates are 2D, with **x to the right and y down** (like SVG). The editor draws them directly.
- In 3D, plan `x` becomes world X, plan `y` becomes world **Z**, and world Y is up. A level's `elevation` becomes the Y offset of its group.

## Entities

| Entity | Required | Optional | Notes |
| --- | --- | --- | --- |
| `Level` | `id`, `name`, `elevation`, `height`, `walls`, `rooms`, `markers` | | A plan has at least one level. New levels stack at `max(elevation + height)`. |
| `Wall` | `id`, `start`, `end`, `thickness` | `height` | A straight segment. Door openings are gaps between segments. |
| `Room` | `id`, `name`, `points` (≥ 3) | `color`, `data` | A simple polygon, not closed: the last point is not a repeat of the first. |
| `Marker` | `id`, `name`, `position` | `kind`, `color`, `model`, `rotation`, `scale`, `elevation`, `data` | A point of interest such as a desk, exit or device. With `model` (a `ModelAsset` id) it is drawn as a 3D model, rotated `rotation`° clockwise, scaled by `scale` and raised `elevation` m above the floor (see [3D model assets](assets.md)). |

`data` is free-form metadata for the host app (capacity, external ids…). The library never interprets it.

Colors can be any CSS color string. The viewer normalizes them for Three.js.

IDs must be unique across the **whole plan**. New ids come from `createId(prefix)`, e.g. `room_4f9a2c1b`.

## Validation

Use `parsePlan(unknown)` or `parsePlanJSON(string)` for any untrusted input, such as files, APIs or `localStorage`:

```ts
import { parsePlanJSON, PlanValidationError } from '@vespenelabs/floorview';

try {
  const plan = parsePlanJSON(text);
} catch (err) {
  if (err instanceof PlanValidationError) console.error(err.path, err.message); // e.g. "$.levels[0].walls[2].thickness"
}
```

The validator checks types, positive sizes, at least 3 points per room, unique ids and the `version`. Unknown properties are dropped. Coordinates may be any finite number.

### On a server (`@vespenelabs/floorview/model`)

The `@vespenelabs/floorview/model` subpath exports the plan format without Three.js or the DOM, so it can run in Node, for example to validate plans in an API before storing them:

```ts
import { parsePlan, PlanValidationError, createId, type FloorPlan } from '@vespenelabs/floorview/model';

const plan: FloorPlan = parsePlan(request.body); // throws PlanValidationError with a JSON path
```

It contains the plan types, `PLAN_FORMAT_VERSION`, `parsePlan`/`parsePlanJSON`/`PlanValidationError`, the plan helpers below (`createId`, `createPlan`, `clonePlan`…) and the geometry helpers. It ships as ES (`dist/model.js`) and CJS (`dist/model.cjs`). The main entry re-exports all of it.

The subpath is a separate bundle, so a `PlanValidationError` thrown by it is not `instanceof` the class from the main entry, and vice versa. Import both from the same entry, or check `err.name === 'PlanValidationError'`.

## Helpers

`src/model/plan.ts` and `src/model/geometry.ts` are pure and exported from the package:

- Plans: `createPlan`, `createSamplePlan` (the two-level demo office), `createLevel`, `clonePlan`, `getLevel`, `findEntity`, `removeEntity`, `translateEntity`, `entityPoints`, `levelBounds`, `nextLevelElevation`
- Geometry: `polygonArea`, `polygonCentroid`, `pointInPolygon`, `distanceToSegment`, `closestPointOnSegment`, `snapToGrid`, `snapPoint`, `constrainAngle`, `boundsOf`

## Versioning

`version` is `PLAN_FORMAT_VERSION` (currently `1`). If the format changes incompatibly, bump the version and add a migration step to `parsePlan`.
