#!/usr/bin/env node
/**
 * Imports Kenney (kenney.nl, CC0) 3D kits into assets/kenney/ and regenerates the catalog in
 * src/kenney/catalog.ts.
 *
 *   node scripts/import-kenney.mjs <folder with the kits>
 *
 * The folder may hold the downloaded .zip files or already extracted kit folders. For each known
 * kit this copies the GLB models, their shared texture, one preview image per model and the
 * license, then measures every model (bounding box from the glTF accessors, no WebGL needed) so the
 * catalog can carry footprints in meters. Descriptions live in src/kenney/descriptions.ts, which
 * this script only reads: it warns about models that have neither a description nor an AI exclusion.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Box3, Matrix4, Quaternion, Vector3 } from 'three';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT = path.join(ROOT, 'assets/kenney');
const CATALOG = path.join(ROOT, 'src/kenney/catalog.ts');
/** Hand-written descriptions and AI exclusions; never overwritten by this script. */
const DESCRIPTIONS = path.join(ROOT, 'src/kenney/descriptions.ts');

/**
 * Known kits. `scale` converts the kit's model units to meters: Kenney kits are stylized and
 * use different units, so each factor was chosen from reference models (a desk, a bed, a door,
 * a person, a car) to give plausible real-world sizes.
 */
const KITS = [
  { match: 'kenney_furniture-kit', id: 'furniture', label: 'Furniture', scale: 2, preview: { dir: 'Isometric', suffix: '_SE' } },
  { match: 'kenney_factory-kit', id: 'factory', label: 'Factory', scale: 1.3 },
  { match: 'kenney_mini-shop', id: 'shop', label: 'Shop', scale: 2.3 },
  { match: 'kenney_space-station-kit', id: 'station', label: 'Station', scale: 2 },
  { match: 'kenney_prototype-kit', id: 'prototype', label: 'Prototype', scale: 2 },
  { match: 'kenney_car-kit', id: 'vehicles', label: 'Vehicles', scale: 1.75 },
  { match: 'kenney_city-kit-industrial', id: 'industrial', label: 'Industrial', scale: 7.5 },
  { match: 'kenney_space-kit', id: 'space', label: 'Space', scale: 3, preview: { dir: 'Isometric', suffix: '_SE' } },
];

const source = process.argv[2];
if (!source) {
  console.error('usage: node scripts/import-kenney.mjs <folder with Kenney kits (.zip or extracted)>');
  process.exit(1);
}

/** Extracts the zips (if any) into a temp folder and returns kit folders by name. */
function kitFolders(dir) {
  const folders = new Map();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kenney-'));
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) folders.set(entry.name, full);
    else if (entry.name.endsWith('.zip')) {
      const target = path.join(tmp, entry.name.replace(/\.zip$/, ''));
      execFileSync('unzip', ['-qo', full, '-d', target]);
      folders.set(path.basename(target), target);
    }
  }
  return folders;
}

/** Bounding box of a GLB's default scene, from accessor min/max and node transforms. */
function glbBox(file) {
  const buf = fs.readFileSync(file);
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error(`${file}: not a GLB`);
  const json = JSON.parse(buf.subarray(20, 20 + buf.readUInt32LE(12)).toString('utf8'));
  const box = new Box3();
  const visit = (index, parent) => {
    const node = json.nodes[index];
    const local = new Matrix4();
    if (node.matrix) local.fromArray(node.matrix);
    else {
      local.compose(
        new Vector3(...(node.translation ?? [0, 0, 0])),
        new Quaternion(...(node.rotation ?? [0, 0, 0, 1])),
        new Vector3(...(node.scale ?? [1, 1, 1])),
      );
    }
    const world = parent.clone().multiply(local);
    if (node.mesh !== undefined) {
      for (const primitive of json.meshes[node.mesh].primitives) {
        const accessor = json.accessors[primitive.attributes.POSITION];
        box.union(new Box3(new Vector3(...accessor.min), new Vector3(...accessor.max)).applyMatrix4(world));
      }
    }
    for (const child of node.children ?? []) visit(child, world);
  };
  for (const root of json.scenes[json.scene ?? 0].nodes) visit(root, new Matrix4());
  return box;
}

