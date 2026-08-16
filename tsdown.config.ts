import { defineConfig } from 'tsdown'

// Bundles src/*.ts into a single ESM dist/index.mjs.
//
// The `@deepseek-ai/dsh-*` and `@deepseek-ai/cordis` imports stay external
// (via `deps.neverBundle`, not bundled): at runtime the plugin runs inside the
// dsh process and must share dsh's single service instances. They are therefore
// not declared as dependencies, and Node resolves them against the running dsh
// installation's node_modules when the plugin loads. `unpdf` and schemastery
// are ordinary dependencies and are externalized automatically.
export default defineConfig({
  entry: ['src/index.ts'],
  outDir: 'dist',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  dts: false,
  clean: true,
  deps: {
    neverBundle: [/^@deepseek-ai\/dsh-/, /^@deepseek-ai\/cordis$/],
  },
})
