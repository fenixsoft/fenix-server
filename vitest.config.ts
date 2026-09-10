import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@fenix/shared': path.resolve(__dirname, 'shared'),
      '@fenix/shared/': path.resolve(__dirname, 'shared/') + '/',
    },
  },
  test: {
    passWithNoTests: true,
    // Enable the globals so @testing-library/react can auto-register its
    // afterEach cleanup (DOM is cleaned between component tests).
    globals: true,
  },
});
