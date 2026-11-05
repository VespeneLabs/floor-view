# Floorview

`@vespenelabs/floorview` is a TypeScript library for **viewing and editing floor plans in the browser**:

- **`FloorplanViewer`**: an interactive 2D/3D viewer (Three.js) with picking, hover tooltips, multi-level buildings and **data layers** for coloring rooms, plotting points and drawing heatmaps from live data (occupancy, sensors, air quality…).
- **`FloorplanEditor`**: an SVG editor for drawing walls, rooms and markers on a snapping grid, with selection, move/reshape, levels and undo/redo.
- A small, versioned **JSON plan format** with a validator, so plans can be stored, exchanged and loaded safely. It is also available without Three.js or the DOM as `@vespenelabs/floorview/model`, for use on a server.

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

## Installing from GitHub Packages

The package is published to GitHub Packages (`https://npm.pkg.github.com`) as a private package. To consume it:

1. Grant the consuming repository read access, once per repository: on GitHub, open **VespeneLabs → Packages → floorview → Package settings → Manage Actions access**, click **Add repository**, pick the repository (e.g. `VespeneLabs/gas-view`) and give it the **Read** role. This lets that repository's GitHub Actions install the package with its own `GITHUB_TOKEN`.
2. Point the `@vespenelabs` scope at GitHub Packages in the consumer's `.npmrc`:

   ```ini
   @vespenelabs:registry=https://npm.pkg.github.com
   //npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}
   ```

   Locally, set `NODE_AUTH_TOKEN` to a personal access token (classic) with the `read:packages` scope, from an account that can see the package. In GitHub Actions, give the job `permissions: packages: read` and set `NODE_AUTH_TOKEN: ${{ secrets.GITHUB_TOKEN }}`.
3. Install it: `npm install @vespenelabs/floorview three` (or `pnpm add`).

### Releasing

1. Bump `version` in `package.json` (e.g. `npm version 0.2.0 --no-git-tag-version`) and merge that to `main`.
2. Tag the release commit and push the tag: `git tag v0.2.0 && git push origin v0.2.0`.

The `Publish package` workflow (`.github/workflows/publish.yml`) checks that the tag matches `package.json`, then runs `npm publish`. To retry a failed publish without re-tagging, run the workflow manually (**Actions → Publish package → Run workflow**) and pick the version tag under *Use workflow from*. A run started from a branch stops at the version check. `prepublishOnly` runs the typecheck, the tests and the library build first, so `dist/` is always rebuilt from the tagged source.

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
- [AI architect](docs/architect.md): `@vespenelabs/floorview/architect` (browser tool loop) and `/architect/server` (Node, provider-agnostic models)
- [Floorview Studio](docs/studio.md): the React demo app, its stack and how it uses the library

## Requirements

- A browser with WebGL for the viewer. The editor is plain SVG.
- `three` (>= 0.160) is a **peer dependency** and is not bundled. The OrbitControls and CSS2DRenderer add-ons are bundled.
- `@anthropic-ai/sdk` (>= 1.4) is an **optional peer dependency**, needed only for `createAnthropicArchitectModel`.
