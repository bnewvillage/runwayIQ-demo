import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// `base` is relative so the built bundle works wherever it is served
// from -- GitHub Pages puts a project site under /<repo>/, and an
// absolute /assets/... path 404s there. A relative one also lets the
// dist/ folder be opened from disk or dropped on any static host.
//
// cacheDir: this checkout tends to live under a synced/locked Windows
// Documents folder, where Vite's atomic .vite writes fail. Redirecting
// the dep-optimizer cache to the OS temp dir is the same fix the app
// repo carries, and is harmless everywhere else.
export default defineConfig({
  base: './',
  plugins: [react()],
  cacheDir: join(tmpdir(), 'vite-runway-iq-demo'),
  // A different port from the app repo's 5179, so both can run at once
  // when the demo is being checked against the thing it mirrors.
  server: { port: 5180, strictPort: true },
  build: { outDir: 'dist', sourcemap: false },
});
