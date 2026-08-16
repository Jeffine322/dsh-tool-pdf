import { defineConfig } from 'tsdown'

// Bundles src/*.ts into a single ESM dist/index.js.
//
// The `@deepseek-ai/dsh-*` and `@deepseek-ai/cordis` imports are externalized
// (not bundled) because at runtime the plugin runs inside the dsh process and
// must share dsh's single instances of those services. The standalone build
// therefore never needs those packages installed — Node resolves them against
// the running dsh installation's node_modules. Everything else (unpdf,
// schemastery) is externalized automatically via `dependencies`.
export default defineConfig({
  entry: ['src/index.ts'],
  outDir: 'dist',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  dts: false,
  clean: true,
  // The `@deepseek-ai/dsh-*` and `@deepseek-ai/cordis` imports stay external:
  // at runtime the plugin runs inside the dsh process and must share dsh's
  // single service instances. They are therefore not declared as dependencies,
  // and Node resolves them against the running dsh installation at load time.
  deps: {
    neverBundle: [/^@deepseek-ai\/dsh-/, /^@deepseek-ai\/cordis$/],
  },
})
