import type { SyncOp, TagCreateInput, TagDto, TagUpdateInput } from '@nexus/shared';
import { and, eq, isNull } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import type { Db } from '../../db/client';
import { noteTags, tags } from '../../db/schema';
import { withUser, type Tx } from '../../db/withUser';
import { BusinessRuleError, DuplicateError, NotFoundError } from '../../lib/errors';
import type { ContentEngine } from '../content/applyOps';
import { loadTags } from '../content/loaders';
import { throwIfNotApplied } from '../notes/notes.service';

const now = () => new Date().toISOString();

/** `/v1/tags` (TDD Section F, Tags). Writes go through the op engine. */
export class TagsService {
  constructor(
    private readonly db: Db,
    private readonly engine: ContentEngine,
  ) {}

  async list(userId: string): Promise<{ items: TagDto[] }> {
    return withUser(this.db, userId, async (tx) => ({ items: [...(await loadTags(tx)).values()] }));
  }

  async create(userId: string, deviceId: string, input: TagCreateInput): Promise<TagDto> {
    return withUser(this.db, userId, async (tx) => {
      const [existing] = await tx.select({ id: tags.id }).from(tags).where(eq(tags.id, input.id));
      if (existing) throw new DuplicateError('tag', input.id);
      const { id, ...payload } = input;
      const op: SyncOp = {
        opId: uuidv7(),
        createdAt: now(),
        type: 'tag.upsert',
        entityId: id,
        baseRev: 0,
        payload,
      };
      throwIfNotApplied(await this.engine.apply(tx, { userId, deviceId }, op), 'Tag');
      return this.load(tx, id);
    });
  }

  /** Rename or recolour; tags merge last-writer-wins, so only name clashes fail (409 DUPLICATE). */
  async update(
    userId: string,
    deviceId: string,
    id: string,
    input: TagUpdateInput,
  ): Promise<TagDto> {
    return withUser(this.db, userId, async (tx) => {
      const current = await this.load(tx, id);
      const op: SyncOp = {
        opId: uuidv7(),
        createdAt: now(),
        type: 'tag.upsert',
        entityId: id,
        baseRev: input.baseRev,
        payload: {
          name: input.name ?? current.name,
          colour: input.colour === undefined ? current.colour : input.colour,
        },
      };
      throwIfNotApplied(await this.engine.apply(tx, { userId, deviceId }, op), 'Tag');
      return this.load(tx, id);
    });
  }

  async remove(userId: string, deviceId: string, id: string): Promise<void> {
    await withUser(this.db, userId, async (tx) => {
      const current = await this.load(tx, id);
      const op: SyncOp = {
        opId: uuidv7(),
        createdAt: now(),
        type: 'tag.delete',
        entityId: id,
        baseRev: current.serverRev,
      };
      throwIfNotApplied(await this.engine.apply(tx, { userId, deviceId }, op), 'Tag');
    });
  }

  /** Moves every note from `sourceId` to `targetId`, then deletes the source tag. */
  async merge(
    userId: string,
    deviceId: string,
    sourceId: string,
    targetId: string,
  ): Promise<{ movedNotes: number }> {
    if (sourceId === targetId)
      throw new BusinessRuleError('BUSINESS_RULE', 'A tag cannot merge into itself');
    return withUser(this.db, userId, async (tx) => {
      const [source] = await Promise.all([this.load(tx, sourceId), this.load(tx, targetId)]);
      const members = await tx
        .select({ noteId: noteTags.noteId })
        .from(noteTags)
        .where(and(eq(noteTags.tagId, sourceId), isNull(noteTags.deletedAt)));
      const ctx = { userId, deviceId };
      let moved = 0;
      for (const { noteId } of members) {
        if (await this.engine.applyMembership(tx, ctx, noteId, targetId, 'add', now())) moved += 1;
      }
      const op: SyncOp = {
        opId: uuidv7(),
        createdAt: now(),
        type: 'tag.delete',
        entityId: sourceId,
        baseRev: source.serverRev,
      };
      throwIfNotApplied(await this.engine.apply(tx, ctx, op), 'Tag');
      return { movedNotes: moved };
    });
  }

  private async load(tx: Tx, id: string): Promise<TagDto> {
    const found = (await loadTags(tx, [id])).get(id);
    const [row] = await tx.select({ deletedAt: tags.deletedAt }).from(tags).where(eq(tags.id, id));
    if (!found || !row || row.deletedAt !== null) throw new NotFoundError('Tag');
    return found;
  }
}
