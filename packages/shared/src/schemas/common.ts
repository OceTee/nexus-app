import { z } from 'zod';
import { LIMITS } from '../limits';

/** Any RFC 9562 UUID. Server-generated ids (users) are v4. */
export const Uuid = z.uuid();

/** Client-generated, time-ordered id (notes, collections, tags, attachments, devices, ops). */
export const UuidV7 = z.uuid({ version: 'v7' });

/** ISO 8601 timestamp with a UTC `Z` or an explicit offset. */
export const IsoDateTime = z.iso.datetime({ offset: true });

/** Optimistic-concurrency revision the client last saw. */
export const BaseRev = z.number().int().min(0);

/** Server revision of an entity (starts at 1). */
export const ServerRev = z.number().int().min(1);

/** `#RRGGBB` colour. */
export const HexColour = z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'must be a #RRGGBB colour');

/** Query-string boolean: accepts `true`/`false`/`1`/`0`. */
export const QueryBoolean = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1');

/** Keyset pagination query (`cursor` + `limit`, default 50, max 200). */
export const PageQuery = z.object({
  cursor: z.string().min(1).max(512).optional(),
  limit: z.coerce.number().int().min(1).max(LIMITS.pageMax).default(LIMITS.pageDefault),
});
export type PageQuery = z.infer<typeof PageQuery>;

/** Cursor envelope for list responses: `{ items, nextCursor, hasMore }`. */
export function Paginated<T extends z.ZodType>(item: T) {
  return z.object({
    items: z.array(item),
    nextCursor: z.string().nullable(),
    hasMore: z.boolean(),
  });
}
export type Paginated<T> = { items: T[]; nextCursor: string | null; hasMore: boolean };

/** Non-paginated list envelope: `{ items }`. */
export function ItemList<T extends z.ZodType>(item: T) {
  return z.object({ items: z.array(item) });
}

/** Sort key encoded in note and version list cursors. */
export const UpdatedAtCursor = z.object({ updatedAt: IsoDateTime, id: Uuid });
export type UpdatedAtCursor = z.infer<typeof UpdatedAtCursor>;

/** Body of `DELETE` and restore requests that need a revision check. */
export const BaseRevInput = z.object({ baseRev: BaseRev });

/** Presigned URL handed to the client for uploads and downloads. */
export const PresignedUrlDto = z.object({
  url: z.url(),
  method: z.enum(['GET', 'PUT']),
  headers: z.record(z.string(), z.string()),
  expiresAt: IsoDateTime,
});
export type PresignedUrlDto = z.infer<typeof PresignedUrlDto>;

/** `{ url, expiresAt }` for presigned downloads. */
export const DownloadUrlDto = z.object({ url: z.url(), expiresAt: IsoDateTime });

/** Machine-readable error codes (TDD Section D, Errors). */
export const ErrorCode = z.enum([
  'VALIDATION_FAILED',
  'MALFORMED_JSON',
  'UNAUTHENTICATED',
  'INVALID_CREDENTIALS',
  'TOKEN_EXPIRED',
  'TOKEN_REUSED',
  'TOKEN_INVALID',
  'FORBIDDEN',
  'EMAIL_UNVERIFIED',
  'DEVICE_REVOKED',
  'NOT_FOUND',
  'CONFLICT',
  'CURSOR_TOO_OLD',
  'DUPLICATE',
  'NOT_READY',
  'UPLOAD_INCOMPLETE',
  'EXPIRED',
  'PAYLOAD_TOO_LARGE',
  'BUSINESS_RULE',
  'DEPTH_EXCEEDED',
  'CYCLE',
  'CANNOT_REVOKE_SELF',
  'QUOTA_EXCEEDED',
  'UNSUPPORTED_TYPE',
  'TYPE_MISMATCH',
  'LOCKED',
  'CLIENT_SCHEMA_TOO_OLD',
  'RATE_LIMITED',
  'FEATURE_DISABLED',
  'INTERNAL',
  'UNAVAILABLE',
]);
export type ErrorCode = z.infer<typeof ErrorCode>;

/** Error response shape returned by every endpoint. */
export const ErrorEnvelope = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
    requestId: z.string(),
  }),
});
export type ErrorEnvelope = z.infer<typeof ErrorEnvelope>;
