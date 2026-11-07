// Writes docs/api/openapi.json (TDD Section F). Run after changing routes or
// their schemas: pnpm --filter @nexus/api openapi
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { generateOpenApi } from '../src/openapi';

const out = fileURLToPath(new URL('../../../docs/api/openapi.json', import.meta.url));
writeFileSync(out, `${JSON.stringify(generateOpenApi(), null, 2)}\n`);
console.log(`Wrote ${out}`);
