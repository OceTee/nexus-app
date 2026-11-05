import { defineConfig } from 'vitest/config';

// Two projects:
//   unit — fast, no Docker; runs on every push (CI stage 2).
//   db   — real PostgreSQL 18 via Testcontainers; needs Docker (CI stage 3).
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['test/unit/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'db',
          include: ['test/db/**/*.test.ts'],
          globalSetup: ['test/setup/postgres.ts'],
          testTimeout: 30_000,
          hookTimeout: 120_000,
          // Tests share one database; run files one at a time.
          fileParallelism: false,
        },
      },
    ],
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      exclude: ['src/index.ts', 'src/types/**', 'src/db/schema/**'],
      reporter: ['text', 'lcov'],
    },
  },
});