const round = (v) => Math.round(v * 100) / 100;
const folders = kitFolders(source);
fs.rmSync(OUT, { recursive: true, force: true });
const rows = [];
const ids = [];
const kits = [];

for (const kit of KITS) {
  const name = [...folders.keys()].find((n) => n.startsWith(kit.match));
  if (!name) {
    console.warn(`skip ${kit.id}: no folder starting with ${kit.match}`);
    continue;
  }
  const dir = folders.get(name);
  const modelsDir = ['Models/GLB format', 'Models/GLTF format'].map((d) => path.join(dir, d)).find((d) => fs.existsSync(d));
  if (!modelsDir) throw new Error(`${name}: no GLB folder`);
  const out = path.join(OUT, kit.id);
  fs.mkdirSync(path.join(out, 'previews'), { recursive: true });
  if (fs.existsSync(path.join(modelsDir, 'Textures'))) fs.cpSync(path.join(modelsDir, 'Textures'), path.join(out, 'Textures'), { recursive: true });
  fs.copyFileSync(path.join(dir, 'License.txt'), path.join(out, 'License.txt'));

  let count = 0;
  for (const file of fs.readdirSync(modelsDir).filter((f) => f.endsWith('.glb')).sort()) {
    const model = file.replace(/\.glb$/, '');
    fs.copyFileSync(path.join(modelsDir, file), path.join(out, file));
    const preview = kit.preview
      ? path.join(dir, kit.preview.dir, `${model}${kit.preview.suffix}.png`)
      : path.join(dir, 'Previews', `${model}.png`);
    if (fs.existsSync(preview)) fs.copyFileSync(preview, path.join(out, 'previews', `${model}.png`));
    const size = glbBox(path.join(modelsDir, file)).getSize(new Vector3()).multiplyScalar(kit.scale);
    // Footprint in plan terms: width along x, depth along plan y (world z), height up.
    rows.push(`  ['${kit.id}', '${model}', ${round(size.x)}, ${round(size.z)}, ${round(size.y)}],`);
    ids.push(`kenney/${kit.id}/${model}`);
    count++;
  }
  kits.push(`  { id: '${kit.id}', label: '${kit.label}', scale: ${kit.scale} },`);
  console.log(`${kit.id}: ${count} models`);
}

fs.writeFileSync(
  CATALOG,
  `// Generated by scripts/import-kenney.mjs. Do not edit by hand.

/** The imported Kenney kits; \`scale\` converts the kit's model units to meters. */
export const KENNEY_KITS = [
${kits.join('\n')}
] as const;

export type KenneyKitId = (typeof KENNEY_KITS)[number]['id'];

/** [kit, model file name, width (x), depth (plan y), height], in meters after the kit scale. */
export const KENNEY_MODELS: readonly (readonly [KenneyKitId, string, number, number, number])[] = [
${rows.join('\n')}
];
`,
);
console.log(`${rows.length} models → ${path.relative(ROOT, OUT)}, catalog → ${path.relative(ROOT, CATALOG)}`);

// Every model needs a description or an AI exclusion in descriptions.ts (ids appear there as quoted strings).
const covered = new Set([...fs.readFileSync(DESCRIPTIONS, 'utf8').matchAll(/'(kenney\/[^']+)'/g)].map((m) => m[1]));
const missing = ids.filter((id) => !covered.has(id));
const stale = [...covered].filter((id) => !ids.includes(id));
if (missing.length) {
  console.warn(`\n${missing.length} model(s) have no description or AI exclusion in ${path.relative(ROOT, DESCRIPTIONS)}:`);
  for (const id of missing) console.warn(`  ${id}`);
}
if (stale.length) console.warn(`\n${stale.length} id(s) in ${path.relative(ROOT, DESCRIPTIONS)} are no longer in the catalog: ${stale.join(', ')}`);
