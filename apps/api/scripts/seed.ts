// Seeds the demo corpus: `pnpm --filter @nexus/api db:seed`.
// Never run against production. Uses DATABASE_URL_DIRECT (schema owner) and
// DEMO_PASSWORD for the demo account's password.
import { createDb } from '../src/db/client';
import { seedDemo } from '../src/db/seed/seedDemo';
import { hashPassword } from '../src/modules/auth/password';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
const password = process.env.DEMO_PASSWORD;

if (process.env.NODE_ENV === 'production') {
  console.error('Refusing to seed demo data in production.');
  process.exit(1);
}
if (!url || !password) {
  console.error('Set DATABASE_URL_DIRECT (or DATABASE_URL) and DEMO_PASSWORD to seed.');
  process.exit(1);
}

const handle = createDb(url, { max: 1, applicationName: 'nexus-seed' });
try {
  const summary = await seedDemo(handle.db, await hashPassword(password));
  console.log('Demo corpus seeded for demo@nexus.example:', summary);
} finally {
  await handle.close();
}
