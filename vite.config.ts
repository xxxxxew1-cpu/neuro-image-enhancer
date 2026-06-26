import { defineConfig } from 'vite';

// Relative base so the build works on GitHub Pages project sites
// (https://user.github.io/repo/) as well as on the domain root or any
// static host, without hardcoding the repository name.
export default defineConfig({
  base: './',
  build: {
    target: 'es2020',
    sourcemap: false,
    // TF.js lives entirely inside the worker chunk (it is only imported there),
    // so the main-thread bundle stays tiny. Both are well under the 10 MB budget.
    chunkSizeWarningLimit: 4096,
  },
  worker: {
    format: 'es',
  },
  // The wasm backend ships .wasm assets that must be served as-is.
  assetsInclude: ['**/*.wasm'],
  server: {
    port: 5173,
  },
});
