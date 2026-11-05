// Wiki-link storage (BR-05, BR-06). Links are rewritten from the parsed body
// on every accepted note upsert; ghost links resolve when a matching note
// appears (DB trigger) and resolve immediately here when the target exists.

import {
  normaliseTitle,
  parseWikiLinks,
  type BacklinkDto,
  type OutgoingLinkDto,
} from '@nexus/shared';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { noteLinks, notes } from '../../db/schema';
import type { Tx } from '../../db/withUser';

/** The sentence around `index` (for backlink context), trimmed to 240 characters. */
export function sentenceAround(body: string, index: number): string {
  const before = body.slice(0, index);
  const after = body.slice(index);
  const start = Math.max(before.lastIndexOf('\n'), before.search(/[.!?]\s[^.!?]*$/) + 1, 0);
  const endMatch = /[.!?](\s|$)|\n/.exec(after);
  const end = index + (endMatch ? endMatch.index + 1 : after.length);
  const sentence = body.slice(start, end).replace(/\s+/g, ' ').trim();
  return sentence.length > 240 ? `${sentence.slice(0, 239)}…` : sentence;
}

export class LinksService {
  /** Replaces a note's outgoing links with those in `bodyMd`. */
  async rewrite(tx: Tx, userId: string, noteId: string, bodyMd: string): Promise<void> {
    await tx.delete(noteLinks).where(eq(noteLinks.sourceNoteId, noteId));
    const targets = [...new Set(parseWikiLinks(bodyMd).map((l) => l.targetNorm))];
    if (targets.length === 0) return;

    const found = await tx
      .select({ id: notes.id, titleNorm: notes.titleNorm })
      .from(notes)
      .where(
        and(eq(notes.userId, userId), inArray(notes.titleNorm, targets), isNull(notes.deletedAt)),
      );
    const byNorm = new Map<string, string>();
    for (const n of found)
      if (n.titleNorm && !byNorm.has(n.titleNorm)) byNorm.set(n.titleNorm, n.id);

    await tx.insert(noteLinks).values(
      targets.map((t) => ({
        sourceNoteId: noteId,
        userId,
        targetTitleNorm: t,
        targetNoteId: byNorm.get(t) ?? null,
      })),
    );
  }

  /** Points links at a note again after it is restored or renamed. */
  async resolveTo(tx: Tx, userId: string, noteId: string, title: string): Promise<void> {
    await tx
      .update(noteLinks)
      .set({ targetNoteId: noteId })
      .where(
        and(
          eq(noteLinks.userId, userId),
          isNull(noteLinks.targetNoteId),
          eq(noteLinks.targetTitleNorm, normaliseTitle(title)),
        ),
      );
  }

  /** Unlinks a trashed note so links to it become ghosts. */
  async detach(tx: Tx, noteId: string): Promise<void> {
    await tx
      .update(noteLinks)
      .set({ targetNoteId: null })
      .where(eq(noteLinks.targetNoteId, noteId));
  }

  /** Notes linking to `noteId`, with the sentence containing the link. */
  async backlinks(tx: Tx, noteId: string): Promise<BacklinkDto[]> {
    const rows = await tx
      .select({
        id: notes.id,
        title: notes.title,
        bodyMd: notes.bodyMd,
        norm: noteLinks.targetTitleNorm,
      })
      .from(noteLinks)
      .innerJoin(notes, eq(notes.id, noteLinks.sourceNoteId))
      .where(and(eq(noteLinks.targetNoteId, noteId), isNull(notes.deletedAt)))
      .orderBy(sql`${notes.updatedAt} DESC`);
    return rows.map((r) => {
      const link = parseWikiLinks(r.bodyMd).find((l) => l.targetNorm === r.norm);
      return {
        noteId: r.id,
        title: r.title,
        context: link ? sentenceAround(r.bodyMd, link.start) : '',
      };
    });
  }

  /** Outgoing links in document order, including ghosts (`targetNoteId: null`). */
  async outgoing(tx: Tx, noteId: string, bodyMd: string): Promise<OutgoingLinkDto[]> {
    const rows = await tx.select().from(noteLinks).where(eq(noteLinks.sourceNoteId, noteId));
    const resolved = new Map(rows.map((r) => [r.targetTitleNorm, r.targetNoteId]));
    const seen = new Set<string>();
    const out: OutgoingLinkDto[] = [];
    for (const link of parseWikiLinks(bodyMd)) {
      if (seen.has(link.targetNorm)) continue;
      seen.add(link.targetNorm);
      out.push({ targetTitle: link.target, targetNoteId: resolved.get(link.targetNorm) ?? null });
    }
    return out;
  }
}
