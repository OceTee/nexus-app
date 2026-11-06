import { getDb } from '../../infra/db';
import type { SqlDb } from '../../infra/sql';
import { CollectionsRepo } from './collections';
import { LinksRepo } from './links';
import { NotesRepo } from './notes';
import { OutboxRepo } from './outbox';
import { AttachmentsRepo, ConflictsRepo, SyncStateRepo, VersionsRepo } from './state';
import { TagsRepo } from './tags';

export interface Repos {
  outbox: OutboxRepo;
  notes: NotesRepo;
  tags: TagsRepo;
  collections: CollectionsRepo;
  links: LinksRepo;
  syncState: SyncStateRepo;
  versions: VersionsRepo;
  conflicts: ConflictsRepo;
  attachments: AttachmentsRepo;
}

/** Builds the repositories over a database accessor (the app's handle, or a test db). */
export function createRepos(db: () => SqlDb = getDb): Repos {
  const outbox = new OutboxRepo();
  return {
    outbox,
    notes: new NotesRepo(db, outbox),
    tags: new TagsRepo(db, outbox),
    collections: new CollectionsRepo(db, outbox),
    links: new LinksRepo(db),
    syncState: new SyncStateRepo(db),
    versions: new VersionsRepo(db),
    conflicts: new ConflictsRepo(db),
    attachments: new AttachmentsRepo(db),
  };
}

/** App-wide repositories over the open database. */
export const repos = createRepos();

export * from './collections';
export * from './links';
export * from './notes';
export * from './outbox';
export * from './state';
export * from './tags';
