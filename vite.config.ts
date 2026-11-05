/// <reference types="vitest/config" />
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

import { sourceAliases } from './vite.aliases.ts';

const src = (path: string) => resolve(import.meta.dirname, 'src', path);

/**
 * Package subpath entries (`@vespenelabs/floorview/<name>`), built as ES + CJS by
 * `vite build --mode subpaths`. Each `<name>` lives at `src/<name>/index.ts`.
 * Keep in sync with `exports` in package.json.
 */
export const SUBPATH_ENTRIES = {
  model: src('model/index.ts'),
  architect: src('architect/index.ts'),
  'architect/server': src('architect/server/index.ts'),
};

// Library build (dist/) and the library's unit tests. Floorview Studio has its own config in studio/.
// Default mode: the main entry as ES + UMD (UMD only supports one entry). `--mode subpaths`: the
// subpath entries as ES + CJS, added to the same dist/.
export default defineConfig(({ mode }) => ({
  build:
    mode === 'subpaths'
      ? {
          outDir: 'dist',
          emptyOutDir: false,
          lib: { entry: SUBPATH_ENTRIES, formats: ['es', 'cjs'] },
          rollupOptions: { external: ['three', /^three\//, /^node:/, '@anthropic-ai/sdk'] },
        }
      : {
          outDir: 'dist',
          lib: {
            entry: src('index.ts'),
            name: 'VespeneFloorview',
            fileName: 'vespenelabs-floorview',
            cssFileName: 'vespenelabs-floorview',
          },
          rollupOptions: {
            // Add-ons (OrbitControls, CSS2DRenderer) are bundled; they import "three" itself.
            external: ['three'],
            output: { globals: { three: 'THREE' } },
          },
        },
  // Lets tests import framework-free Studio modules, which use the package name.
  resolve: { alias: sourceAliases(resolve(import.meta.dirname, 'src')) },
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.ts'],
  },
}));
