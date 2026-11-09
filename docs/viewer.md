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
  colors: { wall: '#f1f5f9', room: '#dbe3ec', marker: '#6366f1', point: '#f97316', model: '#eef1f5' },
  assets,                // ModelAsset[]: 3D models for markers with `model` (see assets.md)
});
```

The viewer appends a `.vl-viewer` element that fills `container`, and resizes with it through a `ResizeObserver`.

## Methods

| Method | Description |
| --- | --- |
| `setPlan(plan, { fit? })` | Show a plan. The viewer keeps its own copy. The camera stays put unless `fit` is true; the first plan always fits. Data layers are re-applied. |
| `getPlan()` | A copy of the shown plan, or `null`. |
| `setMode('2d' \| '3d')` / `getMode()` | Switch cameras and refit. In 2D with `level: 'all'`, only the lowest level is shown. |
| `setLevel(id \| 'all')` / `getLevel()` | Choose which levels are visible. |
| `setShowLabels(boolean)` | Toggle the plan's labels, which are the room names. Point layer labels are separate (`showLabels` on the layer). |
| `setUnderlay({ url, x, y, width, height, opacity? } \| null, levelId?)` | Show a reference image on a level's floor, under the rooms (default: first level). Kept across `setPlan`. |
| `setMovableMarkers(boolean)` | Let the user drag markers and their 3D models across the floor (also the `movableMarkers` option; snaps to `moveGrid`, default 0.25 m, Alt bypasses). The viewer moves the marker live and emits `markermove` on drop; update your plan (e.g. `editor.updateEntity`) and `setPlan`. A press without movement is a normal `click`. |
| `clientToPlan(clientX, clientY)` | The `{ levelId, position }` under viewport coordinates (room floor under the pointer, else the lowest shown level's floor plane), e.g. for a `drop` event. Null outside the viewer. |
| `setGhost({ levelId, position, size, rotation?, color? } \| null)` | A translucent placement box, e.g. where a dragged asset would land. |
| `setShowModels(boolean)` / `getShowModels()` | Show or hide markers' 3D models (also the `showModels` option). Models are always drawn decolorized; `marker.color` is their accent. |
| `setAssets(assets)` / `getAssets()` | The 3D models markers can show (`marker.model`). Rebuilds the scene; each GLB loads once and is shared. See [3D model assets](assets.md). |
| `setBackground(cssColor)` | Change the scene background, e.g. when the host switches theme. Any CSS color works, including `oklch()`. |
| `setLayer(layer)` / `removeLayer(id)` / `getLayers()` | Add or replace a data layer by `id`, or remove one. Replacing a points or heatmap layer with the same type updates it in place (see [Live updates](#live-updates)). |
| `updateLayer(id, patch)` | Merge `patch` into an existing layer and apply it like `setLayer`, e.g. `{ points }` or `{ showLabels: false }`. Returns false if there is no such layer. |
| `focus(target, { highlight? })` | Center the camera on a data point, room, wall, marker or position, keeping the zoom; switches level if needed; draws a highlight. Returns false if the target doesn't exist (see [Focus](#focus)). |
| `clearHighlight()` | Remove the focus highlight. |
| `centerOn({ levelId, position }, { animate?, duration? })` | Pan so the plan position is in the middle of the view without changing the zoom (2D) or the camera's distance and angle (3D: the orbit target moves to the position on the level's floor). Switches level if needed. Eases over `duration` ms (default 300, ease-out); `animate: false` or `prefers-reduced-motion` jumps; camera input cancels it. Returns false for an unknown level. |
| `fitView()` | Frame the visible levels. |
| `screenshot()` | PNG data URL of the current view. |
| `on(event, handler)` → unsubscribe, `off(...)` | Events (below). |
| `dispose()` | Stop rendering, free GPU resources and remove the DOM. |

## Events

```ts
viewer.on('click', ({ target, point, originalEvent }) => { ... });
viewer.on('markermove', ({ id, levelId, position }) => editor.updateEntity({ kind: 'marker', id, levelId }, { position })); // movableMarkers only
viewer.on('hover', ({ target }) => { ... });      // fires only when the hovered target changes
viewer.on('modechange', (mode) => { ... });
viewer.on('levelchange', (level) => { ... });
```

- `target` is a `PickInfo` (`{ kind: 'wall' | 'room' | 'marker' | 'point', id, levelId, layerId? }`), or `null` for empty space.
- `point` is the pointer position in **plan coordinates** (meters), or `null` if the ray missed the floor.
- A pointer that moves more than 4 px between down and up counts as a camera drag, not a click.

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
  shape: 'sphere',  // 'sphere' | 'box' | 'cylinder' | 'cone' | 'diamond', per point via `shape`
  elevation: 2.2,   // height above the level floor (m)
  tooltip: (p) => `${p.data?.temp} °C`,
  label: (p) => `${p.data?.temp} °C`, // persistent text above each point (optional)
  showLabels: true,                   // default true; toggle with updateLayer('sensors', { showLabels: false })
  visible: true,                      // default true; hide the whole layer with updateLayer('sensors', { visible: false })
});
```

