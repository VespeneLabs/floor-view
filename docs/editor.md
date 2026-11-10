# FloorplanEditor

A 2D SVG editor for one level at a time.

```ts
import { FloorplanEditor } from '@vespenelabs/floorview';

const editor = new FloorplanEditor(container, {
  plan,               // optional, defaults to createPlan()
  levelId,            // optional, defaults to the first level
  tool: 'select',     // 'select' | 'wall' | 'room' | 'marker' | 'pipe' | 'pan'
  grid: 0.25,         // grid size in meters
  snap: true,         // snap to the grid and to existing wall endpoints / room corners
  wallThickness: 0.15,
  tools: ['select', 'pan'], // optional: the tools the user may use (default: all)
  readOnly: false,          // optional: the user can't change the plan
  overlayPoints: [],        // optional: host-managed points on top (see below)
  assets: [],               // optional: ModelAsset[] for markers with a 3D model (see assets.md)
  pipe: { elevation: 2.6, diameter: 0.05 }, // optional: settings for new pipelines (see "Pipelines")
});
```

The editor element (`.vl-editor`) is focusable: keyboard shortcuts work once the user has clicked into it.

## Tools and interactions

| Tool (key) | Interaction |
| --- | --- |
| Select (`V`) | Click to select. Drag to move (by grid steps). Drag the handles of a selected wall, room or pipeline to reshape it. Drag empty space to pan. |
| Wall (`W`) | Click the start, then click each corner to add connected walls. Click the same point twice, right-click or press `Esc` to stop. |
| Room (`R`) | Click the corners. Click the first corner, press `Enter` or right-click to close (≥ 3 points). `Esc` cancels. |
| Marker (`M`) | Click to place a marker, or a copy of the marker template (e.g. a 3D model, see `setMarkerTemplate`). Near a pipeline, the marker goes onto the pipe as a fitting (see "Pipelines"). `Esc` clears the template. |
| Pipe (`P`) | Click each point of a pipeline. See "Pipelines" below. |
| Pan (`H`) | Drag to pan. A middle-mouse drag also pans with any tool. |

| Key / modifier | Effect |
| --- | --- |
| Mouse wheel | Zoom around the cursor |
| `Shift` while drawing | Constrain to 45° steps |
| `Alt` while drawing or dragging | Turn snapping off temporarily |
| `Delete` / `Backspace` | Delete the selection |
| `Ctrl/⌘+Z`, `Ctrl/⌘+Shift+Z` or `Ctrl+Y` | Undo / redo |
| `F` | Fit the level into view |
| `Q` / `E` (`Shift`: 90°) | Rotate the selected marker, or the template being placed, by 15° |

Snapping prefers existing points within 10 px over the grid. The snap cursor turns amber when it locks onto a point.

## Pipelines

The pipe tool draws a pipeline (`level.pipelines`, see [data model](data-model.md)) point by point:

- Segments stay **horizontal or vertical** (`Shift`: 45° steps; `Alt`: no snapping and no constraint). Points snap to the grid, and a segment that ends near a wall stops at the wall face, `thickness / 2 + pipe radius + 5 cm` from the wall's center line; a first point near a wall goes onto that line, so the pipe runs along the wall.
- New points get the **current elevation** (`getPipeSettings().elevation`, default 2.6 m). `]` / `[` or `Page Up` / `Page Down` change it by 0.1 m (`Shift`: 1 m). Changing it after a point adds a **riser** there (a vertical segment); going back to the previous height removes it again. The cursor label shows the segment length and the elevation.
- Clicking **equipment** (near a marker's center; for 3D models, within a quarter of the footprint's smaller side) attaches the pipe end (`from` / `to`) and, after the first point, finishes the pipeline. Clicking **another pipeline** starts or ends there as a tee, at that pipeline's height (a riser is added if needed); ending on one finishes. A dashed ring under the cursor shows that a click will connect.
- `Enter`, a right-click or clicking the last point again finishes; `Esc` cancels; switching tools finishes. A finished pipeline is one undo step and becomes the selection.

With the select tool, a selected pipeline shows its handles and the height of each vertex ("0.50 → 2.60 m" at a riser). Dragging a handle moves that vertex with its riser; an end dropped on equipment attaches to it, an end dragged away detaches. `Alt`-click the pipe to insert a vertex, `Alt`-click a handle to remove one. Dragging the whole pipeline detaches it from its equipment and carries its fittings along.

