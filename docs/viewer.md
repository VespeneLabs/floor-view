# FloorplanViewer

An interactive Three.js view of a plan, in 3D (orbit camera) or 2D (top-down orthographic camera).

```ts
import { FloorplanViewer } from '@vespenelabs/floorview';
import '@vespenelabs/floorview/style.css';

const viewer = new FloorplanViewer(container, {
  plan,                  // FloorPlan, optional (call setPlan later)
  mode: '3d',            // '3d' | '2d'
  level: 'all',          // a level id, or 'all' (3D shows every level stacked)
  background: '#f8fafc',
  showLabels: true,      // room name labels
  colors: { wall: '#f1f5f9', room: '#dbe3ec', marker: '#6366f1', point: '#f97316', model: '#eef1f5', pipe: '#ca8a04' },
  assets,                // ModelAsset[]: 3D models for markers with `model` (see assets.md)
});
```

The viewer appends a `.vl-viewer` element that fills `container`, and resizes with it through a `ResizeObserver`.

## Pipelines

Pipelines (see [data model](data-model.md)) are drawn as tubes of their real diameter at their points' heights, in `pipeline.color` (or `colors.pipe`): a cylinder per segment, rounded joints at bends, and a fitting body where one pipeline meets another (tee or joint). There are no supports or hangers; place the Gas kit's `pipe-floor-support` model for those (see [assets](assets.md#pipe-media)). From far away a pipe of a few centimeters would be thinner than a pixel, so pipes (with their joints, tees and flow beads) are drawn at least `pipeMinWidth` pixels wide (option, default 2.5; `setPipeMinWidth(px)`, 0 for the real diameter always) and at their real size up close. For the same reason each segment also has an invisible pick cylinder at least 15 cm in radius: hovering lights up the whole pipeline, the tooltip shows its name, medium and diameter, and a click reports `{ kind: 'pipeline', id, levelId }`. Fittings (markers with `pipelineId`) are ordinary markers raised to the pipe by their `elevation`.

## Methods

| Method | Description |
| --- | --- |
| `setPlan(plan, { fit? })` | Show a plan. The viewer keeps its own copy. The camera stays put unless `fit` is true; the first plan always fits. Data layers are re-applied. |
| `getPlan()` | A copy of the shown plan, or `null`. |
| `setMode('2d' \| '3d')` / `getMode()` | Switch cameras and refit. In 2D with `level: 'all'`, only the lowest level is shown. |
| `setLevel(id \| 'all')` / `getLevel()` | Choose which levels are visible. |
| `setDragOut(boolean)` / `getDragOut()` | Let the user drag entities and data points out of the viewer as references (also the `dragOut` option). See [Drag-out](#drag-out). |
| `setShowLabels(boolean)` | Toggle the plan's labels, which are the room names. Point layer labels are separate (`showLabels` on the layer). |
| `setUnderlay({ url, x, y, width, height, opacity? } \| null, levelId?)` | Show a reference image on a level's floor, under the rooms (default: first level). Kept across `setPlan`. |
| `setMovableMarkers(boolean)` | Let the user drag markers and their 3D models across the floor (also the `movableMarkers` option; snaps to `moveGrid`, default 0.25 m, Alt bypasses). The viewer moves the marker live and emits `markermove` on drop; update your plan (e.g. `editor.updateEntity`) and `setPlan`. A press without movement is a normal `click`. |
| `clientToPlan(clientX, clientY)` | The `{ levelId, position }` under viewport coordinates (room floor under the pointer, else the lowest shown level's floor plane), e.g. for a `drop` event. Null outside the viewer. |
| `setGhost({ levelId, position, size, rotation?, color? } \| null)` | A translucent placement box, e.g. where a dragged asset would land. |
| `setMarkerTints({ [markerId]: color \| null }, { replace? })` / `setMarkerTint(id, color \| null)` / `getMarkerTints()` | Host-managed state colors, e.g. red for an alarm or amber for low stock. A tint colors a marker's whole 3D model (all parts, clay shading kept) or its glyph, and wins over `marker.color`. The `markerTintStrength` option (0–1, default 1) mixes the tint with the model's clay or the glyph's color, e.g. 0.5 for a softer tint. Not plan data: updates in place without a rebuild, kept across `setPlan`. `replace: true` clears tints not listed. |
| `setPipelineTints({ [pipelineId]: color \| null }, { replace? })` / `setPipelineTint(id, color \| null)` / `getPipelineTints()` | The same for pipelines, e.g. red for a leak alarm: the tint replaces the pipe color. In place, kept across `setPlan`. |
| `setPipelineFlow(id, 'forward' \| 'reverse' \| null)` / `setPipelineFlows({ [id]: direction \| null }, { replace? })` / `getPipelineFlows()` | Show the flow in a pipeline as beads moving along it (`forward`: from its first point to its last). Kept across `setPlan`. The viewer renders every frame only while beads are visible; with `prefers-reduced-motion` they stand still. |
| `setPipeMinWidth(px)` / `getPipeMinWidth()` | Minimum on-screen width of pipelines in pixels (default 2.5; 0 draws the real diameter always). |
| `setShowModels(boolean)` / `getShowModels()` | Show or hide markers' 3D models (also the `showModels` option). Models are always drawn decolorized; `marker.color` is their accent. |
| `setWallDisplay('full' \| 'low')` / `getWallDisplay()` | Draw walls at their real height or, in 3D, as low stubs that don't hide what is inside a room (also the `wallDisplay` option, default `'full'`). See [Low walls](#low-walls). |
| `setAssets(assets)` / `getAssets()` | The 3D models markers can show (`marker.model`). Rebuilds the scene; each GLB loads once and is shared. See [3D model assets](assets.md). |
| `setBackground(cssColor)` | Change the scene background, e.g. when the host switches theme. Any CSS color works, including `oklch()`. |
| `setLayer(layer)` / `removeLayer(id)` / `getLayers()` | Add or replace a data layer by `id`, or remove one. Replacing a points or heatmap layer with the same type updates it in place (see [Live updates](#live-updates)). |
| `updateLayer(id, patch)` | Merge `patch` into an existing layer and apply it like `setLayer`, e.g. `{ points }` or `{ showLabels: false }`. Returns false if there is no such layer. |
| `focus(target, { highlight? })` | Center the camera on a data point, room, wall, marker, pipeline or position, keeping the zoom; switches level if needed; draws a highlight. Returns false if the target doesn't exist (see [Focus](#focus)). |
| `clearHighlight()` | Remove the focus highlight. |
| `centerOn({ levelId, position }, { animate?, duration? })` | Pan so the plan position is in the middle of the view without changing the zoom (2D) or the camera's distance and angle (3D: the orbit target moves to the position on the level's floor). Switches level if needed. Eases over `duration` ms (default 300, ease-out); `animate: false` or `prefers-reduced-motion` jumps; camera input cancels it. Returns false for an unknown level. |
| `planToClient(levelId, position, elevation?)` | Client coordinates `{ x, y, visible }` of a plan position, `elevation` meters above the level floor: the counterpart of `clientToPlan`, e.g. to open a popover. `visible` is false when the level is hidden or the position is behind the camera or outside the viewer; null for an unknown level. A snapshot: use `setOverlay` to keep an element attached. |
| `setOverlay(overlay)` / `removeOverlay(id)` / `getOverlays()` | Keep a host HTML element attached to a plan position, marker or data point (see [Overlays](#overlays-host-html-on-the-plan)). |
| `fitView()` | Frame the visible levels. The mouse wheel zooms toward the pointer (down to 30 cm from a surface in 3D). |
| `screenshot()` | PNG data URL of the current view. |
| `on(event, handler)` → unsubscribe, `off(...)` | Events (below). |
| `dispose()` | Stop rendering, free GPU resources and remove the DOM. |

## Low walls

In 3D, full-height walls can hide what stands in a room. `setWallDisplay('low')` (or the `wallDisplay` option) draws every wall of every level as a stub instead, so the rooms still read:

```ts
const viewer = new FloorplanViewer(el, { plan, wallDisplay: 'low', lowWallHeight: 0.5 });
viewer.setWallDisplay('full'); // back to the real heights
```

- **Height.** Stubs are `lowWallHeight` meters high (option, default 0.3), whatever `level.height` and `wall.height` say. A wall that is already lower keeps its height.
- **A display setting**, like `setShowModels`: it is applied in place (no scene rebuild), kept across `setPlan`, and leaves the camera and `getPlan()` alone. `fitView()` frames the plan as if the walls were full height, so the framing doesn't depend on it.
- **Only walls change.** Models (also wall-mounted ones), pipelines, points and their alert beams, labels and overlays stay where they are; they read heights from the plan, not from the drawn walls.
- **Picking.** Low walls are still `wall` targets for `click` / `hover`, and `focus({ kind: 'wall', id })` works as before. Because they are low, they no longer cover what is behind them, so those things can be picked and dragged.
- **2D** always draws walls in full (seen from above they look the same); the setting takes effect again when you switch back to 3D.

The plan format has no doors, windows or other openings, so walls are solid boxes in both displays.

## Events

```ts
viewer.on('click', ({ target, point, originalEvent }) => { ... });
viewer.on('markermove', ({ id, levelId, position }) => editor.updateEntity({ kind: 'marker', id, levelId }, { position })); // movableMarkers only
viewer.on('pointmove', ({ layerId, id, levelId, position }) => { ... });  // draggable points only: save it, then setLayer/updateLayer
viewer.on('entitydragout', ({ ref, clientX, clientY }) => { ... });      // dragOut only: a drag left the viewer
viewer.on('hover', ({ target }) => { ... });      // fires only when the hovered target changes
viewer.on('modechange', (mode) => { ... });
viewer.on('levelchange', (level) => { ... });
viewer.on('render', () => { ... });               // a frame was drawn: screen positions may have changed
```

- `target` is a `PickInfo` (`{ kind: 'wall' | 'room' | 'marker' | 'pipeline' | 'point', id, levelId, layerId? }`), or `null` for empty space.
- `point` is the pointer position in **plan coordinates** (meters), or `null` if the ray missed the floor.
- A pointer that moves more than 4 px between down and up counts as a camera drag, not a click.

## Drag-out

With `dragOut: true` (or `setDragOut(true)`), a drag that starts on a room, wall, marker, pipeline or data point and leaves the viewer emits `entitydragout` once, with `ref` (a `PickInfo`, with `layerId` for a data point), `clientX`, `clientY` and `originalEvent`. The host can then let the user drop a reference to it on its own element; see the [editor's drag-out](editor.md#drag-out) for a handler, which is the same here.

- The viewer cancels what the drag did: a marker or point being moved goes back without `markermove` / `pointmove`, and a camera orbit or pan that began on the entity is undone.
- The pointer is still down and the gesture is the host's. Nothing resumes in the viewer if the pointer comes back, and the release is not a `click`.
- A drag that starts on empty space moves the camera as usual. Off by default.

## Data layers

Layers overlay host data on the plan without changing the plan itself. To update a layer, call `setLayer` again with the same `id`. The demo does this every 3 s to simulate live data.

### Room layer: color rooms by a value

```ts
viewer.setLayer({
  id: 'occupancy',
  type: 'rooms',
  color: (room, level) => {
    const ratio = occupancy[room.id];
    return ratio === undefined ? null : `hsl(${130 - ratio * 130} 70% 55%)`; // null = leave unchanged
  },
  opacity: 0.85,
  tooltip: (room) => `${room.name}\n${Math.round(occupancy[room.id]! * 100)}%`,
});
```

If several room layers color the same room, the **last added** one wins. The same rule applies to tooltips.

### Point layer: plot points

```ts
viewer.setLayer({
  id: 'sensors',
  type: 'points',
  points: [{ id: 's1', levelId: 'level_ground', position: { x: 4, y: 9 }, color: '#ef4444', data: { temp: 24.1 } }],
  size: 0.2,        // sphere radius (m), per point via `size`
  shape: 'sphere',  // 'sphere' | 'box' | 'cylinder' | 'cone' | 'diamond' | 'none', per point via `shape`
  elevation: 2.2,   // height above the level floor (m), per point via `elevation`
  draggable: false, // let the user drag the points (default false), per point via `draggable`
  tooltip: (p) => `${p.data?.temp} °C`,
  label: (p) => `${p.data?.temp} °C`, // persistent text above each point (optional)
  showLabels: true,                   // default true; toggle with updateLayer('sensors', { showLabels: false })
  visible: true,                      // default true; hide the whole layer with updateLayer('sensors', { visible: false })
});
```

Points with an unknown `levelId` are skipped. Clicking a point gives `target.kind === 'point'` and `target.layerId`.

- **Labels.** `label(point)` returns plain text shown permanently above the point (null for none), e.g. a live reading. They are independent of the plan's room labels (`setShowLabels`) and styled by `.vl-viewer__point-label` (`--vl-point-label`, `--vl-point-label-bg`).
- **Visibility.** `updateLayer(id, { visible: false })` hides the layer's points, labels, rings and beams without rebuilding anything (and stops its beams' animation frames); hidden points can't be hovered or clicked. Room names are toggled separately with `setShowLabels`, so a host can hide room names while keeping point labels, or the reverse.
- **Shapes.** `shape` (layer default, overridable per point) tells kinds of points apart, e.g. sensors, inlets and consumers. In 3D they are solids; in 2D they are flat glyphs so they stay distinguishable from above: sphere → circle, box → square, cylinder → hexagon, cone → triangle, diamond → diamond. The editor's overlay points use the same glyphs (`POINT_GLYPHS`). Changing a point's shape swaps its geometry in place. Unknown values fall back to the layer's shape, then `'sphere'`. `'none'` (viewer only, not in `POINT_SHAPES`) draws no shape: the point's label, ring and beam still show at its position and height, e.g. a reading on top of a 3D model that already stands for the item. Such a point can't be hovered (no tooltip), clicked or dragged, since there is nothing to hit; `focus()` still finds it.
- **Beam.** `beam: '#dc2626'` on a point adds an animated alert beam in that color: in 3D a translucent light column from the floor to the level's wall height (fading toward the top) plus a pulsing ground ring; in 2D an expanding, fading ring. While at least one beam is on a shown level the viewer renders every frame; with none it goes back to on-demand rendering. Under `prefers-reduced-motion: reduce` the column and ring are static (and the viewer stays on demand). `null`/omitted means no beam; removing the point or its beam frees it. The layer's `beamStyle` changes the look of its beams: `opacity` (multiplies the column and ring opacity, default 1), `period` (ms per pulse, default 1600), `spread` (how far the ring expands, as a multiple of the point radius, default 3.5) and `width` (the column radius as a multiple of the point radius, default 0.85), e.g. `{ opacity: 0.5, period: 2400, spread: 2.5, width: 0.6 }` for a quieter beam. Missing or invalid values keep the default.
- **Height.** `elevation` on a point (meters above the level floor) overrides the layer's `elevation` (default 1), so each point can sit at its real mounting height. The ring and label follow it; a beam still starts at the floor and reaches the wall height, or the top of the point when that is higher.
- **Dragging.** With `draggable: true` on the layer (or on single points; a point's own `draggable` wins) the user can drag points in 2D and 3D, like markers with `movableMarkers`: the point moves live on the horizontal plane at its own height, snapped to `moveGrid` (default 0.25 m, Alt bypasses), with a "grab" cursor on hover. On drop the viewer emits `pointmove` with `{ layerId, id, levelId, position }`. It does not change the layer: save the position and call `setLayer`/`updateLayer`, otherwise the next update puts the point back. A press without movement is a normal `click`. A layer update during a drag (live values) keeps the dragged point under the pointer; the drag is cancelled if the update removes the point, moves it to another level or makes it undraggable. Dragging stays on the point's level and doesn't change its height.
- **Ring.** `ring: '#dc2626'` on a point draws an outline ring around it in that color, so an alert state can be shown separately from the status color. `null`/omitted means no ring. The layer's `ringOpacity` (0–1, default 1) makes its rings translucent.

### Overlays: host HTML on the plan

For anything richer than a text label (an info card with a toggle, a chart, a menu) give the viewer your own element and an anchor; it keeps the element attached while the camera, the plan and the data change.

```ts
const card = document.createElement('div'); // render into it however you like (React portal, lit, plain DOM)
viewer.setOverlay({
  id: 'tank-1',
  element: card,
  anchor: { kind: 'marker', id: 'marker_tank1' },
  // or { levelId, position: { x, y }, elevation?: 1.5 }   a plan position, meters above the level floor
  // or { kind: 'point', layerId: 'sensors', id: 's1' }    a point of a points layer
  align: { x: 0.5, y: 1 },   // which point of the element sits on the anchor; default bottom center (element above)
  offset: { x: 0, y: -8 },   // extra screen offset in px (y down)
  onVisibilityChange: (visible) => { ... },
});
viewer.removeOverlay('tank-1'); // detaches the element and hands it back
```

- **Anchors.** A marker anchor sits at the top of what the marker shows (its 3D model, the placeholder box while it loads, or the glyph), so with the default `align` the element stands above the model. It stays there with `setShowModels(false)`. A point anchor sits at the top of the point and follows its per-point `elevation`; with `shape: 'none'` that is still `size` above the point's position. Marker and point anchors follow their target live, also while the user drags it, and through `setPlan` and layer updates. An overlay whose marker, point or level doesn't exist is kept and appears when the target does.
- **Visibility.** An overlay is hidden with its level, with its point layer (`visible: false`), while its anchor doesn't exist and when the anchor is behind the camera; `onVisibilityChange` reports each change and the initial state. Walls and models in front do **not** hide it, and an anchor outside the viewer just leaves the element clipped at the edge (check `getBoundingClientRect()` or `planToClient().visible` if you need to know). Overlays nearer to the camera are drawn on top of farther ones (the viewer sets the wrapper's `z-index` every frame).
- **Pointer input.** Overlays take pointer events, unlike labels: buttons and links in them work, a click on an overlay does not fire the viewer's `click` for what is underneath, and a drag that starts on one does not orbit or pan. The mouse wheel over an overlay zooms the view as it does over the canvas, unless the element under the pointer scrolls itself (`overflow-y: auto/scroll` with overflowing content) or your own handler called `preventDefault()`.
- **The element is yours.** The viewer wraps it in a positioned `div.vl-viewer__overlay` and never styles or reads the element itself; size and style it freely. Calling `setOverlay` again with the same `id` updates anchor, `align` and `offset` in place (and swaps the element if you pass another).
- **Declutter.** The viewer doesn't resolve collisions between overlays. To do it yourself, listen to `render` (fired after each drawn frame; rendering is on demand, so it is quiet while nothing moves), measure your elements and restyle them. Don't call viewer methods from that handler unless something changed, since each call draws another frame.

### Live updates

Call `setLayer` (or `updateLayer`) again with the same `id` whenever values change. For points and heatmaps this doesn't rebuild the scene:

- **Points** are matched by `id`: existing meshes, rings and labels are updated in place (position, elevation, color, size, shape, beam, label text), new ids are added and missing ones removed. About 100 points every second is cheap.
- **Heatmaps** refill the existing texture. The cell grid and its room mask are cached per level until the plan, `resolution`, `clipToRooms` or `elevation` changes, so only the interpolation runs (with `clipToRooms: false` the grid follows the points and is rebuilt).

```ts
setInterval(async () => {
  const readings = await fetchReadings();
  viewer.updateLayer<PointLayer>('sensors', { points: readings.map(toPoint) });
  viewer.updateLayer<HeatmapLayer>('co2', { points: readings.map(toHeatmapPoint) });
}, 2000);
```

### Focus

`focus(target, options)` moves the camera to a target (keeping the zoom and, in 3D, the viewing angle), switches to the target's level if it isn't visible (emitting `levelchange`) and highlights it: a ring around points, markers and positions, an outline along rooms, walls and pipelines (a pipeline is centered on the middle of its length, at its height), drawn on top of everything in the `colors.highlight` color (default amber). Use it for "Show on floor plan" links.

```ts
viewer.focus({ kind: 'point', layerId: 'sensors', id: 's1' });                    // follows the point when the layer updates
viewer.focus({ kind: 'room', id: 'room_lobby' }, { highlight: { color: '#22d3ee', duration: 4000 } });
viewer.focus({ kind: 'position', levelId: 'level_ground', position: { x: 12, y: 4 } }, { highlight: false });
```

Targets: `{ kind: 'point', layerId, id }`, `{ kind: 'room' | 'wall' | 'marker' | 'pipeline', id, levelId? }` and `{ kind: 'position', levelId, position }`. The highlight stays until `clearHighlight()`, the next `focus()` or its `duration` (ms), and survives `setPlan` while the target still exists.

### Heatmap layer: interpolate values across the floor

```ts
viewer.setLayer({
  id: 'co2',
  type: 'heatmap',
  points: sensors.map((s) => ({ levelId: s.levelId, position: s.position, value: s.co2 })),
  colorStops: [
    { value: 400, color: '#22c55e' },
    { value: 800, color: '#eab308' },
    { value: 1200, color: '#f97316' },
    { value: 1600, color: '#dc2626' },
  ],
  resolution: 0.15,   // cell size (m), default 0.2; capped at 512 cells per side
  power: 2.5,         // inverse-distance-weighting power, default 2 (higher = more local)
  maxDistance: 8,     // optional: cells farther from every point stay transparent
  clipToRooms: true,  // default: paint only inside rooms
  opacity: 0.85,
});
```

Values are interpolated with inverse distance weighting and colored by linear interpolation between `colorStops`; values outside the stops are clamped. Each level is rasterized into a texture on the floor; later `setLayer` calls with new values refill it in place (see [Live updates](#live-updates)). Heatmaps are **not pickable**: hovering reaches the rooms underneath, so pair a heatmap with a room layer whose `tooltip` reports the value (`color` may return a neutral color so the heatmap reads cleanly). `interpolateIDW(points, p)` is exported to compute the same value for a single position.

Tooltips are plain text, and `\n` starts a new line. If a tooltip is open when `setLayer` or `removeLayer` runs, its text is refreshed in place. Markers that have a `name` show it as a tooltip by default.

## Styling

`style.css` defines CSS custom properties on `.vl-viewer`: `--vl-label`, `--vl-label-bg`, `--vl-point-label`, `--vl-point-label-bg`, `--vl-tooltip-bg`, `--vl-tooltip-fg` and `--vl-font`. Label and tooltip elements use the classes `.vl-viewer__label`, `.vl-viewer__point-label` and `.vl-viewer__tooltip`.

Colors inside the 3D scene (background, walls, defaults, the focus highlight) are WebGL, not CSS. Set them with the `background`/`colors` options and `setBackground()`. Colors are converted with `toThreeColor`, which accepts any CSS color.
