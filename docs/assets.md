# 3D model assets

Markers can be drawn as 3D models (furniture, machines, vehicles…) instead of the default marker glyph. The plan stores only a model **id**. The host passes a list of `ModelAsset`s to the viewer and the editor, which turns those ids into files and sizes:

```ts
import { FloorplanEditor, FloorplanViewer } from '@vespenelabs/floorview';
import { kenneyAssets } from '@vespenelabs/floorview/kenney';

const assets = kenneyAssets('/floorview-assets/kenney'); // where you serve the package's assets/kenney folder
const viewer = new FloorplanViewer(viewerEl, { plan, assets });
const editor = new FloorplanEditor(editorEl, { plan, assets });
```

## In the plan

```jsonc
{ "id": "item_12", "name": "Desk 3", "kind": "furniture", "position": { "x": 25.9, "y": 8.9 },
  "model": "kenney/furniture/desk", "rotation": 180, "scale": 1 }
```

| Field | Meaning |
| --- | --- |
| `model` | `ModelAsset.id`. Unknown ids (no matching asset) fall back to the normal marker glyph, so a plan never breaks when a catalog is missing. |
| `rotation` | Degrees around the vertical axis, **clockwise in plan view**. At 0° a model faces plan +y (down the page), the glTF +Z convention. Default 0. |
| `scale` | Uniform scale on top of the asset's own scale. Default 1. |
| `color` | The model's accent color (none: plain white clay). |
| `elevation` | Height above the level floor in meters (e.g. on a mezzanine or table top, or a wall-mounted model moved up). Default 0. |

The marker `position` is the **center of the model's footprint**. Models sit on the level floor; stacking (a monitor on a desk) is not supported yet.

## `ModelAsset`

```ts
interface ModelAsset {
  id: string;                 // stored in marker.model
  name: string;
  url: string;                // glTF/GLB; textures resolve relative to it
  category?: string;          // for pickers
  scale?: number;             // model units → meters (default 1)
  size: { width: number; depth: number; height: number }; // meters after `scale`: x, plan y, up
  preview?: string;           // thumbnail URL
  description?: string;       // for search and AI matching (see below)
  ai?: boolean;               // false: keep out of AI catalogs (default true)
  mounted?: boolean;          // wall-mounted: keep the file's height above its origin (default false)
}
```

Models normally sit with their lowest point on the floor, whatever the file's origin. A `mounted` asset (e.g. a wall regulator panel) is authored at its mounting height above the origin, and the viewer keeps that height; its `size.height` is the height of its top above the floor. `marker.elevation` raises or lowers any model on top of that.

`size` drives the editor footprint and the viewer's placeholder box. The viewer centers the loaded model on the marker by the model's own bounding box, whatever pivot the file has. Helpers in `@vespenelabs/floorview/model`: `indexAssets(list)`, `markerFootprint(marker, asset)` (rotated corners in plan meters) and `rotatePoint`.

## Viewer

- **Placing and moving in 3D:** `clientToPlan(x, y)` turns a drop point into a level and plan position, `setGhost()` previews the asset's box while dragging, and with `movableMarkers` the user drags models across the floor (`markermove` on drop). Together with `editor.addMarker()` a host can offer drag & drop from an asset library into the 3D view, as Studio does.

