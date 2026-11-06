import { normaliseTitle } from '@nexus/shared';
import { router, useLocalSearchParams } from 'expo-router';
import { CheckCircle2 } from 'lucide-react-native';
import { useState } from 'react';
import { StyleSheet, TextInput, useWindowDimensions, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { repos } from '@/data/repos';
import { useLocalQuery } from '@/data/useLocalQuery';
import { MarkdownPreview } from '@/features/editor/MarkdownPreview';
import { mergeDraft } from '@/features/history/diff';
import { resolveConflict } from '@/features/sync/conflicts';
import { alpha, Button, EmptyState, Header, Screen, Text, toast, useTheme } from '@/ui';

const time = (iso: string) =>
  new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

/** S-13 Conflict resolution: compare both copies, then keep one or merge. */
export default function ConflictScreen() {
  const t = useTheme();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { noteId } = useLocalSearchParams<{ noteId: string }>();
  const [merging, setMerging] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const { data } = useLocalQuery(
    ['notes', 'conflicts', 'note_versions_local'],
    async () => {
      const [note, open] = await Promise.all([
        repos.notes.get(noteId),
        repos.conflicts.open(noteId),
      ]);
      const conflict = open[0] ?? null;
      const mine = conflict ? await repos.versions.get(conflict.version_id) : null;
      return { note, conflict, mine };
    },
    [noteId],
  );

  if (data && (!data.conflict || !data.note)) {
    return (
      <Screen>
        <Header title="Resolve conflict" />
        <EmptyState
          icon={CheckCircle2}
          title="Already resolved"
          body="This conflict was resolved, possibly on another device."
          action={{ label: 'Back to the note', onPress: () => router.back() }}
        />
      </Screen>
    );
  }
  if (!data?.note || !data.conflict) return <Screen>{null}</Screen>;

  const { note, conflict, mine } = data;
  const mineBody = mine?.body_md ?? '';
  const choose = async (strategy: 'keep_server' | 'keep_mine' | 'merged', body?: string) => {
    setBusy(true);
    try {
      await resolveConflict(
        conflict,
        strategy,
        body !== undefined ? { title: note.title, bodyMd: body } : undefined,
      );
      toast.show(
        strategy === 'keep_server'
          ? 'Kept the server copy'
          : strategy === 'keep_mine'
            ? 'Kept your copy'
            : 'Merged',
      );
      router.back();
    } catch {
      toast.show('Could not resolve the conflict. Try again.');
      setBusy(false);
    }
  };

  if (merging !== null) {
    return (
      <Screen edges={['top', 'left', 'right', 'bottom']}>
        <KeyboardAvoidingView
          behavior="padding"
          keyboardVerticalOffset={insets.top}
          style={styles.flex}
        >
          <Header title="Merge" onBack={() => setMerging(null)} backLabel="Back to comparison" />
          <Text variant="footnote" tone="inkSoft" style={styles.pad}>
            The server text comes first; paragraphs only on this device follow the line.
          </Text>
          <TextInput
            accessibilityLabel="Merged text"
            multiline
            value={merging}
            onChangeText={setMerging}
            textAlignVertical="top"
            style={[t.type('body'), styles.editor, { color: t.colors.ink }]}
          />
          <View style={[styles.bar, { borderTopColor: t.colors.line }]}>
            <Button
              label="Save merged note"
              loading={busy}
              onPress={() => void choose('merged', merging)}
            />
          </View>
        </KeyboardAvoidingView>
      </Screen>
    );
  }

  const pane = (label: string, body: string) => (
    <View style={[styles.pane, { borderColor: t.colors.line }]}>
      <Text
        variant="caption"
        tone="inkSoft"
        style={[styles.paneLabel, { backgroundColor: alpha(t.colors.primary, 0.08) }]}
      >
        {label.toUpperCase()}
      </Text>
      <MarkdownPreview body={body} onWikiLink={() => undefined} normalise={normaliseTitle} />
    </View>
  );

  return (
    <Screen edges={['top', 'left', 'right', 'bottom']}>
      <Header title="Resolve conflict" onBack={() => router.back()} backLabel="Decide later" />
      <Text variant="callout" tone="inkSoft" style={styles.pad}>
        Edited on {conflict.device_name ?? 'another device'} at {time(note.updatedAt)} and on this
        device at {time(mine?.created_at ?? conflict.created_at)}. Nothing is lost whichever you
        choose.
      </Text>
      <View style={[styles.panes, width >= 700 && styles.sideBySide]}>
        {pane('On server', note.bodyMd)}
        {pane('This device', mineBody)}
      </View>
      <View style={[styles.actions, { borderTopColor: t.colors.line }]}>
        <Button
          label="Keep server"
          variant="secondary"
          disabled={busy}
          onPress={() => void choose('keep_server')}
          block={false}
        />
        <Button
          label="Keep mine"
          variant="secondary"
          disabled={busy || !mine}
          onPress={() => void choose('keep_mine')}
          block={false}
        />
        <Button
          label="Merge"
          disabled={busy}
          onPress={() => setMerging(mergeDraft(note.bodyMd, mineBody))}
          block={false}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  pad: { paddingHorizontal: 16, paddingVertical: 8 },
  panes: { flex: 1, gap: 8, paddingHorizontal: 8 },
  sideBySide: { flexDirection: 'row' },
  pane: { flex: 1, borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, overflow: 'hidden' },
  paneLabel: { paddingHorizontal: 12, paddingVertical: 6 },
  actions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
    padding: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  editor: { flex: 1, paddingHorizontal: 16, paddingTop: 8 },
  bar: { padding: 16, borderTopWidth: StyleSheet.hairlineWidth },
});
