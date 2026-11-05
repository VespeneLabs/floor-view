# FloorplanEditor

A 2D SVG editor for one level at a time.

```ts
import { FloorplanEditor } from '@vespenelabs/floorview';

const editor = new FloorplanEditor(container, {
  plan,               // optional, defaults to createPlan()
  levelId,            // optional, defaults to the first level
  tool: 'select',     // 'select' | 'wall' | 'room' | 'marker' | 'pan'
  grid: 0.25,         // grid size in meters
  snap: true,         // snap to the grid and to existing wall endpoints / room corners
  wallThickness: 0.15,
});
```

The editor element (`.vl-editor`) is focusable: keyboard shortcuts work once the user has clicked into it.

## Tools and interactions

| Tool (key) | Interaction |
| --- | --- |
| Select (`V`) | Click to select. Drag to move (by grid steps). Drag the handles of a selected wall or room to reshape it. Drag empty space to pan. |
| Wall (`W`) | Click the start, then click each corner to add connected walls. Click the same point twice, right-click or press `Esc` to stop. |
| Room (`R`) | Click the corners. Click the first corner, press `Enter` or right-click to close (≥ 3 points). `Esc` cancels. |
| Marker (`M`) | Click to place a marker. |
| Pan (`H`) | Drag to pan. A middle-mouse drag also pans with any tool. |

| Key / modifier | Effect |
| --- | --- |
| Mouse wheel | Zoom around the cursor |
| `Shift` while drawing | Constrain to 45° steps |
| `Alt` while drawing or dragging | Turn snapping off temporarily |
| `Delete` / `Backspace` | Delete the selection |
| `Ctrl/⌘+Z`, `Ctrl/⌘+Shift+Z` or `Ctrl+Y` | Undo / redo |
| `F` | Fit the level into view |

Snapping prefers existing points within 10 px over the grid. The snap cursor turns amber when it locks onto a point.

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
| `updateEntity(ref, patch)` | Merge properties into a wall, room or marker (not its `id`). |
| `deleteSelection()` | Delete the selected entity. |
| `undo()` / `redo()` / `canUndo()` / `canRedo()` | Snapshot-based history (200 steps). |
| `setGrid(m)` / `setSnap(bool)` / `setWallThickness(m)` | Drawing settings. |
| `setUnderlay({ url, x, y, width, height, opacity? } \| null)` / `getUnderlay()` | Show a reference image (e.g. a scanned drawing) under the plan, positioned in plan meters, for tracing. Not saved in the plan. `fitView()` frames it when the level is empty. |
| `fitView()` / `dispose()` | |

Every public mutation is one undoable step. A whole drag also counts as one step.

## Events

```ts
editor.on('change', (plan) => save(plan));          // after each committed change (not on every drag move)
editor.on('selectionchange', (ref) => ...);
editor.on('toolchange', (tool) => ...);
editor.on('levelchange', (levelId) => ...);
editor.on('historychange', ({ canUndo, canRedo }) => ...);
```

Pair the editor with a viewer by forwarding `change` to `viewer.setPlan(plan)`. In the other direction, map a viewer `click` to `editor.select(...)`. Floorview Studio does both (`studio/src/features/viewer/ViewerPanel.tsx`).

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

Colors set on entities in the plan data (`room.color`, `marker.color`) take precedence. The current tool is available as `data-tool` on the element, for cursor styling.
