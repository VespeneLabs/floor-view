# Gas kit

Industrial gas and cleanroom models made for Floorview (58): gas cylinders, dewars, a pipeline entry, wall-mounted pressure regulators and regulator panels, bundles, cages and carts, bulk supply (cryogenic tank, vaporizer, tube trailer, ISO tube container, nitrogen and hydrogen generators, compressor, purifier), gas, BSGS, chemical and safety cabinets, valve panels and boxes, a mixing panel, overhead pipe, duct and cable tray runs, safety equipment (gas detection, emergency shower, extinguishers, ESD button), cleanroom and fab equipment (process and cluster tools, wafer stocker, pass box, gowning bench, flow hoods, fume hood, lab furniture), plant (scrubber, stack, exhaust fan, chiller, AHU) and logistics (forklift, pallet jack, IBC, drums). They're built from code in Blender: `blender -b --factory-startup --python scripts/blender/gas_kit.py` writes the GLBs, the 128 px previews and `src/gas/catalog.ts`.

Units are meters. The origin is the footprint center at floor level, and the front faces glTF +Z. Materials are `body`, `panel`, `metal`, `dark` and `accent`; the viewer's clay look colors only `accent`. Previews show that clay look (all light, accent slightly darker). See `docs/assets.md`.

Part of `@vespenelabs/floorview` and covered by its license.
