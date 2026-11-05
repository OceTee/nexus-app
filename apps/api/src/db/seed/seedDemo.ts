import { createHash } from 'node:crypto';
import { normaliseTitle } from '@nexus/shared';
import { eq } from 'drizzle-orm';
import type { Db } from '../client';
import * as s from '../schema';
import { buildDemoCorpus, DEMO_DISPLAY_NAME, DEMO_EMAIL } from './demoCorpus';

export interface SeedSummary {
  userId: string;
  collections: number;
  tags: number;
  notes: number;
  links: number;
  ghostLinks: number;
  versions: number;
  attachments: number;
  changes: number;
}

/**
 * Deletes and recreates the demo user with the full corpus, in one
 * transaction. Runs as the schema owner (RLS does not apply). Idempotent.
 */
export async function seedDemo(db: Db, passwordHash: string): Promise<SeedSummary> {
  const corpus = buildDemoCorpus();

  return db.transaction(async (tx) => {
    await tx.delete(s.users).where(eq(s.users.email, DEMO_EMAIL));

    const [user] = await tx
      .insert(s.users)
      .values({
        email: DEMO_EMAIL,
        passwordHash,
        displayName: DEMO_DISPLAY_NAME,
        emailVerifiedAt: new Date().toISOString(),
        settings: { telemetryOptIn: false, push: { newDeviceSignIn: true } },
      })
      .returning({ id: s.users.id });
    const userId = user!.id;

    await tx.insert(s.devices).values({ ...corpus.device, userId });
    await tx.insert(s.collections).values(corpus.collections.map((c) => ({ ...c, userId })));
    await tx.insert(s.tags).values(corpus.tags.map((t) => ({ ...t, userId })));

    await tx.insert(s.notes).values(
      corpus.notes.map((n) => ({
        id: n.id,
        userId,
        collectionId: n.collectionId,
        title: n.title,
        bodyMd: n.bodyMd,
        bodyText: n.bodyText,
        excerpt: n.excerpt,
        wordCount: n.wordCount,
        isPinned: n.isPinned,
        serverRev: n.serverRev,
        contentHash: n.contentHash,
        lastDeviceId: corpus.device.id,
        createdAt: n.createdAt,
        updatedAt: n.updatedAt,
      })),
    );

    const tagId = new Map(corpus.tags.map((t) => [t.name, t.id]));
    await tx.insert(s.noteTags).values(
      corpus.notes.flatMap((n) =>
        n.tagNames.map((name) => ({
          noteId: n.id,
          tagId: tagId.get(name)!,
          userId,
          createdAt: n.createdAt,
        })),
      ),
    );

    // Links are resolved here; the ghost-link trigger covers notes created later.
    const byTitle = new Map(corpus.notes.map((n) => [normaliseTitle(n.title), n.id]));
    const links = corpus.notes.flatMap((n) =>
      n.linkTargets.map((target) => ({
        sourceNoteId: n.id,
        userId,
        targetTitleNorm: target,
        targetNoteId: byTitle.get(target) ?? null,
      })),
    );
    await tx.insert(s.noteLinks).values(links);

    await tx
      .insert(s.noteVersions)
      .values(corpus.versions.map((v) => ({ ...v, userId, deviceId: corpus.device.id })));

    const noteByTitle = new Map(corpus.notes.map((n) => [n.title, n.id]));
    await tx.insert(s.attachments).values(
      corpus.attachments.map((a) => ({
        id: a.id,
        userId,
        noteId: noteByTitle.get(a.noteTitle)!,
        filename: a.filename,
        mimeType: a.mimeType,
        sizeBytes: a.sizeBytes,
        width: a.width,
        height: a.height,
        status: 'uploaded' as const,
        storageKey: `u/${userId}/${a.id}/${a.filename}`,
        sha256: createHash('sha256').update(a.filename).digest('hex'),
      })),
    );

    // Change feed rows so a fresh device can bootstrap through sync.
    const feed = [
      ...corpus.collections.map((c) => ({
        entityType: 'collection' as const,
        entityId: c.id,
        rev: 1,
      })),
      ...corpus.tags.map((t) => ({ entityType: 'tag' as const, entityId: t.id, rev: 1 })),
      ...corpus.notes.map((n) => ({
        entityType: 'note' as const,
        entityId: n.id,
        rev: n.serverRev,
      })),
      ...corpus.attachments.map((a) => ({
        entityType: 'attachment' as const,
        entityId: a.id,
        rev: 1,
      })),
    ];
    await tx.insert(s.changes).values(
      feed.map((f) => ({
        ...f,
        userId,
        entityKey: f.entityId,
        op: 'upsert' as const,
        deviceId: corpus.device.id,
      })),
    );

    return {
      userId,
      collections: corpus.collections.length,
      tags: corpus.tags.length,
      notes: corpus.notes.length,
      links: links.length,
      ghostLinks: links.filter((l) => l.targetNoteId === null).length,
      versions: corpus.versions.length,
      attachments: corpus.attachments.length,
      changes: feed.length,
    };
  });
}
