# Floorview

`@vespenelabs/floorview` is a TypeScript library for **viewing and editing floor plans in the browser**:

- **`FloorplanViewer`**: an interactive 2D/3D viewer (Three.js) with picking, hover tooltips, multi-level buildings and **data layers** for coloring rooms, plotting points and drawing heatmaps from live data (occupancy, sensors, air quality…).
- **`FloorplanEditor`**: an SVG editor for drawing walls, rooms and markers on a snapping grid, with selection, move/reshape, levels and undo/redo.
- A small, versioned **JSON plan format** with a validator, so plans can be stored, exchanged and loaded safely.

It ships with **Floorview Studio** (`studio/`), a React + shadcn/ui demo app: an editor with a live 3D view, plus an **air quality** monitoring demo (`#/air-quality`) and an **AI import** wizard (`#/import`): upload a scanned drawing and a Claude-based assistant asks a few questions and drafts the plan with you.

## Quick start

```bash
npm install
npm run dev        # Floorview Studio (studio/) at http://localhost:5173
```

```ts
import { FloorplanEditor, FloorplanViewer, createPlan } from '@vespenelabs/floorview';
import '@vespenelabs/floorview/style.css';

const plan = createPlan('My office');
const editor = new FloorplanEditor(document.getElementById('editor')!, { plan });
const viewer = new FloorplanViewer(document.getElementById('viewer')!, { plan, mode: '3d' });

editor.on('change', (updated) => viewer.setPlan(updated));
viewer.on('click', ({ target }) => console.log('clicked', target));
```

Both components fill their container, so give the container a size.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Vite dev server for Floorview Studio (`studio/`); the AI import needs `ANTHROPIC_API_KEY` (env or `studio/.env.local`) |
| `npm run dev:mock` | Same, with a scripted offline AI assistant (no API key needed) |
| `npm run build` | Library build to `dist/` (ES + UMD + CSS) plus `.d.ts` files in `dist/types` |
| `npm run build:studio` | Static build of Floorview Studio to `dist-studio/` (`npm run preview:studio` serves it) |
| `npm run typecheck` | `tsc` over the library + tests, then over `studio/` |
| `npm test` | Vitest (jsdom) test suite |
| `npx vitest run tests/editor.test.ts -t "room"` | Run a single file / test by name |

## Documentation

- [Data model](docs/data-model.md): plan JSON format, coordinates, validation
- [Viewer](docs/viewer.md): `FloorplanViewer` API, events, data layers
- [Editor](docs/editor.md): `FloorplanEditor` API, tools, shortcuts, events
- [Architecture](docs/architecture.md): how the pieces fit together, design decisions, roadmap
- [Floorview Studio](docs/studio.md): the React demo app, its stack and how it uses the library

## Requirements

- A browser with WebGL for the viewer. The editor is plain SVG.
- `three` (>= 0.160) is a **peer dependency** and is not bundled. The OrbitControls and CSS2DRenderer add-ons are bundled.