**Links follow edits.** When equipment moves (drag, `updateEntity`), the attached pipe end moves with it, riser included. A marker placed on a pipe is a **fitting** (`pipelineId`): it is aligned with the segment, raised so its model is centered on the pipe (`elevation`; wall-mounted models keep theirs) and, when dragged, slides along the pipe, keeping the way it faces around corners. `Alt`-drag pulls it off the pipe. Deleting equipment or a pipeline clears the links to it.

```ts
editor.setPipeSettings({ elevation: 3, diameter: 0.08, medium: 'N2', color: '#22c55e', name: 'Nitrogen' });
editor.setTool('pipe'); // the next pipelines are "Nitrogen 1", "Nitrogen 2"… with these properties
editor.on('pipesettingschange', (settings) => toolbar.update(settings)); // also fired by the elevation keys
```

## Methods

| Method | Description |
| --- | --- |
| `getPlan()` | A deep copy of the current plan. |
| `setPlan(plan, { keepHistory? })` | Replace the plan. History is cleared unless `keepHistory` is true, which makes the replacement undoable. |
| `getTool()` / `setTool(tool)` | Current tool. Switching tools finishes any room being drawn. |
| `getActiveLevel()` / `setActiveLevel(id)` | The level being edited. |
| `addLevel(name?)` / `removeLevel(id)` / `updateLevel(id, patch)` | Manage levels. The last level can't be removed. |
| `setPlanName(name)` | Rename the plan. |
| `getSelection()` / `getSelectedEntity()` / `select(ref \| null)` | Selection, as an `EntityRef` `{ kind, id, levelId }`. |
| `updateEntity(ref, patch)` | Merge properties into a wall, room, marker or pipeline (not its `id`). Pipe ends and fittings follow (see "Pipelines"). |
| `getPipeSettings()` / `setPipeSettings(patch)` | Settings for new pipelines: `elevation`, `diameter`, `medium`, `color`, `name`. Pass `undefined` to clear `medium`, `color` or `name`. |
| `deleteSelection()` | Delete the selected entity. |
| `undo()` / `redo()` / `canUndo()` / `canRedo()` | Snapshot-based history (200 steps). |
| `setGrid(m)` / `setSnap(bool)` / `setWallThickness(m)` | Drawing settings. |
| `setUnderlay({ url, x, y, width, height, opacity? } \| null)` / `getUnderlay()` | Show a reference image (e.g. a scanned drawing) under the plan, positioned in plan meters, for tracing. Not saved in the plan. `fitView()` frames it when the level is empty. |
| `availableTools()` / `setTools(tools)` | The tools the user may use. `setTool` and the keyboard shortcuts ignore the others; if the current tool is removed, the first allowed one becomes active. The editor has no toolbar of its own, so render only `availableTools()` in yours. |
| `isReadOnly()` / `setReadOnly(bool)` | Read-only mode (below). |
| `setOverlayPoints(points)` / `getOverlayPoints()` | Host-managed overlay points (below). |
| `getOverlaySelection()` / `selectOverlayPoint(id \| null)` | The selected overlay point. Selecting one clears the entity selection and vice versa. |
| `clientToPlan(clientX, clientY, { snap? })` | Client coordinates (e.g. from a `drop` event) → `{ levelId, position }` on the active level in meters, or `null` outside the editor. `snap: true` snaps like a new marker. |
| `centerOn({ levelId, position }, { animate?, duration? })` | Pan so the position is in the middle, keeping the zoom; switches level if needed. Eases over `duration` ms (default 300, ease-out); `animate: false` or `prefers-reduced-motion` jumps. User pan/zoom cancels it. Returns false for an unknown level. |
| `setAssets(assets)` / `getAssets()` | 3D models: markers with a known `model` are drawn as their rotated footprint. See [3D model assets](assets.md). |
| `setMarkerTemplate(template \| null)` / `getMarkerTemplate()` | What the marker tool places, e.g. `{ name: 'Desk', kind: 'desk', model: 'kenney/furniture/desk' }`. Names are numbered ("Desk 3"). |
| `addMarker(levelId, template, position)` | Add a marker from a template (e.g. a 3D model dropped from an asset library) as one undo step, numbered like the marker tool, and select it. Returns a copy, or null for an unknown level or read-only. |
| `rotateSelection(degrees)` | Rotate the selected marker clockwise, as one undo step. Returns false without a selected marker or in read-only mode. |
| `fitView()` / `dispose()` | |

Every public mutation is one undoable step. A whole drag also counts as one step.

## Events

