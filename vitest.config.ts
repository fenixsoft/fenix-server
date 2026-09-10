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
    // NOTE: do not enable `globals` — vitest 3.x drops `ctx.skip()` from
    // hook contexts when globals are on, which would break the integration
    // suites that gracefully skip when the sshd test container is absent.
    // Component tests call @testing-library/react cleanup() explicitly.
    // Register jest-dom matchers (toBeInTheDocument / toHaveStyle / …).
    setupFiles: ['./vitest.setup.ts'],
  },
});
