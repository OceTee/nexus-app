// Opaque keyset-pagination cursors (TDD Section D, Pagination; test T-13).
//
// A cursor is base64url of `<checksum>:<json>`, where the JSON holds the sort
// key of the last item on the page (for example `{ updatedAt, id }`). The
// checksum (FNV-1a, 32-bit) makes edited or truncated cursors fail to decode.
// It is not a security control: row-level security limits what any cursor can
// reach, so a forged cursor can only page through the caller's own data.
//
// Pure TypeScript with no Buffer, btoa or TextEncoder, so it runs unchanged on
// Node and in React Native (Hermes).

import type { z } from 'zod';

export class InvalidCursorError extends Error {
  constructor(reason: string) {
    super(`Invalid cursor: ${reason}`);
    this.name = 'InvalidCursorError';
  }
}

/** Encodes a sort key as an opaque cursor string. */
export function encodeCursor(value: Record<string, unknown>): string {
  const json = JSON.stringify(value);
  return toBase64Url(utf8Encode(`${fnv1a(json)}:${json}`));
}

/**
 * Decodes a cursor and validates its contents with `schema`.
 * Throws `InvalidCursorError` for malformed, tampered or wrongly shaped cursors.
 */
export function decodeCursor<S extends z.ZodType>(cursor: string, schema: S): z.output<S> {
  let text: string;
  try {
    text = utf8Decode(fromBase64Url(cursor));
  } catch {
    throw new InvalidCursorError('not base64url');
  }
  const sep = text.indexOf(':');
  if (sep !== 8) throw new InvalidCursorError('missing checksum');
  const checksum = text.slice(0, sep);
  const json = text.slice(sep + 1);
  if (fnv1a(json) !== checksum) throw new InvalidCursorError('checksum mismatch');

  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new InvalidCursorError('not JSON');
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw new InvalidCursorError('unexpected shape');
  return parsed.data;
}

/** FNV-1a 32-bit hash as 8 lower-case hex characters. */
function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const LOOKUP = new Map([...ALPHABET].map((c, i) => [c, i]));

function toBase64Url(bytes: readonly number[]): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i] ?? 0;
    const b1 = bytes[i + 1];
    const b2 = bytes[i + 2];
    const n = (b0 << 16) | ((b1 ?? 0) << 8) | (b2 ?? 0);
    out += ALPHABET[(n >> 18) & 63]! + ALPHABET[(n >> 12) & 63]!;
    if (b1 !== undefined) out += ALPHABET[(n >> 6) & 63]!;
    if (b2 !== undefined) out += ALPHABET[n & 63]!;
  }
  return out;
}

function fromBase64Url(s: string): number[] {
  if (s.length === 0 || s.length % 4 === 1) throw new Error('bad length');
  const bytes: number[] = [];
  for (let i = 0; i < s.length; i += 4) {
    const chunk = s.slice(i, i + 4);
    let n = 0;
    for (let j = 0; j < 4; j++) {
      const c = chunk[j];
      const v = c === undefined ? 0 : LOOKUP.get(c);
      if (v === undefined) throw new Error('bad character');
      n = (n << 6) | v;
    }
    bytes.push((n >> 16) & 255);
    if (chunk.length > 2) bytes.push((n >> 8) & 255);
    if (chunk.length > 3) bytes.push(n & 255);
  }
  return bytes;
}

function utf8Encode(s: string): number[] {
  const out: number[] = [];
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    if (cp < 0x80) out.push(cp);
    else if (cp < 0x800) out.push(0xc0 | (cp >> 6), 0x80 | (cp & 63));
    else if (cp < 0x10000) out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
    else
      out.push(
        0xf0 | (cp >> 18),
        0x80 | ((cp >> 12) & 63),
        0x80 | ((cp >> 6) & 63),
        0x80 | (cp & 63),
      );
  }
  return out;
}

function utf8Decode(bytes: readonly number[]): string {
  let out = '';
  let i = 0;
  const next = (): number => {
    const b = bytes[i++];
    if (b === undefined || (b & 0xc0) !== 0x80) throw new Error('bad continuation byte');
    return b & 63;
  };
  while (i < bytes.length) {
    const b = bytes[i++]!;
    if (b < 0x80) out += String.fromCodePoint(b);
    else if ((b & 0xe0) === 0xc0) out += String.fromCodePoint(((b & 31) << 6) | next());
    else if ((b & 0xf0) === 0xe0)
      out += String.fromCodePoint(((b & 15) << 12) | (next() << 6) | next());
    else if ((b & 0xf8) === 0xf0)
      out += String.fromCodePoint(((b & 7) << 18) | (next() << 12) | (next() << 6) | next());
    else throw new Error('bad lead byte');
  }
  return out;
}
