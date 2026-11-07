// Success responses per route for the OpenAPI document. Request schemas come
// from the routes themselves (src/openapi/collect.ts); handlers don't declare
// their responses, so they are listed here. test/unit/openapi.test.ts fails if
// a route is missing from this table or the table names a route that doesn't exist.

import {
  AttachmentCreatedDto,
  AttachmentDto,
  AuditEventDto,
  AuthSessionDto,
  BacklinkDto,
  CollectionDto,
  CollectionListDto,
  ConflictDto,
  DeletionStatusDto,
  DeviceDto,
  DeviceListDto,
  DownloadUrlDto,
  ExportJobDto,
  ExportListDto,
  GraphDto,
  HealthDto,
  ItemList,
  MetaDto,
  NoteDto,
  NoteSummaryDto,
  NoteVersionDetailDto,
  NoteVersionDto,
  OutgoingLinkDto,
  Paginated,
  SearchHitDto,
  SnapshotPageDto,
  SyncResponse,
  SyncStatusDto,
  TagDto,
  TagListDto,
  TagMergeResultDto,
  TokenPairDto,
  TrashedNoteDto,
  UsageDto,
  UserDto,
  VerifyEmailDto,
} from '@nexus/shared';
import { z } from 'zod';

export interface SuccessResponse {
  status: 200 | 201 | 202 | 204;
  schema?: z.ZodType | undefined;
  summary: string;
}

const Readiness = z.object({
  status: z.enum(['ready', 'not_ready']),
  checks: z.record(z.string(), z.boolean()),
});

const ok = (summary: string, schema?: z.ZodType): SuccessResponse => ({
  status: 200,
  schema,
  summary,
});
const created = (summary: string, schema: z.ZodType): SuccessResponse => ({
  status: 201,
  schema,
  summary,
});
const accepted = (summary: string, schema?: z.ZodType): SuccessResponse => ({
  status: 202,
  schema,
  summary,
});
const noContent = (summary: string): SuccessResponse => ({ status: 204, summary });

