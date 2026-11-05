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
  colors: { wall: '#f1f5f9', room: '#dbe3ec', marker: '#6366f1', point: '#f97316' },
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
| `setShowLabels(boolean)` | Toggle room labels. |
| `setUnderlay({ url, x, y, width, height, opacity? } \| null, levelId?)` | Show a reference image on a level's floor, under the rooms (default: first level). Kept across `setPlan`. |
| `setBackground(cssColor)` | Change the scene background, e.g. when the host switches theme. Any CSS color works, including `oklch()`. |
| `setLayer(layer)` / `removeLayer(id)` / `getLayers()` | Add or replace a data layer by `id`, or remove one. |
| `fitView()` | Frame the visible levels. |
| `screenshot()` | PNG data URL of the current view. |
| `on(event, handler)` → unsubscribe, `off(...)` | Events (below). |
| `dispose()` | Stop rendering, free GPU resources and remove the DOM. |

## Events

```ts
viewer.on('click', ({ target, point, originalEvent }) => { ... });
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
  elevation: 2.2,   // height above the level floor (m)
  tooltip: (p) => `${p.data?.temp} °C`,
});
```

Points with an unknown `levelId` are skipped. Clicking a point gives `target.kind === 'point'` and `target.layerId`.

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

Values are interpolated with inverse distance weighting and colored by linear interpolation between `colorStops`; values outside the stops are clamped. Each level is rasterized once per `setLayer` call into a texture on the floor, which is cheap enough to update every second for typical floors. Heatmaps are **not pickable**: hovering reaches the rooms underneath, so pair a heatmap with a room layer whose `tooltip` reports the value (`color` may return a neutral color so the heatmap reads cleanly). `interpolateIDW(points, p)` is exported to compute the same value for a single position.

Tooltips are plain text, and `\n` starts a new line. If a tooltip is open when `setLayer` or `removeLayer` runs, its text is refreshed in place. Markers that have a `name` show it as a tooltip by default.

## Styling

`style.css` defines CSS custom properties on `.vl-viewer`: `--vl-label`, `--vl-label-bg`, `--vl-tooltip-bg`, `--vl-tooltip-fg` and `--vl-font`. Label and tooltip elements use the classes `.vl-viewer__label` and `.vl-viewer__tooltip`.

Colors inside the 3D scene (background, walls, defaults) are WebGL, not CSS. Set them with the `background`/`colors` options and `setBackground()`. Colors are converted with `toThreeColor`, which accepts any CSS color.
