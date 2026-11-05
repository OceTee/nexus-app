import { z } from 'zod';
import { IsoDateTime, Uuid, UuidV7 } from './common';

export const ExportFormat = z.enum(['markdown_zip', 'json']);
export type ExportFormat = z.infer<typeof ExportFormat>;

export const ExportStatus = z.enum(['queued', 'running', 'ready', 'failed', 'expired']);
export type ExportStatus = z.infer<typeof ExportStatus>;

/** Server-side export job (post-MVP, behind a feature flag; MVP exports on the device). */
export const ExportCreateInput = z.object({
  format: ExportFormat,
  collectionId: UuidV7.optional(),
});
export type ExportCreateInput = z.infer<typeof ExportCreateInput>;

export const ExportParams = z.object({ exportId: Uuid });

export const ExportJobDto = z.object({
  id: Uuid,
  format: ExportFormat,
  status: ExportStatus,
  createdAt: IsoDateTime,
  expiresAt: IsoDateTime.nullable(),
});
export type ExportJobDto = z.infer<typeof ExportJobDto>;

export const ExportListDto = z.object({ items: z.array(ExportJobDto) });
