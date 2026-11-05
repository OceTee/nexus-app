import { z } from 'zod';
import { ATTACHMENT_MIME_TYPES, LIMITS } from '../limits';
import { IsoDateTime, PageQuery, PresignedUrlDto, ServerRev, UuidV7 } from './common';

export const AttachmentMimeType = z.enum(ATTACHMENT_MIME_TYPES);
export type AttachmentMimeType = z.infer<typeof AttachmentMimeType>;

export const AttachmentStatus = z.enum(['pending', 'uploaded', 'deleted']);
export type AttachmentStatus = z.infer<typeof AttachmentStatus>;

/** File name without path separators or control characters. */
const Filename = z
  .string()
  .trim()
  .min(1)
  .max(LIMITS.filenameMax)
  .refine(
    (name) => !/[/\\]/.test(name) && ![...name].some((ch) => ch.charCodeAt(0) < 0x20),
    'must be a plain file name',
  );

const Sha256Hex = z.string().regex(/^[0-9a-f]{64}$/, 'must be a lower-case SHA-256 hex digest');
const Dimension = z.number().int().min(1).max(65_535);

/** Attachment metadata, shared by `POST /v1/attachments` and the `attachment.upsert` op. */
export const AttachmentMetaInput = z.object({
  noteId: UuidV7.nullable(),
  filename: Filename,
  mimeType: AttachmentMimeType,
  sizeBytes: z.number().int().min(1).max(LIMITS.attachmentBytesMax),
  sha256: Sha256Hex,
  width: Dimension.optional(),
  height: Dimension.optional(),
});
export type AttachmentMetaInput = z.infer<typeof AttachmentMetaInput>;

export const AttachmentCreateInput = AttachmentMetaInput.extend({ id: UuidV7, noteId: UuidV7 });
export type AttachmentCreateInput = z.infer<typeof AttachmentCreateInput>;

export const AttachmentParams = z.object({ attachmentId: UuidV7 });

export const AttachmentListQuery = PageQuery.extend({ noteId: UuidV7.optional() });

export const AttachmentDto = z.object({
  id: UuidV7,
  noteId: UuidV7.nullable(),
  filename: z.string(),
  mimeType: AttachmentMimeType,
  sizeBytes: z.number().int(),
  sha256: z.string(),
  status: AttachmentStatus,
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
  serverRev: ServerRev,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type AttachmentDto = z.infer<typeof AttachmentDto>;

/** Response to `POST /v1/attachments`: the pending row and where to upload it. */
export const AttachmentCreatedDto = z.object({
  attachment: AttachmentDto,
  upload: PresignedUrlDto.extend({ method: z.literal('PUT') }),
});
export type AttachmentCreatedDto = z.infer<typeof AttachmentCreatedDto>;
