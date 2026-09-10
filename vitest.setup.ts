/**
 * vitest.setup.ts
 *
 * Global test setup: registers @testing-library/jest-dom matchers so
 * component tests can use toBeInTheDocument / toHaveStyle etc.
 */
import '@testing-library/jest-dom/vitest';
