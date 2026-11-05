import { resolve } from 'node:path';

/**
 * Resolves the package name to library source, for tests and Floorview Studio:
 * `@vespenelabs/floorview` → `<srcDir>/index.ts`, `@vespenelabs/floorview/<sub>` → `<srcDir>/<sub>/index.ts`.
 * Regexes (not an alias object) so the bare name does not also swallow its subpaths.
 * Keep in sync with `paths` in tsconfig.json and studio/tsconfig.json.
 */
export const sourceAliases = (srcDir: string) => [
  { find: /^@vespenelabs\/floorview$/, replacement: resolve(srcDir, 'index.ts') },
  { find: /^@vespenelabs\/floorview\/(.+)$/, replacement: `${srcDir}/$1/index.ts` },
];
