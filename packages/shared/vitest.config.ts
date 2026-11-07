import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      reporter: ['text', 'lcov', 'json-summary'],
      // Phase 2 deliverable: @nexus/shared at 95 % coverage.
      thresholds: { statements: 95, branches: 95, functions: 95, lines: 95 },
    },
  },
});
