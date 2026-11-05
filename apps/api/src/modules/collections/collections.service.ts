import type {
  CollectionCreateInput,
  CollectionDto,
  CollectionMoveInput,
  CollectionUpdateInput,
  SyncOp,
} from '@nexus/shared';
import { v7 as uuidv7 } from 'uuid';
import type { Db } from '../../db/client';
import { withUser, type Tx } from '../../db/withUser';
import { DuplicateError, NotFoundError } from '../../lib/errors';
import type { ContentEngine } from '../content/applyOps';
import { loadCollections } from '../content/loaders';
import { throwIfNotApplied } from '../notes/notes.service';

const upsert = (
  entityId: string,
  baseRev: number,
  payload: Extract<SyncOp, { type: 'collection.upsert' }>['payload'],
): SyncOp => ({
  opId: uuidv7(),
  createdAt: new Date().toISOString(),
  type: 'collection.upsert',
  entityId,
  baseRev,
  payload,
});

/** `/v1/collections` (TDD Section F, Collections). Writes go through the op engine. */
export class CollectionsService {
  constructor(
    private readonly db: Db,
    private readonly engine: ContentEngine,
  ) {}

  async list(userId: string): Promise<{ items: CollectionDto[] }> {
    return withUser(this.db, userId, async (tx) => ({
      items: [...(await loadCollections(tx)).values()],
    }));
  }

  async get(userId: string, id: string): Promise<CollectionDto> {
    return withUser(this.db, userId, (tx) => this.load(tx, id));
  }

  async create(
    userId: string,
    deviceId: string,
    input: CollectionCreateInput,
  ): Promise<CollectionDto> {
    return withUser(this.db, userId, async (tx) => {
      if ((await loadCollections(tx, [input.id])).size > 0)
        throw new DuplicateError('collection', input.id);
      const { id, ...payload } = input;
      throwIfNotApplied(
        await this.engine.apply(tx, { userId, deviceId }, upsert(id, 0, payload)),
        'Collection',
      );
      return this.load(tx, id);
    });
  }

  /** Rename, icon, sort order; a stale rename is a 409 CONFLICT. */
  async update(
    userId: string,
    deviceId: string,
    id: string,
    input: CollectionUpdateInput,
  ): Promise<CollectionDto> {
    // Structural fields still apply on a stale rename, so commit before reporting the conflict.
    const { outcome, dto } = await withUser(this.db, userId, async (tx) => {
      const current = await this.load(tx, id);
      const outcome = await this.engine.apply(
        tx,
        { userId, deviceId },
        upsert(id, input.baseRev, {
          parentId: current.parentId,
          name: input.name ?? current.name,
          icon: input.icon === undefined ? current.icon : input.icon,
          sortOrder: input.sortOrder ?? current.sortOrder,
        }),
      );
      if (outcome.result.status === 'rejected') throwIfNotApplied(outcome, 'Collection');
      return { outcome, dto: await this.load(tx, id) };
    });
    throwIfNotApplied(outcome, 'Collection');
    return dto;
  }

  /** Reparent (last writer wins); 422 DEPTH_EXCEEDED or CYCLE. */
  async move(
    userId: string,
    deviceId: string,
    id: string,
    input: CollectionMoveInput,
  ): Promise<CollectionDto> {
    return withUser(this.db, userId, async (tx) => {
      const current = await this.load(tx, id);
      throwIfNotApplied(
        await this.engine.apply(
          tx,
          { userId, deviceId },
          upsert(id, current.serverRev, {
            parentId: input.parentId,
            name: current.name,
            icon: current.icon,
            sortOrder: input.sortOrder ?? current.sortOrder,
          }),
        ),
        'Collection',
      );
      return this.load(tx, id);
    });
  }

  async remove(userId: string, deviceId: string, id: string, baseRev: number): Promise<void> {
    await withUser(this.db, userId, async (tx) => {
      throwIfNotApplied(
        await this.engine.apply(
          tx,
          { userId, deviceId },
          {
            opId: uuidv7(),
            createdAt: new Date().toISOString(),
            type: 'collection.delete',
            entityId: id,
            baseRev,
          },
        ),
        'Collection',
      );
    });
  }

  private async load(tx: Tx, id: string): Promise<CollectionDto> {
    const found = (await loadCollections(tx, [id])).get(id);
    if (!found) throw new NotFoundError('Collection');
    return found;
  }
}
