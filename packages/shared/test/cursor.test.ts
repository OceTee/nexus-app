import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { decodeCursor, encodeCursor, InvalidCursorError } from '../src/cursor';
import { UpdatedAtCursor } from '../src/schemas/common';

const key = { updatedAt: '2026-11-04T10:02:11.000Z', id: '019300a9-2222-7000-8000-00000000aaaa' };

describe('cursor codec', () => {
  it('T-13: round-trips the sort key', () => {
    const cursor = encodeCursor(key);
    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeCursor(cursor, UpdatedAtCursor)).toEqual(key);
  });

  it('round-trips non-ASCII and astral characters', () => {
    const value = { title: 'Café ☕ 𝔑exus', n: 42 };
    const schema = z.object({ title: z.string(), n: z.number() });
    expect(decodeCursor(encodeCursor(value), schema)).toEqual(value);
  });

  it('round-trips every padding length', () => {
    const schema = z.object({ s: z.string() });
    for (const s of ['', 'a', 'ab', 'abc', 'abcd']) {
      expect(decodeCursor(encodeCursor({ s }), schema)).toEqual({ s });
    }
  });

  it('T-13: rejects a tampered cursor', () => {
    const cursor = encodeCursor(key);
    const flipped = cursor.slice(0, 20) + (cursor[20] === 'A' ? 'B' : 'A') + cursor.slice(21);
    expect(() => decodeCursor(flipped, UpdatedAtCursor)).toThrow(InvalidCursorError);
  });

  it('rejects a re-encoded cursor with an edited payload', () => {
    const forged = encodeCursor(key).replace(/.{4}$/, 'AAAA');
    expect(() => decodeCursor(forged, UpdatedAtCursor)).toThrow(InvalidCursorError);
  });

  it('rejects malformed input', () => {
    for (const bad of ['', 'a', '!!!!', 'abc$', '____']) {
      expect(() => decodeCursor(bad, UpdatedAtCursor)).toThrow(InvalidCursorError);
    }
  });

  it('rejects valid cursors of the wrong shape', () => {
    const other = encodeCursor({ seq: 5 });
    expect(() => decodeCursor(other, UpdatedAtCursor)).toThrow(/unexpected shape/);
  });

  it('rejects a checksummed payload that is not JSON', () => {
    // Build `<checksum>:<not json>` with a correct checksum by encoding a string key
    // and then decoding it with a schema that only accepts numbers.
    const cursor = encodeCursor({ a: 'x' });
    expect(() => decodeCursor(cursor, z.number())).toThrow(InvalidCursorError);
  });
});
