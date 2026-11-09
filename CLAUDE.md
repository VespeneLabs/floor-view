# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

- **`@vespenelabs/floorview` (`src/`)** is an original, framework-free TypeScript library: a Three.js 2D/3D floor plan viewer (`FloorplanViewer`), an SVG floor plan editor (`FloorplanEditor`) and a versioned JSON plan format. It must stay free of React and Tailwind.
- **Floorview Studio (`studio/`)** is the demo app, built with React 19, Tailwind 4 and shadcn/ui (base-nova, Base UI). It imports the library from source through the `@vespenelabs/floorview` alias. Its conventions are in `.claude/rules/react.md` and `.claude/rules/styling.md`.
- **User-facing docs** live in `README.md` and `docs/`. Keep them in sync when the public API changes.
- **Product requirements** live in `.ai/prd.md` (FR-/US-/SM- IDs). Update it when a feature is added or its scope changes.

**Keep dependencies minimal.** Add a package only when the browser, React or existing code can't reasonably do the job. For example, there is no state library, toast library, `shadcn` runtime package or `tw-animate-css` (see `docs/studio.md`).

## Commands

```bash
npm run dev                 # Floorview Studio dev server (vite studio); AI import needs ANTHROPIC_API_KEY
npm run dev:mock            # same, with the scripted offline AI assistant (ARCHITECT_MOCK=1)
npm test                    # library tests: vitest run (jsdom)
npx vitest run tests/editor.test.ts -t "room"   # single file / single test
npm run typecheck           # tsc for library+tests, then tsc -p studio
npm run build               # library → dist/ (ES + UMD + CSS) + dist/types (tsconfig.build.json)
npm run build:studio        # studio → dist-studio/
```

There is no linter or formatter configured. `tsc` runs in strict mode with `noUncheckedIndexedAccess`, `noUnused*` and `verbatimModuleSyntax` (use `import type`).

**Adding shadcn components:** the CLI needs a `package.json` next to `components.json`, and `studio/` has none. Temporarily copy `studio/components.json` to the root (with `tailwind.css` set to `studio/src/styles/index.css`) and add `"paths": { "@/*": ["./studio/src/*"] }` to the root `tsconfig.json`. Run `npx shadcn@4.23.0 add <name> --yes < /dev/null` from the root, then revert both changes. Check the generated imports: anything beyond the packages already installed needs a reason.

## Architecture

