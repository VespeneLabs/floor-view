# Plan: Pipelines (draw pipes next to walls)

Status: phases 1–2 done (model, editor) · 2026-11-10 · Target: 0.7.0

Our clients are mostly in the gas industry. Today a pipe is a chain of Gas kit markers
(`pipe-run`, `pipe-run-corner`, `pipe-run-tee`, `pipe-riser`) placed by hand. This feature makes a
pipeline a first-class, drawable plan entity with a **Draw pipes** button next to **Draw walls**.

## Decisions

| # | Topic | Decision |
|---|-------|----------|
| 1 | Topology | Open polyline per pipeline (`level.pipelines`). Tees and joins are **derived** from geometry, not stored. |
| 2 | Properties | `name`, `medium` (free string), `diameter` (m), `color?`, `from?`/`to?`, `data?`. Pressure, material and DN go in `data`. |
| 3 | Colors | The library uses `pipeline.color`, falling back to CSS `--vl-pipe`. Medium→color presets (DIN 2403 style) live in `/gas`. Studio fills `color` from the medium. |
| 4 | Elevation | **Per vertex**: each point has `z` (m above the level floor). |
| 5 | Z editing | The tool has a "current elevation" (default 2.6 m). `[` / `]` (and PageUp/PageDown) change it by 0.1 m (Shift: 1 m). A change at a vertex makes a vertical riser. Vertices show z labels, and the inspector has an editable vertex table. |
| 6 | Snapping | Click-click polyline. Ortho by default (Shift: free/45°). Snaps to grid, wall faces (+ pipe radius offset), marker centers and other pipelines (→ tee). Enter or double-click finishes; Escape cancels. |
| 7 | Connections | `from`/`to` marker ids. Moving or rotating a marker drags the connected end, and deleting a marker clears the ref. |
| 8 | 3D | Cylinder per segment, rounded elbows, tee caps, optional floor supports (default on above 1.5 m, every 3 m), clay shading like the Gas kit. |
| 9 | Fittings / data | Valves, regulators and meters stay markers but snap onto a pipeline (taking its z and direction, stored in a new `marker.pipelineId` field). Viewer gets pipeline picking, `setPipelineTints()` and an optional flow-direction animation. |
| 10 | Phasing | AI architect support is phase 2 (it changes the cached `propose_floor_plan` schema). |

## Data model (`src/model/types.ts`)

```ts
export interface PipePoint { x: number; y: number; /** m above the level floor */ z: number }

export interface Pipeline {
  id: string;
  name: string;
  /** ≥ 2 points; consecutive points must differ (a pure z change = vertical riser). */
  points: PipePoint[];
  /** Outer diameter in meters (2D stroke and 3D tube). */
  diameter: number;
  /** Free-form, e.g. "natural-gas", "N2", "O2", "H2", "compressed-air". */
  medium?: string;
  color?: string;
  /** Marker ids the ends are attached to. */
  from?: string;
  to?: string;
  data?: Metadata;
}

// Level: + pipelines: Pipeline[]
// EntityKind: + 'pipeline'
// Marker: + pipelineId?: string   (fitting snapped onto a pipe)
```

- Stays **format version 1**: `validate.ts` reads `o.pipelines ?? []`, like `markers`. Old plans still load. The validator checks finite numbers, ≥ 2 points, diameter > 0, unique ids (shared id space), and that `from`/`to`/`pipelineId` refs exist on the same level. Dangling refs are dropped silently (the validator has no warning channel), not treated as an error.
- `pipeline.ts` (pure): `pipelineLength`, `pipeDistance`, `isRiser`, `nearestPointOnPipeline`, `pipelineJunctions(level)` (derived tees and endpoint joints, in 3D), and `segmentRotation` for orienting fittings.
- `plan.ts`: create/update/remove helpers. Removing a marker clears `from`/`to`; removing a pipeline clears `pipelineId` on fittings.

## Editor (`src/editor/Editor.ts`, `svg.ts`, `styles.css`)

