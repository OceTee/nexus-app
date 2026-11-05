import { z } from 'zod';
import { IsoDateTime, PageQuery } from './common';
import { DisplayName } from './auth';

/** `PATCH /v1/me`; settings are merged, not replaced. */
export const UpdateMeInput = z
  .object({
    displayName: DisplayName.optional(),
    settings: z
      .object({
        telemetryOptIn: z.boolean().optional(),
        push: z.object({ newDeviceSignIn: z.boolean().optional() }).optional(),
      })
      .optional(),
  })
  .refine((v) => v.displayName !== undefined || v.settings !== undefined, 'nothing to update');
export type UpdateMeInput = z.infer<typeof UpdateMeInput>;

export const UsageDto = z.object({
  notes: z.number().int().min(0),
  collections: z.number().int().min(0),
  tags: z.number().int().min(0),
  attachments: z.number().int().min(0),
  attachmentBytes: z.number().int().min(0),
  versions: z.number().int().min(0),
  quotaBytes: z.number().int().min(0),
});
export type UsageDto = z.infer<typeof UsageDto>;

/** `POST /v1/me/deletion` re-confirms the password. */
export const DeletionRequestInput = z.object({ password: z.string().min(1).max(128) });

export const DeletionStatusDto = z.object({
  deletionRequestedAt: IsoDateTime,
  purgeAt: IsoDateTime,
});
export type DeletionStatusDto = z.infer<typeof DeletionStatusDto>;

/** Security events shown on the account screen (no secrets, no note content). */
export const AuditAction = z.enum([
  'auth.register',
  'auth.login',
  'auth.login_failed',
  'auth.refresh_reuse',
  'auth.logout_all',
  'auth.password_changed',
  'auth.password_reset',
  'auth.email_verified',
  'device.revoke',
  'account.deletion_requested',
  'account.deletion_cancelled',
  'export.download',
]);
export type AuditAction = z.infer<typeof AuditAction>;

export const AuditEventDto = z.object({
  id: z.string(),
  action: AuditAction,
  deviceName: z.string().nullable(),
  ip: z.string().nullable(),
  createdAt: IsoDateTime,
});
export type AuditEventDto = z.infer<typeof AuditEventDto>;

export const AuditListQuery = PageQuery;
