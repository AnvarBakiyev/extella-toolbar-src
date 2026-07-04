import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';
import path from 'node:path';

/**
 * Single-file build for embedding into the Extella toolbar.
 *
 * The toolbar inlines this module's `dist/index.html` and opens it in a blob:
 * iframe. A blob: document can't fetch sibling
 * `<script type="module">` chunks, so `vite-plugin-singlefile` inlines JS + CSS
 * into a single `index.html` with nothing left to fetch. Production builds talk
 * to the Main Backend directly using the URL in `src/lib/runtime.ts`
 * (overridable via window.__MB_BASE_URL__).
 *
 * For `npm run dev` in a browser, a same-origin CORS-bypass proxy is mounted
 * at `/__mb/*` → Main Backend. The API client detects DEV mode and rewrites
 * its baseURL to `/__mb` so requests stay same-origin and avoid CORS.
 *
 * Builds to `dist/` as a single self-contained `index.html`.
 */
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, __dirname, '');
  const mbTarget = env.VITE_MB_BASE_URL || 'https://api.extella.ai';
  const disnetTarget = env.VITE_DISNET_BASE_URL || 'https://disnet.extella.ai';

  return {
    plugins: [react(), viteSingleFile()],
    base: './',
    resolve: {
      alias: {
        '@': path.resolve(__dirname, 'src'),
      },
    },
    server: {
      port: 3010,
      strictPort: false,
      proxy: {
        '/__mb': {
          target: mbTarget,
          changeOrigin: true,
          secure: false,
          rewrite: (p) => p.replace(/^\/__mb/, ''),
        },
        '/__disnet': {
          target: disnetTarget,
          changeOrigin: true,
          secure: false,
          rewrite: (p) => p.replace(/^\/__disnet/, ''),
        },
      },
    },
    preview: {
      port: 3010,
    },
    build: {
      outDir: 'dist',
      emptyOutDir: true,
      sourcemap: false,
      cssCodeSplit: false,
      assetsInlineLimit: 100_000_000,
      rollupOptions: {
        output: {
          inlineDynamicImports: true,
        },
      },
    },
  };
});
