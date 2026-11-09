import { fileURLToPath } from 'node:url';

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv, type Plugin } from 'vite';

import { sourceAliases } from '../vite.aliases.ts';
import {
  createAnthropicArchitectModel,
  createArchitectMiddleware,
  createMockArchitectModel,
} from '../src/architect/server/index.ts';

const resolvePath = (path: string) => fileURLToPath(new URL(path, import.meta.url));

/**
 * Serves POST /api/architect (the AI import assistant) from the dev and preview servers with the
 * library's `createArchitectMiddleware`, so the Anthropic API key stays on the server. Key:
 * ANTHROPIC_API_KEY in the environment or in studio/.env.local (or an `ant auth login` profile).
 * ARCHITECT_MOCK=1 serves the scripted mock model instead.
 */
function architectApi(options: { mock: boolean; apiKey?: string }): Plugin {
  const middleware = createArchitectMiddleware({
    model: options.mock ? createMockArchitectModel() : createAnthropicArchitectModel({ apiKey: options.apiKey }),
    onError: (err) => console.error('[architect]', err),
  });
  return {
    name: 'vespenelabs-architect-api',
    configureServer(server) {
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware);
    },
  };
}

// Floorview Studio: the React demo app. It consumes the library from source through the
// `@vespenelabs/floorview` alias, exactly as an app would import the published package.
export default defineConfig(({ mode }) => {
  // '' prefix: load every variable from studio/.env* (not only VITE_*). Used server-side only.
  const env = { ...loadEnv(mode, resolvePath('.'), ''), ...process.env };
  return {
    plugins: [react(), tailwindcss(), architectApi({ mock: env.ARCHITECT_MOCK === '1', apiKey: env.ANTHROPIC_API_KEY })],
    resolve: {
      // Keep in sync with `paths` in studio/tsconfig.json (also read by the shadcn CLI).
      alias: [...sourceAliases(resolvePath('../src')), { find: '@', replacement: resolvePath('./src') }],
    },
    // The library's model assets (assets/kenney → /kenney/…), served and copied as static files.
    publicDir: resolvePath('../assets'),
    build: { outDir: '../dist-studio', emptyOutDir: true },
  };
});
