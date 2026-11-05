import { defineConfig } from 'drizzle-kit';

// Migrations are generated from src/db/schema with `pnpm db:generate` and
// committed. Hand-written SQL (extensions, functions, roles, grants, triggers)
// is added to the generated files, so drizzle/migrations is the full truth
// (TDD design decision D-06). Migrations run as the schema owner using
// DATABASE_URL_DIRECT (falling back to DATABASE_URL locally).
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema/index.ts',
  out: './drizzle/migrations',
  dbCredentials: {
    url: process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL ?? '',
  },
  casing: 'snake_case',
  strict: true,
  verbose: true,
});
