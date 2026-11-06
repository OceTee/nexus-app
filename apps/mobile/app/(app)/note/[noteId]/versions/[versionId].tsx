import { normaliseTitle, type NoteVersionDetailDto } from '@nexus/shared';
import { useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';
import { repos } from '@/data/repos';
import { useLocalQuery } from '@/data/useLocalQuery';
import { MarkdownPreview } from '@/features/editor/MarkdownPreview';
import { diffLines } from '@/features/history/diff';
import { fullDate } from '@/features/notes/format';
import { api } from '@/infra/apiClient';
import {
  alpha,
  Button,
  ConfirmSheet,
  EmptyState,
  Header,
  Screen,
  SegmentedControl,
  Text,
  toast,
  useTheme,
} from '@/ui';
import { CloudOff } from 'lucide-react-native';

interface VersionView {
  rev: number;
  title: string;
  bodyMd: string;
  createdAt: string;
}

/** S-12 Version detail: read a version, diff it against the note, restore it. */
export default function VersionDetail() {
  const t = useTheme();
  const { noteId, versionId, source } = useLocalSearchParams<{
    noteId: string;
    versionId: string;
    source?: 'local' | 'server';
  }>();
  const [view, setView] = useState<'content' | 'diff'>('content');
  const [confirm, setConfirm] = useState(false);

  const { data: localData } = useLocalQuery(
    ['notes', 'note_versions_local'],
    async () => ({
      note: await repos.notes.get(noteId),
      version: source === 'server' ? null : await repos.versions.get(versionId),
    }),
    [noteId, versionId, source],
  );
  const remote = useQuery({
    queryKey: ['version', noteId, versionId],
    enabled: source === 'server',
    queryFn: () => api<NoteVersionDetailDto>(`/v1/notes/${noteId}/versions/${versionId}`),
  });

  const version: VersionView | null = useMemo(() => {
    if (source === 'server') {
      const v = remote.data;
      return v ? { rev: v.rev, title: v.title, bodyMd: v.bodyMd, createdAt: v.createdAt } : null;
    }
    const v = localData?.version;
    return v ? { rev: v.rev, title: v.title, bodyMd: v.body_md, createdAt: v.created_at } : null;
  }, [source, remote.data, localData?.version]);

  const current = localData?.note;
  const diff = useMemo(
    () => (version && current ? diffLines(current.bodyMd, version.bodyMd) : []),
    [version, current],
  );
  const same = Boolean(
    version && current && version.bodyMd === current.bodyMd && version.title === current.title,
  );

  const restore = async () => {
    if (!version) return;
    await repos.notes.save({ id: noteId, title: version.title, bodyMd: version.bodyMd });
    toast.show(`Restored revision ${version.rev}`);
    router.dismissTo({ pathname: '/note/[noteId]', params: { noteId } });
  };

  if (source === 'server' && remote.isLoading) {
    return (
      <Screen>
        <Header title="Version" />
        <ActivityIndicator style={styles.spinner} color={t.colors.primary} />
      </Screen>
    );
  }
  if (!version) {
    return (
      <Screen>
        <Header title="Version" />
        <EmptyState
          icon={CloudOff}
          title="This version is not available"
          body="Server versions need a connection."
          action={{ label: 'Try again', onPress: () => void remote.refetch() }}
        />
      </Screen>
    );
  }

  return (
    <Screen edges={['top', 'left', 'right', 'bottom']}>
      <Header title={`Revision ${version.rev}`} />
      <View style={styles.sub}>
        <Text variant="footnote" tone="inkSoft">
          {fullDate(version.createdAt)}
        </Text>
        <SegmentedControl
          label="Show"
          value={view}
          onChange={setView}
          options={[
            { value: 'content', label: 'Content' },
            { value: 'diff', label: 'Changes' },
          ]}
        />
      </View>
      {view === 'content' ? (
        <MarkdownPreview
          body={version.bodyMd}
          reading
          onWikiLink={() => undefined}
          normalise={normaliseTitle}
        />
      ) : (
        <ScrollView contentContainerStyle={styles.diff}>
          <Text variant="footnote" tone="inkSoft" style={styles.legend}>
            Compared with the note as it is now.
          </Text>
          {diff.map((line, i) => (
            <Text
              key={i}
              style={[
                t.type('mono'),
                { color: t.colors.ink },
                line.kind === 'added' && { backgroundColor: alpha(t.colors.primary, 0.14) },
                line.kind === 'removed' && {
                  backgroundColor: alpha('#E11D48', 0.14),
                  textDecorationLine: 'line-through',
                },
              ]}
              accessibilityLabel={`${line.kind === 'same' ? '' : line.kind === 'added' ? 'In this version: ' : 'Only in the current note: '}${line.text}`}
            >
              {line.kind === 'added' ? '+ ' : line.kind === 'removed' ? '− ' : '  '}
              {line.text || ' '}
            </Text>
          ))}
        </ScrollView>
      )}
      <View style={[styles.bar, { borderTopColor: t.colors.line }]}>
        <Button
          label={same ? 'This is the current text' : 'Restore this version'}
          disabled={same}
          onPress={() => setConfirm(true)}
        />
      </View>
      <ConfirmSheet
        visible={confirm}
        onClose={() => setConfirm(false)}
        title="Restore this version?"
        body="The note's current text is kept in History, so you can switch back."
        confirmLabel="Restore"
        onConfirm={() => void restore()}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  spinner: { marginTop: 48 },
  sub: { paddingHorizontal: 16, paddingTop: 8, gap: 8 },
  diff: { padding: 16, paddingBottom: 48 },
  legend: { marginBottom: 8 },
  bar: { padding: 16, borderTopWidth: StyleSheet.hairlineWidth },
});
