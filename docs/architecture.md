# Architecture

```
src/
  index.ts              public API (everything users may import) + styles.css
  model/                pure data: types, geometry, plan helpers, validation (no DOM, no three);
                        index.ts is the `@vespenelabs/floorview/model` subpath entry
  core/                 Emitter (typed events), History (snapshot undo/redo)
  viewer/
    sceneBuilder.ts     plan → Three.js meshes (pure, testable without WebGL)
    color.ts            CSS color → THREE.Color normalization
    layers.ts           data layer types (rooms, points, heatmap)
    heatmap.ts          heatmap rasterization (IDW + color stops → texture), pure and tested
    Viewer.ts           FloorplanViewer: renderer, cameras, controls, picking, layers, labels
  editor/
    Editor.ts           FloorplanEditor: tools, hit testing, snapping, drag, history, SVG rendering
    svg.ts              tiny SVG element helper
  samples.ts            createSamplePlan()
  styles.css            library CSS, themable through --vl-* custom properties
studio/                 Floorview Studio: React + shadcn/ui demo app (not part of the library build)
tests/                  Vitest + jsdom (library only)
```

## Data flow

```
          getPlan()/change event                  setPlan(copy)
Editor ───────────────────────────► host app ───────────────────────► Viewer
  ▲                                     │                               │
  └──────── select(ref) ◄── click {target: PickInfo} ◄──────────────────┘
```

- The **plan is the only shared state**. Each component keeps its **own deep copy**, and plans cross the API boundary only as copies (`clonePlan`, `structuredClone`). A caller mutating a plan it received can't corrupt a component's state.
- The editor mutates its private copy in place. Each change runs through `mutate()`, which saves a snapshot to `History` and then emits `change`. Drags change the plan live and push a single snapshot on pointer-up.
- The viewer is **rebuild-on-change**: `setPlan` disposes all meshes and rebuilds them with `sceneBuilder`. This is simple and fast enough for typical office floors (hundreds of entities). Incremental updates are on the roadmap if larger plans need them.
- Data layers live only in the viewer and are re-applied after every rebuild. Room layers recolor the existing floor materials. Point layers add mesh groups under each level group, so level visibility hides them automatically.

## Rendering details

- **Viewer:** rendering runs on demand. A `requestAnimationFrame` loop renders only when a dirty flag is set by control changes, resizes, plan or layer updates, or hover. Each room, wall and marker has its own material so it can be highlighted or recolored individually. Pickable meshes carry `userData.pick: PickInfo`.
- **Walls** are boxes stretched by their thickness, so walls meeting at a corner overlap with no gap.
- **2D mode** uses an orthographic camera placed slightly off-axis, so that screen-up is world −Z (plan −y) and the view matches the editor's orientation.
- **Editor:** each render redraws the whole SVG: a screen-space grid layer plus a world group under a `translate/scale` transform. Strokes use `vector-effect: non-scaling-stroke`, and handles and text are sized in pixels divided by the scale.

## Decisions

| Decision | Why |
| --- | --- |
| Framework-agnostic classes and DOM | Can be embedded in React, Vue or plain pages. Framework wrappers can sit on top; Studio shows the React pattern. |
| Colors through CSS custom properties | Host apps theme the editor and viewer (light/dark) without touching library code. |
| Three.js as a peer dependency | Avoids shipping two copies of three to apps that already use it. |
| Hand-written validator | No runtime dependency, and errors come with precise JSON paths. |
| Snapshot undo | Plans are small and simple, so it's robust. It can switch to command-based undo if plans grow large. |
| Subpath entries built separately | The main entry ships ES + UMD, and Vite's UMD output supports one entry only. `vite build --mode subpaths` builds the subpath entries (`/model`…) as ES + CJS into the same `dist/`. Each subpath `<name>` lives at `src/<name>/index.ts`, and `vite.aliases.ts` maps the package name to source for tests and Studio. |
| Doors as wall gaps | Keeps the format minimal for v1 (see roadmap). |

## Roadmap ideas

- Openings (doors and windows) as wall-attached entities, with cut-outs in 3D
- Multi-select, copy and paste, room auto-detection from enclosing walls
- Icon layers, a camera API (`flyTo(entity)`) and entity highlighting
- Incremental scene updates, and instancing for large point layers
- DXF/IFC import (scanned drawings: see the AI import in Floorview Studio)
