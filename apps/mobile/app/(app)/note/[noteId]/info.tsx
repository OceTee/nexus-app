import { useLocalSearchParams } from 'expo-router';
import { ScrollView, StyleSheet, View } from 'react-native';
import { repos } from '@/data/repos';
import { useLocalQuery } from '@/data/useLocalQuery';
import { getDb } from '@/infra/db';
import { fullDate } from '@/features/notes/format';
import { collectionPath } from '@/features/notes/useNoteDecor';
import { Header, Screen, Text, useTheme } from '@/ui';

/** S-15 Note info: metadata, word count and sync state. */
export default function NoteInfo() {
  const t = useTheme();
  const { noteId } = useLocalSearchParams<{ noteId: string }>();
  const { data } = useLocalQuery(
    ['notes', 'note_links', 'collections', 'outbox', 'attachments'],
    async () => {
      const db = getDb();
      const [note, collections, outgoing, incoming, pending, attachments] = await Promise.all([
        repos.notes.get(noteId),
        repos.collections.list(),
        db.getFirstAsync<{ n: number }>(
          `SELECT count(*) AS n FROM note_links WHERE source_note_id = ?`,
          [noteId],
        ),
        db.getFirstAsync<{ n: number }>(
          `SELECT count(*) AS n FROM note_links WHERE target_note_id = ?`,
          [noteId],
        ),
        db.getFirstAsync<{ n: number }>(
          `SELECT count(*) AS n FROM outbox WHERE entity_id = ? OR entity_id LIKE ?`,
          [noteId, `${noteId}:%`],
        ),
        repos.attachments.forNote(noteId),
      ]);
      return {
        note,
        path: collectionPath(
          new Map(collections.map((c) => [c.id, c])),
          note?.collectionId ?? null,
        ),
        outgoing: Number(outgoing?.n ?? 0),
        incoming: Number(incoming?.n ?? 0),
        pending: Number(pending?.n ?? 0),
        attachments: attachments.length,
      };
    },
    [noteId],
  );

  const n = data?.note;
  const chars = n?.bodyMd.length ?? 0;
  const rows: [string, string][] = n
    ? [
        ['Words', n.wordCount.toLocaleString()],
        ['Characters', chars.toLocaleString()],
        ['Reading time', `${Math.max(1, Math.round(n.wordCount / 220))} min`],
        ['Collection', data.path.map((c) => c.name).join(' › ') || 'Unfiled'],
        ['Links out', String(data.outgoing)],
        ['Linked from', String(data.incoming)],
        ['Attachments', String(data.attachments)],
        ['Created', fullDate(n.createdAt)],
        ['Last edited', fullDate(n.updatedAt)],
        ['Revision', n.serverRev > 0 ? `${n.serverRev} on the server` : 'Not on the server yet'],
        [
          'Sync',
          data.pending > 0
            ? `${data.pending} change${data.pending === 1 ? '' : 's'} waiting`
            : n.dirty
              ? 'Waiting'
              : 'Up to date',
        ],
      ]
    : [];

  return (
    <Screen>
      <Header title="Info" />
      <ScrollView contentContainerStyle={styles.pad}>
        <Text variant="title2" style={styles.title}>
          {n?.title || 'Untitled'}
        </Text>
        {rows.map(([k, v]) => (
          <View key={k} style={[styles.row, { borderBottomColor: t.colors.line }]} accessible>
            <Text variant="callout" tone="inkSoft">
              {k}
            </Text>
            <Text variant="callout" style={styles.value}>
              {v}
            </Text>
          </View>
        ))}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  pad: { padding: 16, paddingBottom: 48 },
  title: { marginBottom: 16 },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  value: { flexShrink: 1, textAlign: 'right' },
});