Points with an unknown `levelId` are skipped. Clicking a point gives `target.kind === 'point'` and `target.layerId`.

- **Labels.** `label(point)` returns plain text shown permanently above the point (null for none), e.g. a live reading. They are independent of the plan's room labels (`setShowLabels`) and styled by `.vl-viewer__point-label` (`--vl-point-label`, `--vl-point-label-bg`).
- **Visibility.** `updateLayer(id, { visible: false })` hides the layer's points, labels, rings and beams without rebuilding anything (and stops its beams' animation frames); hidden points can't be hovered or clicked. Room names are toggled separately with `setShowLabels`, so a host can hide room names while keeping point labels, or the reverse.
- **Shapes.** `shape` (layer default, overridable per point) tells kinds of points apart, e.g. sensors, inlets and consumers. In 3D they are solids; in 2D they are flat glyphs so they stay distinguishable from above: sphere → circle, box → square, cylinder → hexagon, cone → triangle, diamond → diamond. The editor's overlay points use the same glyphs (`POINT_GLYPHS`). Changing a point's shape swaps its geometry in place. Unknown values fall back to the layer's shape, then `'sphere'`.
- **Beam.** `beam: '#dc2626'` on a point adds an animated alert beam in that color: in 3D a translucent light column from the floor to the level's wall height (fading toward the top) plus a pulsing ground ring; in 2D an expanding, fading ring. While at least one beam is on a shown level the viewer renders every frame; with none it goes back to on-demand rendering. Under `prefers-reduced-motion: reduce` the column and ring are static (and the viewer stays on demand). `null`/omitted means no beam; removing the point or its beam frees it.
- **Ring.** `ring: '#dc2626'` on a point draws an outline ring around it in that color, so an alert state can be shown separately from the status color. `null`/omitted means no ring.

### Live updates

Call `setLayer` (or `updateLayer`) again with the same `id` whenever values change. For points and heatmaps this doesn't rebuild the scene:

- **Points** are matched by `id`: existing meshes, rings and labels are updated in place (position, color, size, shape, beam, label text), new ids are added and missing ones removed. About 100 points every second is cheap.
- **Heatmaps** refill the existing texture. The cell grid and its room mask are cached per level until the plan, `resolution`, `clipToRooms` or `elevation` changes, so only the interpolation runs (with `clipToRooms: false` the grid follows the points and is rebuilt).

```ts
setInterval(async () => {
  const readings = await fetchReadings();
  viewer.updateLayer<PointLayer>('sensors', { points: readings.map(toPoint) });
  viewer.updateLayer<HeatmapLayer>('co2', { points: readings.map(toHeatmapPoint) });
}, 2000);
```

### Focus

`focus(target, options)` moves the camera to a target (keeping the zoom and, in 3D, the viewing angle), switches to the target's level if it isn't visible (emitting `levelchange`) and highlights it: a ring around points, markers and positions, an outline along rooms and walls, drawn on top of everything in the `colors.highlight` color (default amber). Use it for "Show on floor plan" links.

```ts
viewer.focus({ kind: 'point', layerId: 'sensors', id: 's1' });                    // follows the point when the layer updates
viewer.focus({ kind: 'room', id: 'room_lobby' }, { highlight: { color: '#22d3ee', duration: 4000 } });
viewer.focus({ kind: 'position', levelId: 'level_ground', position: { x: 12, y: 4 } }, { highlight: false });
```

Targets: `{ kind: 'point', layerId, id }`, `{ kind: 'room' | 'wall' | 'marker', id, levelId? }` and `{ kind: 'position', levelId, position }`. The highlight stays until `clearHighlight()`, the next `focus()` or its `duration` (ms), and survives `setPlan` while the target still exists.

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