- `src/model/` is pure (no DOM, no three): types, geometry, plan helpers (`plan.ts`) and `validate.ts` (`parsePlan`, a hand-written validator that reports JSON paths). Lengths are meters. Plan `y` grows **down** (SVG style), and in 3D plan `y` maps to world **Z** (Y is up). This mapping matters in `sceneBuilder.ts` and the viewer's 2D camera.
- The plan is the only shared state. The editor and viewer each keep a **private deep copy**, and plans cross the API boundary only as copies. A host wires `editor.on('change') → viewer.setPlan()`.
- **Editor** (`src/editor/Editor.ts`): every committed change goes through `mutate()`, which pushes a snapshot to `History` and then emits `change`. Drags mutate live and push one snapshot on pointer-up. `render()` redraws the whole SVG. When state changes alongside a mutation (e.g. switching the active level), do it *inside* the `mutate` callback, because `emitChange()` renders immediately.
- **Viewer** (`src/viewer/`): `sceneBuilder.ts` converts plan → meshes and is pure, so it's testable without WebGL. `Viewer.ts` rebuilds the scene on every `setPlan` and re-applies data layers. Rendering is on demand: call `requestRender()` after changing anything visual (only visible point beams render every frame, via `animateBeams` in the loop). Pickable meshes carry `userData.pick: PickInfo`. `disposeObject()` must also detach CSS2D label elements, otherwise stale labels stay frozen on screen.
- **Colors:** editor colors are CSS classes driven by `--vl-*` custom properties in `src/styles.css`; never hard-code colors in `Editor.ts`. Data-driven colors (`room.color`) are `fill` attributes, and the CSS only styles `:not([fill])`. In the viewer, always go through `toThreeColor()`, because three's parser ignores modern CSS syntax (`hsl(120 70% 50%)`, `oklch()`).
- `src/index.ts` is the public API. Export anything new from there and update `docs/`. Package subpaths (`@vespenelabs/floorview/<name>`, e.g. `/model`) live at `src/<name>/index.ts`; register a new one in `SUBPATH_ENTRIES` (`vite.config.ts`) and `exports`/`typesVersions` (package.json). `/model` must stay free of three and the DOM (`tests/model-entry.test.ts`).
- `three` is an external peer dependency in the library build. Its add-ons (`three/addons/...`) are bundled on purpose (see `vite.config.ts`).
- **3D model assets** (`src/model/assets.ts`, `src/viewer/models.ts`, subpath `/kenney`; docs in `docs/assets.md`): `marker.model` is a `ModelAsset` id, resolved against the `assets` given to the viewer and editor. `sceneBuilder` stays pure: it emits a `ModelSlot` with a placeholder box, and `Viewer` swaps in a clone from `ModelCache` (one GLB load per URL; instances share geometry/textures, flagged `userData.sharedAsset`, which `disposeObject` must not dispose). `/kenney` is pure data generated by `scripts/import-kenney.mjs` into `src/kenney/catalog.ts` (don't hand-edit); `src/kenney/descriptions.ts` is hand-written (AI descriptions plus `ai: false` exclusions; every catalog id must be in exactly one, `tests/kenney-descriptions.test.ts`); files live in `assets/kenney/` (shipped in the package, Studio's `publicDir`). Models face +z (plan +y) at rotation 0. The Gas kit (`/gas`, `assets/gas/`) is built by `blender -b --factory-startup --python scripts/blender/gas_kit.py`, which also writes `src/gas/catalog.ts` (don't hand-edit); models are always drawn as clay (`ModelStyle` in `models.ts`); `marker.color` is the accent: materials named `accent…` take it, models without such materials are tinted whole, no color means plain white.
- **Studio pages** use the URL hash (`studio/src/lib/route.ts`): the editor page (kept mounted while hidden, since it owns the plan and history) and the air quality demo (`features/air-quality/`, simulated sensors → heatmap/room/point layers).
- **AI architect** (`src/architect/`, subpaths `/architect` and `/architect/server`; docs in `docs/architect.md`): the agent is defined provider-neutrally in `server/agent.ts` (system prompt and JSON Schema tools; keep them byte-stable, they're the cached prefix) and run by `runArchitectTurn` through an `ArchitectModel` (`server/anthropic.ts` holds the Claude API call; `@anthropic-ai/sdk` is an optional peer, only dynamically imported). `ArchitectController` runs the tool loop in the browser, keeps the conversation append-only (never edit or drop earlier turns: thinking blocks must be replayed unchanged) and validates every `propose_floor_plan` input with `convertProposal` (tool inputs are untrusted and streamed unvalidated). `/architect/server` must stay free of the DOM and three, `/architect` of React (`tests/subpath-entries.test.ts`). 3D models reach the agent as request `assets`, rendered server-side by `formatAssetCatalog` into the last system block (cached; without assets the prompt is unchanged). Studio wraps it in `useArchitect.ts` and mounts `createArchitectMiddleware` in a Vite plugin (`POST /api/architect`, NDJSON). Read the `claude-api` skill before changing API usage.
- **Studio:** the editor instance is the source of truth. `useEditorSnapshot` (`useSyncExternalStore` over editor events) feeds the UI, and `ViewerPanel` effects push the snapshot and settings into the viewer. Theming reaches the library through the `.vl-studio` `--vl-*` mapping in `studio/src/styles/index.css` and `viewer.setBackground()` on theme change.

## Testing notes

Tests cover the library only and run in jsdom, which has no WebGL, layout or `ResizeObserver`. `FloorplanViewer` is therefore not unit-tested; test scene logic through `sceneBuilder`. `tests/editor.test.ts` stubs `ResizeObserver` / `getBoundingClientRect` / pointer capture and pins the editor view to 50 px/m, so pointer coordinates map to plan meters. Verify UI and viewer changes in the running studio (`npm run dev`).
