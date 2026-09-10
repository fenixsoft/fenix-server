/**
 * web/vite.config.ts
 *
 * Vite build configuration for the Fenix web UI.
 *
 *   - React plugin (fast refresh in dev)
 *   - Dev server proxies /ws to the backend at 127.0.0.1:3773
 *     (the Fastify server only listens on 127.0.0.1), so the browser talks
 *     to the same origin in development — no CORS / port surprises.
 *   - build.outDir → "dist" under web/ which is exactly the directory the
 *     server's @fastify/static serves by default (see server/index.ts).
 */
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@fenix/shared': resolve(__dirname, '../shared'),
      '@fenix/shared/': resolve(__dirname, '../shared/') + '/',
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/ws': {
        target: 'ws://127.0.0.1:3773',
        ws: true,
      },
      '/health': {
        target: 'http://127.0.0.1:3773',
      },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});