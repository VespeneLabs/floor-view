/// <reference types="vitest/config" />
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// Library build (dist/) and the library's unit tests. Floorview Studio has its own config in studio/.
export default defineConfig({
  build: {
    outDir: 'dist',
    lib: {
      entry: resolve(import.meta.dirname, 'src/index.ts'),
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
  resolve: { alias: { '@vespenelabs/floorview': resolve(import.meta.dirname, 'src/index.ts') } },
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.ts'],
  },
});
