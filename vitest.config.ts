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
  },
});
