// Guards the API contract against accidental breaking changes (Phase 2
// acceptance criterion). Every exported Zod schema is converted to JSON Schema
// and compared with the committed snapshot. An intended contract change is
// accepted by re-running with `pnpm --filter @nexus/shared test -- -u` and
// committing the updated snapshot alongside the change.
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import * as schemas from '../src/schemas';

function collectSchemas(): Record<string, z.ZodType> {
  const out: Record<string, z.ZodType> = {};
  for (const [name, value] of Object.entries(schemas)) {
    if (value instanceof z.ZodType) out[name] = value;
  }
  return out;
}

describe('schema contract', () => {
  const all = collectSchemas();

  it('exports schemas for every domain in the spine', () => {
    for (const name of [
      'RegisterInput',
      'UpdateMeInput',
      'DeviceRegisterInput',
      'NoteCreateInput',
      'CollectionCreateInput',
      'TagCreateInput',
      'GraphQuery',
      'SearchQuery',
      'AttachmentCreateInput',
      'ExportCreateInput',
      'SyncPushRequest',
      'PageQuery',
    ]) {
      expect(all, name).toHaveProperty(name);
    }
    expect(Object.keys(all).length).toBeGreaterThanOrEqual(40);
  });

  it('matches the committed JSON Schema snapshot', async () => {
    const contract = Object.fromEntries(
      Object.keys(all)
        .sort()
        .map((name) => [name, z.toJSONSchema(all[name]!, { unrepresentable: 'any', io: 'input' })]),
    );
    await expect(JSON.stringify(contract, null, 2)).toMatchFileSnapshot(
      './__snapshots__/schemas.contract.json',
    );
  });
});
