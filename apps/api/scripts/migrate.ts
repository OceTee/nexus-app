// Applies pending migrations: `pnpm --filter @nexus/api db:migrate`.
// Uses DATABASE_URL_DIRECT (schema owner), falling back to DATABASE_URL.
//
// Local and CI only: if NEXUS_API_PASSWORD is set, the nexus_api role is
// given LOGIN with that password, so DATABASE_URL can connect as it. Hosted
// environments set role passwords in the provider console instead.
import pg from 'pg';
import { runMigrations } from '../src/db/migrate';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) {
  console.error('Set DATABASE_URL_DIRECT (or DATABASE_URL) to run migrations.');
  process.exit(1);
}

await runMigrations(url);
console.log('Migrations applied.');

const apiPassword = process.env.NEXUS_API_PASSWORD;
if (apiPassword) {
  if (process.env.NODE_ENV === 'production') {
    console.error('NEXUS_API_PASSWORD is for local and CI databases only.');
    process.exit(1);
  }
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const literal = await client.query<{ q: string }>('SELECT quote_literal($1) AS q', [
      apiPassword,
    ]);
    await client.query(`ALTER ROLE nexus_api LOGIN PASSWORD ${literal.rows[0]!.q}`);
    console.log('nexus_api login enabled.');
  } finally {
    await client.end();
  }
}