- `assets` option, `setAssets(list)` (rebuilds the scene) and `getAssets()`.
- Each GLB loads **once per URL** (`GLTFLoader`, bundled like the other three add-ons) and is shared by every marker that uses it. Until it loads, or if it fails (logged once with `[floorview]`), a translucent box of the asset's size stands in for it.
- Unlit glTF materials (`KHR_materials_unlit`, as in some Kenney kits) are converted to lit `MeshStandardMaterial`, so models shade like the walls.
- **Colors:** models are always decolorized: a matte neutral (`colors.model`, default `#eef1f5`) shaded by the model's original brightness, for a clean "white model" look whatever the source kit. A marker's `color` is the accent: models with `accent` materials (the Gas kit) color only those parts (pipes, cylinders, ducts…), other models are tinted whole, with the same shading. Without a color a model is plain white.
- **Visibility:** `showModels` option / `setShowModels(false)` hides all models (and they can't be picked), e.g. to look at the bare plan.
- Picking, hover, tooltips (the marker name) and `focus({ kind: 'marker', id })` work as for any marker. Hover lights up the whole model.
- Large scenes: each instance is a clone with its own materials. Hundreds of models are fine; for thousands, instancing would be the next step.

## Editor

- `assets` option, `setAssets(list)` and `getAssets()`. A marker with a known model is drawn as its rotated footprint, with a tick on its front edge. You can select it anywhere inside the footprint.
- `setMarkerTemplate({ name, kind, model, rotation?, scale?, color?, data? } | null)`: the marker tool places copies of the template, numbered "Desk 1", "Desk 2"…, with a dashed preview of the footprint under the cursor. `getMarkerTemplate()` returns the current template and the `templatechange` event fires when it changes.
- `Q` / `E` rotate by 15° (`Shift`: 90°). While a template with a model is active, they rotate the template; otherwise they rotate the selected marker. `rotateSelection(degrees)` does the same from code, as one undo step.
- `Esc` in the marker tool with a template clears the template and switches to select.

## The Gas kit (`@vespenelabs/floorview/gas`)

65 industrial gas and cleanroom models made for Floorview (including four wall-mounted pressure regulators: `cylinder-regulator`, `point-of-use-regulator`, `regulator-panel-2` and `regulator-panel-4`, authored at 1.3 m and marked `mounted`), in the same clean "white model with accents" style:

| Group | Models |
| --- | --- |
| Cylinders and bulk supply | gas cylinder, cylinder bank, cylinder cart, cylinder bundle (12-pack), cylinder storage cage, tube trailer, ISO tube container (MEGC), cryogenic bulk tank, ambient air vaporizer, nitrogen generator (PSA), hydrogen generator (electrolyser), air compressor skid, gas purifier |
| Cabinets and distribution | gas cabinet, BSGS cabinet, valve manifold panel, valve manifold box (VMB), gas mixing panel, overhead pipe run (2 m, 4 m), corner, tee and riser, exhaust duct run and corner, cable tray run, electrical cabinet |
| Safety | gas detection post, emergency shower / eyewash, fire extinguisher stand, safety storage cabinet, ESD push-button post |
| Cleanroom, fab and lab | process tool, cluster tool (EFEM with load ports), wafer stocker, chemical dispense cabinet, pass box, gowning bench, laminar flow hood, fume hood, lab workbench, lab stool |
| Plant and exhaust | scrubber tower, exhaust stack, exhaust fan, chiller, air handling unit |
| Logistics | forklift, pallet jack, IBC tote, drum, drums on a spill pallet |

Files are in `assets/gas/` (GLB plus a 128 px preview), ids are `floorview/gas/<model>`, sizes are real meters (no scale factor), and every model has a description for search and AI assistants (what it is, its size, how it looks on a plan drawing, where it is used, synonyms). The previews are rendered in the viewer's default clay look: light neutral throughout, accent parts only slightly darker, no color.

```ts
import { gasAssets } from '@vespenelabs/floorview/gas';
const assets = [...gasAssets('/floorview-assets/gas'), ...kenneyAssets('/floorview-assets/kenney')];
```

**Accent parts.** The models use five materials: `body`, `panel`, `metal`, `dark` and `accent`. In the clay look the body stays neutral, and only `accent` parts (cylinders, pipes, ducts, valve wheels, indicator bands) take color: the marker's `color` (without one they are white like the rest). Any model can use this convention: name a material `accent…` and the viewer colors only those parts. Models without accent materials, such as the Kenney kits, are tinted whole by the marker color.

**Building them.** The models are made from code in Blender (5.x), so they can be tweaked and regenerated:

```bash
blender -b --factory-startup --python scripts/blender/gas_kit.py               # every model
blender -b --factory-startup --python scripts/blender/gas_kit.py -- fume-hood  # just one
```

The script builds each model from bevelled boxes, cylinders and spheres, exports a GLB (front facing glTF +Z, origin at the footprint center on the floor), renders the preview with Workbench (from separate clay preview colors; the GLB keeps its own material colors, with a teal `accent`), and regenerates `src/gas/catalog.ts` (measured sizes and the descriptions, which live in the script's `MODELS` list). To add a model, write a builder function and add a `MODELS` entry.

## The Kenney catalog (`@vespenelabs/floorview/kenney`)

The package ships 795 CC0 models from 8 [Kenney](https://kenney.nl) kits in `assets/kenney/<kit>/` (GLB, a shared texture, a 64 px preview per model and the kit license). That is about 6 MB packed (23 MB unpacked). The `/kenney` entry is pure data (no three, no DOM):

| Export | |
| --- | --- |
| `kenneyAssets(baseUrl, { kits? })` | `ModelAsset[]` with ids like `kenney/furniture/desk`. `baseUrl` is where `assets/kenney` is served. |
| `KENNEY_KITS` | `furniture`, `factory`, `shop`, `station`, `prototype`, `vehicles`, `industrial`, `space`, each with its label and unit scale. |
| `kenneyAssetId(kit, model)`, `humanizeModelName(model)` | Helpers. |
| `createKenneyDemoPlan()` | A furnished demo site: a factory floor (production lines, racks, loading yard, offices, break room, first aid) and a clinic level. |

Serve the files from your app however you like, e.g. copy `node_modules/@vespenelabs/floorview/assets/kenney` into your public folder, or point Vite's `publicDir` at it as Floorview Studio does.

The kits use different units, so each kit has a scale factor picked from reference models (desk, bed, door, person, car) to give plausible sizes in meters. Use `marker.scale` to adjust individual models.

### Descriptions for AI

The [AI architect](architect.md#3d-models) places models it recognizes on a drawing by matching against `ModelAsset.description`. `kenneyAssets()` fills it from `src/kenney/descriptions.ts`, hand-written from the preview images: what the model is, how the object looks on a plan drawing, where it is typically used, and synonyms (`KENNEY_DESCRIPTIONS`, keyed by asset id). Of the 795 models, 213 are described; the other 582 get `ai: false` and are listed with a reason in `KENNEY_AI_EXCLUSIONS` (also `KENNEY_AI_EXCLUDED`, a set of ids): tabletop, wall- and ceiling-mounted items (markers stand on the floor), walls, floors, doors and building shells (the plan draws these), kit parts such as conveyor segments and pipe fittings, near-duplicate colour variants, floor markings and abstract shapes, and game or sci-fi pieces. Excluded models stay available in the asset library for manual placement.

The descriptions file is not generated. `scripts/import-kenney.mjs` warns about models that have neither a description nor an exclusion, and `tests/kenney-descriptions.test.ts` fails until every catalog id is in exactly one of the two. Your own catalog can set `description` and `ai` the same way.

To add or update kits, download them from kenney.nl and run:

```bash
node scripts/import-kenney.mjs ~/Downloads/kenney   # folder with the .zip files or extracted kits
```

It copies the files into `assets/kenney/` and regenerates `src/kenney/catalog.ts` (sizes measured from the GLB accessors). Known kits and their scales are listed at the top of the script.

Kenney assets are CC0 1.0 (public domain). Crediting "Kenney (www.kenney.nl)" is appreciated, not required.
