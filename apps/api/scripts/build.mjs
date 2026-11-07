// Bundles the API into dist/index.js and the migration runner into dist/migrate.js. Workspace packages (@nexus/*) ship
// TypeScript source, so they are bundled in; npm dependencies stay external.
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const external = Object.keys(pkg.dependencies ?? {}).filter((d) => !d.startsWith('@nexus/'));

// dist/migrate.js lets a container apply migrations before the API starts.
await build({
  entryPoints: { index: 'src/index.ts', migrate: 'scripts/migrate.ts' },
  outdir: 'dist',
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'esm',
  sourcemap: true,
  external,
});
