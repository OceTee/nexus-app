import type { ConflictStrategy, NoteDto } from '@nexus/shared';
import { events } from '@/data/events';
import { repos } from '@/data/repos';
import type { ConflictRow } from '@/data/rows';
import { applyChanges } from '@/data/sync/applyChanges';
import { ApiError, api } from '@/infra/apiClient';
import { getDb } from '@/infra/db';

/**
 * Resolves a conflict (S-13). Online, the server applies the choice and marks
 * its conflict version resolved; the returned note replaces the local copy.
 * Offline, the choice is saved locally and syncs as an ordinary upsert.
 */
export async function resolveConflict(
  conflict: ConflictRow,
  strategy: ConflictStrategy,
  merged?: { title: string; bodyMd: string },
): Promise<void> {
  const note = await repos.notes.get(conflict.note_id);
  const mine = await repos.versions.get(conflict.version_id);
  if (!note) {
    await repos.conflicts.resolve(conflict.id);
    return;
  }

  const localWrite = async () => {
    if (strategy === 'keep_mine' && mine) {
      await repos.notes.save({ id: note.id, title: mine.title, bodyMd: mine.body_md });
    } else if (strategy === 'merged' && merged) {
      await repos.notes.save({ id: note.id, ...merged });
    }
  };

  if (note.dirty) {
    // Local edits are already queued on top of the server copy; keep them flowing.
    await localWrite();
  } else {
    try {
      const updated = await api<NoteDto>(
        `/v1/notes/${note.id}/conflicts/${conflict.version_id}/resolve`,
        {
          method: 'POST',
          body: {
            strategy,
            baseRev: note.serverRev,
            ...(strategy === 'merged' && merged ? merged : {}),
          },
        },
      );
      await getDb().withExclusiveTransactionAsync(async (tx) => {
        await applyChanges(tx, [
          {
            seq: 0,
            entityType: 'note',
            entityKey: updated.id,
            op: 'upsert',
            rev: updated.serverRev,
            data: updated,
          },
        ]);
      });
      events.emit('notes', 'note_links');
    } catch (e) {
      // Offline, or already resolved elsewhere: fall back to a local write.
      if (!(e instanceof ApiError) || e.isNetwork || e.status === 409) await localWrite();
      else if (e.status !== 404) throw e;
    }
  }
  await repos.conflicts.resolve(conflict.id);
}
