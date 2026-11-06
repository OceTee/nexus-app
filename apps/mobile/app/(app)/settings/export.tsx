import { useLocalSearchParams } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { Braces, FileText, type LucideIcon } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, View } from 'react-native';
import { repos } from '@/data/repos';
import { useLocalQuery } from '@/data/useLocalQuery';
import {
  exportScope,
  runExport,
  type ExportFormat,
  type ExportProgress,
  type ExportResult,
} from '@/features/export/exporter';
import { collectionPath } from '@/features/notes/useNoteDecor';
import { useIsOffline } from '@/features/sync/OfflineNotice';
import { ActionSheet, alpha, Button, Header, Screen, Sheet, Text, toast, useTheme } from '@/ui';

const PHASE_LABEL: Record<ExportProgress['phase'], string> = {
  notes: 'Writing notes',
  attachments: 'Adding attachments',
  zip: 'Compressing',
  done: 'Done',
};

/** S-33 Export: Markdown bundle or JSON, generated on the device. */
export default function Export() {
  const t = useTheme();
  const params = useLocalSearchParams<{ collectionId?: string }>();
  const offline = useIsOffline();
  const [format, setFormat] = useState<ExportFormat>('markdown');
  const [collectionId, setCollectionId] = useState<string | null>(params.collectionId ?? null);
  const [includeAttachments, setIncludeAttachments] = useState(true);
  const [includeVersions, setIncludeVersions] = useState(false);
  const [picking, setPicking] = useState(false);
  const [progress, setProgress] = useState<ExportProgress | null>(null);
  const [result, setResult] = useState<ExportResult | null>(null);

  const { data } = useLocalQuery(
    ['notes', 'collections', 'attachments'],
    async () => ({
      scope: await exportScope(collectionId),
      collections: await repos.collections.list(),
    }),
    [collectionId],
  );
  const map = new Map((data?.collections ?? []).map((c) => [c.id, c]));
  const scopeLabel = collectionId
    ? collectionPath(map, collectionId)
        .map((c) => c.name)
        .join(' › ')
    : 'Everything';

  const share = async (r: ExportResult) => {
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(r.file.uri, {
        mimeType: 'application/zip',
        dialogTitle: 'Export NEXUS',
      });
    } else toast.show('Sharing is not available on this device');
  };

  const start = async () => {
    setResult(null);
    setProgress({ phase: 'notes', done: 0, total: data?.scope.notes.length ?? 0 });
    try {
      const r = await runExport(
        { format, collectionId, includeAttachments, includeVersions },
        setProgress,
      );
      setResult(r);
      await share(r);
    } catch {
      setProgress(null);
      toast.show('The export failed. Free some space and try again.');
    }
  };

  const card = (value: ExportFormat, icon: LucideIcon, title: string, body: string) => {
    const on = format === value;
    const Icon = icon;
    return (
      <Pressable
        accessibilityRole="radio"
        accessibilityState={{ checked: on }}
        onPress={() => setFormat(value)}
        style={[
          styles.card,
          {
            borderColor: on ? t.colors.primary : t.colors.line,
            backgroundColor: on ? alpha(t.colors.primary, 0.06) : t.colors.surface,
          },
        ]}
      >
        <Icon size={24} color={on ? t.colors.primary : t.colors.inkSoft} />
        <View style={styles.flex}>
          <Text variant="headline">{title}</Text>
          <Text variant="footnote" tone="inkSoft">
            {body}
          </Text>
        </View>
      </Pressable>
    );
  };

  const needDownload = includeAttachments ? (data?.scope.needDownload ?? 0) : 0;

  return (
    <Screen>
      <Header title="Export" />
      <ScrollView contentContainerStyle={styles.pad}>
        {card(
          'markdown',
          FileText,
          'Markdown bundle',
          'A folder of .md files with front-matter, plus attachments. Opens in any editor.',
        )}
        {card(
          'json',
          Braces,
          'JSON',
          'Every note, collection and tag in one file, for scripts and backups.',
        )}

        <Text variant="caption" tone="inkSoft" style={styles.section}>
          WHAT TO EXPORT
        </Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => setPicking(true)}
          style={[styles.row, { borderBottomColor: t.colors.line }]}
        >
          <Text variant="body" style={styles.flex}>
            Notes
          </Text>
          <Text variant="body" style={{ color: t.colors.primary }} numberOfLines={1}>
            {scopeLabel}
          </Text>
        </Pressable>
        <View style={[styles.row, { borderBottomColor: t.colors.line }]}>
          <Text variant="body" style={styles.flex}>
            Include attachments
          </Text>
          <Switch
            accessibilityLabel="Include attachments"
            value={includeAttachments}
            onValueChange={setIncludeAttachments}
            trackColor={{ true: t.colors.primary, false: t.colors.line }}
          />
        </View>
        {format === 'json' ? (
          <View style={[styles.row, { borderBottomColor: t.colors.line }]}>
            <Text variant="body" style={styles.flex}>
              Include version history
            </Text>
            <Switch
              accessibilityLabel="Include version history"
              value={includeVersions}
              onValueChange={setIncludeVersions}
              trackColor={{ true: t.colors.primary, false: t.colors.line }}
            />
          </View>
        ) : null}

        <Text variant="callout" tone="inkSoft" style={styles.estimate}>
          {data?.scope.notes.length ?? 0} notes
          {includeAttachments ? ` · ${data?.scope.attachments.length ?? 0} attachments` : ''}
          {needDownload > 0 ? ` (${needDownload} need downloading)` : ''}
        </Text>
        {needDownload > 0 && offline ? (
          <Text variant="footnote" tone="danger" style={styles.estimate}>
            You are offline: attachments not on this device will be left out and listed.
          </Text>
        ) : null}

        <Button
          label="Export"
          onPress={() => void start()}
          disabled={progress !== null && progress.phase !== 'done'}
        />
      </ScrollView>

      <ActionSheet
        visible={picking}
        onClose={() => setPicking(false)}
        title="Export"
        actions={[
          { label: 'Everything', onPress: () => setCollectionId(null) },
          ...(data?.collections ?? []).map((c) => ({
            label: collectionPath(map, c.id)
              .map((p) => p.name)
              .join(' › '),
            onPress: () => setCollectionId(c.id),
          })),
        ]}
      />

      <Sheet
        visible={progress !== null}
        onClose={() => (progress?.phase === 'done' ? setProgress(null) : undefined)}
        title={progress?.phase === 'done' ? 'Export ready' : 'Exporting…'}
      >
        <View style={styles.sheet}>
          {progress && progress.phase !== 'done' ? (
            <>
              <Text variant="callout">
                {PHASE_LABEL[progress.phase]}
                {progress.total > 1 ? ` ${progress.done} of ${progress.total}` : ''}
              </Text>
              <View style={[styles.track, { backgroundColor: t.colors.surface2 }]}>
                <View
                  style={[
                    styles.fill,
                    {
                      backgroundColor: t.colors.primary,
                      width: `${Math.round((progress.done / Math.max(1, progress.total)) * 100)}%`,
                    },
                  ]}
                />
              </View>
            </>
          ) : result ? (
            <>
              <Text variant="callout">
                {result.notes} notes and {result.attachments} attachments in {result.file.name}.
              </Text>
              {result.omitted.length > 0 ? (
                <Text variant="footnote" tone="danger">
                  Left out (not on this device): {result.omitted.join(', ')}
                </Text>
              ) : null}
              <Button label="Share again" variant="secondary" onPress={() => void share(result)} />
              <Button label="Done" variant="text" onPress={() => setProgress(null)} />
            </>
          ) : null}
        </View>
      </Sheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  pad: { padding: 16, paddingBottom: 48, gap: 12 },
  card: {
    flexDirection: 'row',
    gap: 14,
    padding: 16,
    borderRadius: 14,
    borderWidth: 1.5,
    alignItems: 'center',
  },
  flex: { flex: 1, gap: 2 },
  section: { marginTop: 12 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 52,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  estimate: { marginTop: 4 },
  sheet: { paddingHorizontal: 20, gap: 12 },
  track: { height: 6, borderRadius: 3, overflow: 'hidden' },
  fill: { height: 6 },
});