/** Keyed by `METHOD /express/path`. */
export const RESPONSES: Record<string, SuccessResponse> = {
  'GET /healthz': ok('Liveness probe', HealthDto),
  'GET /readyz': ok('Readiness probe (503 when not ready)', Readiness),
  'GET /v1/meta': ok('API contract version and client minimums', MetaDto),

  'POST /v1/auth/register': created('Create an account and sign in this device', AuthSessionDto),
  'POST /v1/auth/login': ok('Sign in this device', AuthSessionDto),
  'POST /v1/auth/refresh': ok('Rotate the refresh token', TokenPairDto),
  'POST /v1/auth/logout': noContent('Sign out this device'),
  'POST /v1/auth/logout-all': noContent('Sign out every device'),
  'POST /v1/auth/verify-email': ok('Confirm the email address', VerifyEmailDto),
  'POST /v1/auth/resend-verification': accepted('Send the verification email again'),
  'POST /v1/auth/forgot-password': accepted('Email a password reset link'),
  'POST /v1/auth/reset-password': noContent('Set a new password from a reset link'),
  'POST /v1/auth/change-password': ok('Change the password', TokenPairDto),

  'GET /v1/me': ok('The signed-in user', UserDto),
  'PATCH /v1/me': ok('Update the profile', UserDto),
  'GET /v1/me/usage': ok('Storage and item counts', UsageDto),
  'POST /v1/me/deletion': ok('Schedule account deletion', DeletionStatusDto),
  'DELETE /v1/me/deletion': noContent('Cancel a scheduled deletion'),
  'GET /v1/me/audit': ok('Security events', Paginated(AuditEventDto)),

  'GET /v1/devices': ok('Signed-in devices', DeviceListDto),
  'POST /v1/devices': ok('Register this device (push token, name)', DeviceDto),
  'PATCH /v1/devices/:deviceId': ok('Rename a device or update its push token', DeviceDto),
  'DELETE /v1/devices/:deviceId': noContent('Revoke a device'),

  'POST /v1/sync': ok('Push outbox ops and pull changes', SyncResponse),
  'GET /v1/sync/snapshot': ok('Full snapshot page for a new device', SnapshotPageDto),
  'GET /v1/sync/status': ok('Server-side sync state for this account', SyncStatusDto),

  'GET /v1/notes': ok('List notes', Paginated(NoteSummaryDto)),
  'POST /v1/notes': created('Create a note', NoteDto),
  'GET /v1/notes/trash': ok('Notes in Trash', Paginated(TrashedNoteDto)),
  'GET /v1/notes/:noteId': ok('A note', NoteDto),
  'PATCH /v1/notes/:noteId': ok('Edit a note', NoteDto),
  'DELETE /v1/notes/:noteId': noContent('Move a note to Trash'),
  'POST /v1/notes/:noteId/restore': ok('Restore a note from Trash', NoteDto),
  'GET /v1/notes/:noteId/versions': ok('Version history', Paginated(NoteVersionDto)),
  'GET /v1/notes/:noteId/versions/:versionId': ok('One version', NoteVersionDetailDto),
  'POST /v1/notes/:noteId/versions/:versionId/restore': ok('Restore a version', NoteDto),
  'GET /v1/notes/:noteId/backlinks': ok('Notes linking here', ItemList(BacklinkDto)),
  'GET /v1/notes/:noteId/links': ok('Links from this note', ItemList(OutgoingLinkDto)),
  'GET /v1/notes/:noteId/conflicts': ok('Open conflicts', ItemList(ConflictDto)),
  'POST /v1/notes/:noteId/conflicts/:versionId/resolve': ok('Resolve the conflicts', NoteDto),
  'PUT /v1/notes/:noteId/tags': ok("Replace a note's tags", NoteDto),
  'POST /v1/notes/:noteId/tags/:tagId': ok('Tag a note', NoteDto),
  'DELETE /v1/notes/:noteId/tags/:tagId': ok('Untag a note', NoteDto),

  'GET /v1/collections': ok('All collections', CollectionListDto),
  'POST /v1/collections': created('Create a collection', CollectionDto),
  'GET /v1/collections/:collectionId': ok('A collection', CollectionDto),
  'PATCH /v1/collections/:collectionId': ok('Rename a collection', CollectionDto),
  'DELETE /v1/collections/:collectionId': noContent('Delete a collection'),
  'POST /v1/collections/:collectionId/move': ok('Move a collection', CollectionDto),

  'GET /v1/tags': ok('All tags', TagListDto),
  'POST /v1/tags': created('Create a tag', TagDto),
  'PATCH /v1/tags/:tagId': ok('Rename or recolour a tag', TagDto),
  'DELETE /v1/tags/:tagId': noContent('Delete a tag'),
  'POST /v1/tags/:tagId/merge': ok('Merge a tag into another', TagMergeResultDto),

  'GET /v1/attachments': ok('Attachments', Paginated(AttachmentDto)),
  'POST /v1/attachments': created('Start an upload', AttachmentCreatedDto),
  'POST /v1/attachments/:attachmentId/complete': ok('Finish an upload', AttachmentDto),
  'GET /v1/attachments/:attachmentId': ok('An attachment', AttachmentDto),
  'GET /v1/attachments/:attachmentId/url': ok('Short-lived download URL', DownloadUrlDto),
  'DELETE /v1/attachments/:attachmentId': noContent('Delete an attachment'),

  'POST /v1/exports': accepted('Start a server export', ExportJobDto),
  'GET /v1/exports': ok('Recent exports', ExportListDto),
  'GET /v1/exports/:exportId': ok('Export status', ExportJobDto),
  'GET /v1/exports/:exportId/download': ok('Short-lived download URL', DownloadUrlDto),

  'GET /v1/graph': ok('Knowledge graph', GraphDto),
  'GET /v1/graph/neighbours/:noteId': ok("A note's neighbourhood", GraphDto),
  'GET /v1/search': ok('Full-text search', Paginated(SearchHitDto)),
};
