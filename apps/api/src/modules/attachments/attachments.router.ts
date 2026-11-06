import {
  ATTACHMENT_MIME_TYPES,
  AttachmentCreateInput,
  AttachmentListQuery,
  AttachmentParams,
  LIMITS,
} from '@nexus/shared';
import { Router, type RequestHandler } from 'express';
import { requireVerified } from '../../http/middleware/auth';
import { consume, type Limiters } from '../../http/middleware/rateLimit';
import { input, validate } from '../../http/middleware/validate';
import { AppError } from '../../lib/errors';
import type { AttachmentsService } from './attachments.service';

type P = { attachmentId: string };

/** Specific codes for the two most common refusals (TDD Section F, Attachments). */
const precheck: RequestHandler = (req, _res, next) => {
  const body = (req.body ?? {}) as { mimeType?: unknown; sizeBytes?: unknown };
  if (
    typeof body.mimeType === 'string' &&
    !(ATTACHMENT_MIME_TYPES as readonly string[]).includes(body.mimeType)
  ) {
    throw new AppError(
      400,
      'UNSUPPORTED_TYPE',
      'Only JPEG, PNG, WebP images and PDFs can be attached',
    );
  }
  if (typeof body.sizeBytes === 'number' && body.sizeBytes > LIMITS.attachmentBytesMax) {
    throw new AppError(413, 'PAYLOAD_TOO_LARGE', 'Attachments are limited to 25 MB');
  }
  next();
};

/** `/v1/attachments` (6 endpoints). Mounted behind requireAuth. */
export function attachmentsRouter(svc: AttachmentsService, limiters: Limiters): Router {
  const r = Router();
  const id = (req: { valid: { params?: unknown } }) => input<P>(req.valid.params).attachmentId;

  r.get('/', validate({ query: AttachmentListQuery }), async (req, res) => {
    const q = input<{ noteId?: string; cursor?: string; limit: number }>(req.valid.query);
    res.json(await svc.list(req.auth.userId, q.noteId, q.cursor, q.limit));
  });

  r.post(
    '/',
    requireVerified,
    precheck,
    validate({ body: AttachmentCreateInput }),
    async (req, res) => {
      await consume(limiters.attachments, `user:${req.auth.userId}`, res);
      res.status(201).json(await svc.create(req.auth.userId, req.body));
    },
  );

  r.post(
    '/:attachmentId/complete',
    requireVerified,
    validate({ params: AttachmentParams }),
    async (req, res) => {
      res.json(await svc.complete(req.auth.userId, req.auth.deviceId, id(req)));
    },
  );

  r.get('/:attachmentId', validate({ params: AttachmentParams }), async (req, res) => {
    res.json(await svc.get(req.auth.userId, id(req)));
  });

  r.get('/:attachmentId/url', validate({ params: AttachmentParams }), async (req, res) => {
    res.json(await svc.downloadUrl(req.auth.userId, id(req)));
  });

  r.delete('/:attachmentId', validate({ params: AttachmentParams }), async (req, res) => {
    await svc.remove(req.auth.userId, req.auth.deviceId, id(req));
    res.status(204).end();
  });

  return r;
}