- `EditorTool` gets `'pipe'`, shortcut **P**, in `ALL_EDITOR_TOOLS` and not in `READ_ONLY_TOOLS`.
- Drawing follows the wall tool's chain logic, plus the snapping in decision 6 and the z handling in decision 5. The current elevation goes through `getPipeElevation()`/`setPipeElevation()` and a `pipeelevationchange` event, so the host toolbar can show and edit it.
- Each finished polyline is committed with one `mutate()`.
- Rendering: a `<polyline>` with stroke width = max(diameter, a minimum pixel width) and `stroke` from `color` (CSS class `.vl-pipe:not([stroke])` uses `--vl-pipe`). Risers are drawn as a ring glyph, and selected pipelines show vertex handles with z labels. Never hard-code colors.
- Select tool: drag a vertex (keeps z), drag a segment (moves both ends perpendicular, keeping ortho), Alt-click a segment to insert a vertex, Delete on a vertex to remove it. All of these push one snapshot on pointer-up.
- Marker drag/rotate: in the same mutation, update the attached pipeline ends, and update fittings by projecting them back onto their pipeline.
- Marker tool: with a template, hovering near a pipeline snaps the fitting onto it (sets `pipelineId`, rotation along the segment, `elevation` = pipe z minus the model's mount offset).

## Viewer (`src/viewer/sceneBuilder.ts`, `Viewer.ts`)

- `buildLevel` emits `built.pipelines: Map<id, Group>`. Plan (x, y, z) maps to world (x, level.elevation + z, y).
- Each segment is a `CylinderGeometry` oriented along the segment. Joints get a sphere or a short `TorusGeometry` elbow, and derived tees get a sphere cap. Supports are thin box posts from the floor at intervals on horizontal runs above the threshold.
- Material: clay `MeshStandardMaterial` tinted with `toThreeColor(color ?? defaultPipe)`.
- Pick info: `{ kind: 'pipeline', id, levelId, segment }`.
- `setPipelineTints(record, { replace })` and `setPipelineTint(id, color|null)` mirror `setMarkerTints` and are kept across `setPlan`.
- `setPipelineFlow(id, on)`: an animated dash/arrow texture along the tube. It renders every frame only while active, like `animateBeams`.
- `disposeObject` stays correct; pipe geometries are not shared.

## Gas kit (`/gas`)

- `GAS_MEDIA`: hand-written `src/gas/media.ts` (not the generated catalog): `{ id, name, color, defaultDiameter }` for natural gas, LPG, N2, O2, Ar, H2, He, CO2, compressed air, vacuum, exhaust. Exported from `/gas`.
- Keep the old `pipe-run*` models for backwards compatibility. Mark them `ai: false` in phase 2 so the AI uses real pipelines.

## Studio

- `EditorToolbar.tsx`: a **Draw pipes** button (lucide icon, shortcut P) right after **Draw walls**. While it's active, a compact sub-toolbar shows the medium select (from `GAS_MEDIA`), the diameter and the current elevation (bound to the editor events).
- `Inspector.tsx`: pipeline panel with name, medium, diameter, color, from/to (marker select), length (read-only) and the vertex table (x, y, z). Fitting markers show "on pipeline X".
- `ViewerPanel`: push tints and the flow state through settings. The air quality demo can optionally tint a pipeline red on a leak alarm.

## Docs, PRD and tests

- Docs: `docs/data-model.md` (Pipeline, PipePoint, refs), `docs/editor.md` (pipe tool, keys, elevation API), `docs/viewer.md` (tints, flow), `docs/assets.md` (fittings on pipes, `GAS_MEDIA`), `docs/studio.md`, README feature list.
- `.ai/prd.md`: FR-09 Pipelines, user stories US-056+ (draw pipeline, set elevation and riser, connect to equipment, place fitting on pipe, tint pipeline status).
- Export new types and functions from `src/index.ts` and `src/model/index.ts` (`/model` stays DOM-free).
- Tests:
  - `validate.test.ts`: v1 plans without pipelines, bad points, dangling refs.
  - `geometry` junctions and projection.
  - `editor.test.ts`: draw an ortho polyline, the elevation keys making a riser, snapping to a marker setting `from`, moving the marker dragging the end, a tee snap, a fitting snap, one undo step per action.
  - `sceneBuilder`: segment count, world-Y from z, supports threshold, pick info.

## Phases

1. ✅ **Model + validator + geometry** (pure, fully tested in `tests/pipeline.test.ts`). `Level.pipelines` is required in the type and normalized by `parsePlan`/`createLevel`, so the editor and viewer (which don't validate on `setPlan`) should still guard against hand-built plans without it.
2. ✅ **Editor pipe tool + selection editing + marker coupling** (`tests/editor-pipes.test.ts`), plus a minimal Studio UI for hand testing (Draw pipes button, height/Ø bar, pipeline inspector; `CommitInput` moved to `studio/src/components/`). Deviations from the plan above: settings are one `setPipeSettings`/`getPipeSettings` + `pipesettingschange` (not separate elevation calls); Alt-click inserts/removes vertices (no "segment drag", no Delete-on-vertex); markers snap only near their center (whole-footprint snapping hijacked clicks in furnished plans, found in Studio); fitting rotation is updated when a fitting slides or its pipeline is reshaped, not on every sync; a segment touching moved equipment can become diagonal (no auto re-orthogonalising).
3. **3D rendering + picking + tints**, then the flow animation.
4. **Studio UI** (toolbar button, sub-toolbar, inspector), plus docs and PRD → release 0.7.0.
5. **Phase 2:** AI architect (`pipelines` in `propose_floor_plan`, `convertProposal` validation, prompt guidance, `/gas` media in the asset catalog), and later auto-routing (source → target, orthogonal along walls).

## Risks / open points

- **Z editing in 2D** is the riskiest UX part. Prototype it in Studio early (phase 2) and verify by hand in `npm run dev`.
- **Overlapping pipes** at the same xy but different z can't be told apart in 2D. Draw the higher z on top and show a z tooltip on hover.
- **Wall penetrations** are not modelled. A pipe crossing a wall is fine visually; sleeves are out of scope.
