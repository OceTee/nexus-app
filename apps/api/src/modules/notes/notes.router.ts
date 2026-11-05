import {
  BaseRevInput,
  NoteCreateInput,
  NoteListQuery,
  NoteParams,
  NoteTagParams,
  NoteTagsReplaceInput,
  NoteUpdateInput,
  NoteVersionListQuery,
  NoteVersionParams,
  PageQuery,
  ResolveConflictInput,
} from '@nexus/shared';
import { Router } from 'express';
import { input, validate } from '../../http/middleware/validate';
import type { NotesService } from './notes.service';

type NoteP = { noteId: string };
type VersionP = { noteId: string; versionId: string };
type TagP = { noteId: string; tagId: string };
type Page = { cursor?: string; limit: number };

/** `/v1/notes` (17 endpoints; TDD Section F, Notes). Mounted behind requireAuth. */
export function notesRouter(svc: NotesService): Router {
  const r = Router();
  const p = (req: { valid: { params?: unknown } }) => input<NoteP>(req.valid.params);

  r.get('/', validate({ query: NoteListQuery }), async (req, res) => {
    res.json(await svc.list(req.auth.userId, input(req.valid.query)));
  });

  r.post('/', validate({ body: NoteCreateInput }), async (req, res) => {
    res.status(201).json(await svc.create(req.auth.userId, req.auth.deviceId, req.body));
  });

  r.get('/trash', validate({ query: PageQuery }), async (req, res) => {
    const q = input<Page>(req.valid.query);
    res.json(await svc.trash(req.auth.userId, q.cursor, q.limit));
  });

  r.get('/:noteId', validate({ params: NoteParams }), async (req, res) => {
    res.json(await svc.get(req.auth.userId, p(req).noteId));
  });

  r.patch('/:noteId', validate({ params: NoteParams, body: NoteUpdateInput }), async (req, res) => {
    res.json(await svc.update(req.auth.userId, req.auth.deviceId, p(req).noteId, req.body));
  });

  r.delete('/:noteId', validate({ params: NoteParams, body: BaseRevInput }), async (req, res) => {
    await svc.remove(req.auth.userId, req.auth.deviceId, p(req).noteId, req.body.baseRev);
    res.status(204).end();
  });

  r.post('/:noteId/restore', validate({ params: NoteParams }), async (req, res) => {
    res.json(await svc.restore(req.auth.userId, req.auth.deviceId, p(req).noteId));
  });

  r.get(
    '/:noteId/versions',
    validate({ params: NoteParams, query: NoteVersionListQuery }),
    async (req, res) => {
      const q = input<Page>(req.valid.query);
      res.json(await svc.versions(req.auth.userId, p(req).noteId, q.cursor, q.limit));
    },
  );

  r.get(
    '/:noteId/versions/:versionId',
    validate({ params: NoteVersionParams }),
    async (req, res) => {
      const { noteId, versionId } = input<VersionP>(req.valid.params);
      res.json(await svc.version(req.auth.userId, noteId, versionId));
    },
  );

  r.post(
    '/:noteId/versions/:versionId/restore',
    validate({ params: NoteVersionParams, body: BaseRevInput }),
    async (req, res) => {
      const { noteId, versionId } = input<VersionP>(req.valid.params);
      res.json(
        await svc.restoreVersion(
          req.auth.userId,
          req.auth.deviceId,
          noteId,
          versionId,
          req.body.baseRev,
        ),
      );
    },
  );

  r.get('/:noteId/backlinks', validate({ params: NoteParams }), async (req, res) => {
    res.json(await svc.backlinks(req.auth.userId, p(req).noteId));
  });

  r.get('/:noteId/links', validate({ params: NoteParams }), async (req, res) => {
    res.json(await svc.outgoing(req.auth.userId, p(req).noteId));
  });

  r.get('/:noteId/conflicts', validate({ params: NoteParams }), async (req, res) => {
    res.json(await svc.conflicts(req.auth.userId, p(req).noteId));
  });

  r.post(
    '/:noteId/conflicts/:versionId/resolve',
    validate({ params: NoteVersionParams, body: ResolveConflictInput }),
    async (req, res) => {
      const { noteId, versionId } = input<VersionP>(req.valid.params);
      res.json(
        await svc.resolveConflict(req.auth.userId, req.auth.deviceId, noteId, versionId, req.body),
      );
    },
  );

  r.put(
    '/:noteId/tags',
    validate({ params: NoteParams, body: NoteTagsReplaceInput }),
    async (req, res) => {
      res.json(
        await svc.replaceTags(req.auth.userId, req.auth.deviceId, p(req).noteId, req.body.tagIds),
      );
    },
  );

  r.post('/:noteId/tags/:tagId', validate({ params: NoteTagParams }), async (req, res) => {
    const { noteId, tagId } = input<TagP>(req.valid.params);
    res.json(await svc.addTag(req.auth.userId, req.auth.deviceId, noteId, tagId));
  });

  r.delete('/:noteId/tags/:tagId', validate({ params: NoteTagParams }), async (req, res) => {
    const { noteId, tagId } = input<TagP>(req.valid.params);
    res.json(await svc.removeTag(req.auth.userId, req.auth.deviceId, noteId, tagId));
  });

  return r;
}