```ts
editor.on('change', (plan) => save(plan));          // after each committed change (not on every drag move)
editor.on('selectionchange', (ref) => ...);
editor.on('toolchange', (tool) => ...);
editor.on('levelchange', (levelId) => ...);
editor.on('historychange', ({ canUndo, canRedo }) => ...);
editor.on('overlaypointselect', (id) => ...);                         // overlay point selected (or null)
editor.on('overlaypointmove', ({ id, levelId, position }) => ...);    // overlay point dropped after a drag
editor.on('templatechange', (template) => ...);                      // marker template set, rotated or cleared
editor.on('pipesettingschange', (settings) => ...);                  // pipe settings changed (API or elevation keys)
```

Pair the editor with a viewer by forwarding `change` to `viewer.setPlan(plan)`. In the other direction, map a viewer `click` to `editor.select(...)`. Floorview Studio does both (`studio/src/features/viewer/ViewerPanel.tsx`).

## Read-only mode

`readOnly: true` (or `setReadOnly(true)`) lets the user select, pan and zoom, but not draw, move, reshape or delete plan entities, or undo/redo from the keyboard. Only the `select` and `pan` tools are available, handles are hidden, and the element gets a `data-readonly` attribute. Selection still emits `selectionchange` (e.g. for an inspector), draggable overlay points can still be moved, and API calls (`setPlan`, `updateEntity`…) still apply.

## Overlay points

Overlay points are host data drawn on top of the plan, for example sensor positions kept in your own database. They are not part of the plan: they aren't saved with it, don't trigger `change` and have no undo history.

```ts
editor.setOverlayPoints(sensors.map((s) => ({ id: s.id, levelId: s.levelId, position: s.position, label: s.name, color: s.online ? undefined : '#94a3b8' })));

editor.on('overlaypointmove', async ({ id, levelId, position }) => {
  await api.updateSensorPosition(id, { levelId, position }); // then setOverlayPoints with the saved data
});

// Accept HTML drag-and-drop from a sensor list outside the editor:
editor.element.addEventListener('dragover', (e) => e.preventDefault());
editor.element.addEventListener('drop', (e) => {
  const target = editor.clientToPlan(e.clientX, e.clientY, { snap: true });
  if (target) placeSensor(e.dataTransfer!.getData('text/plain'), target.levelId, target.position);
});
```

- Only the active level's points are drawn, at a fixed screen size, with an optional `label`. `color` sets the fill (default `--vl-overlay`).
- `shape` picks the glyph, the same as the viewer's 2D point glyphs (`POINT_GLYPHS`): `'sphere'` → circle (default), `'box'` → square, `'cylinder'` → hexagon, `'cone'` → triangle, `'diamond'` → diamond. `ring: '#dc2626'` draws an outline ring around the point (e.g. alert state), like the viewer's `ring`. Glyphs are styled by `.vl-editor__overlay-glyph`, rings by `.vl-editor__overlay-ring`.
- With the `select` tool (also in read-only mode), clicking a point selects it (`overlaypointselect`) and dragging moves it, snapped like markers (hold `Alt` to bypass). The editor emits one `overlaypointmove` on drop and keeps showing the dropped position until you call `setOverlayPoints` again. `draggable: false` makes a point selectable only.
- `setOverlayPoints` replaces all points; calling it during a drag keeps the dragged point under the pointer.

## Styling

All editor colors come from CSS custom properties on `.vl-editor`, so a host app can theme it, including dark mode:

| Variable | Used for |
| --- | --- |
| `--vl-editor-bg` | canvas background, text halos, handle fill |
| `--vl-grid`, `--vl-grid-major` | grid lines (major lines every 5 m) |
| `--vl-wall` | walls |
| `--vl-room`, `--vl-room-stroke` | rooms without their own `color`, room outlines |
| `--vl-marker`, `--vl-marker-stroke` | markers without their own `color`, marker outline |
| `--vl-selection`, `--vl-handle` | selection outline and handles |
| `--vl-draft`, `--vl-snap` | drawing preview, snap cursor (snapped) |
| `--vl-label`, `--vl-muted` | room names, areas and measurements |
| `--vl-overlay`, `--vl-overlay-stroke` | overlay points without their own `color`, their outline (labels use `--vl-label`) |
| `--vl-pipe` | pipelines without their own `color`, risers and tees (connection targets use `--vl-snap`) |

Colors set on entities in the plan data (`room.color`, `marker.color`, `pipeline.color`) take precedence. The current tool is available as `data-tool` on the element, for cursor styling.
