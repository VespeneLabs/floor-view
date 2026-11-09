# Kenney 3D models

795 models from 8 kits by [Kenney](https://www.kenney.nl), licensed **CC0 1.0** (public domain; see each kit's `License.txt`). Credit to Kenney is appreciated but not required.

Each kit folder has the GLB models, a shared `Textures/colormap.png` (where the kit uses one) and a 64 px preview per model in `previews/`. The catalog that describes them (ids, sizes in meters) is `src/kenney/catalog.ts`, exposed as `@vespenelabs/floorview/kenney`. Regenerate both with `node scripts/import-kenney.mjs <folder with the kit downloads>`. See `docs/assets.md`.
