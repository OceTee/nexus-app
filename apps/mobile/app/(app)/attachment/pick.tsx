import { router, useLocalSearchParams } from 'expo-router';
import { Camera, FileUp, Images, type LucideIcon } from 'lucide-react-native';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import {
  AttachmentError,
  addAttachment,
  type PickSource,
} from '@/features/attachments/attachments';
import { Header, Screen, Text, toast, useTheme } from '@/ui';

const SOURCES: { source: PickSource; icon: LucideIcon; label: string; hint: string }[] = [
  { source: 'camera', icon: Camera, label: 'Take a photo', hint: 'Use the camera' },
  { source: 'library', icon: Images, label: 'Photo library', hint: 'JPEG, PNG, WebP or HEIC' },
  { source: 'files', icon: FileUp, label: 'Files', hint: 'Images or PDF, up to 25 MB' },
];

/** S-27 Attachment picker (modal): camera, library or files. */
export default function AttachmentPicker() {
  const t = useTheme();
  const { noteId } = useLocalSearchParams<{ noteId: string }>();
  const [busy, setBusy] = useState(false);

  const choose = async (source: PickSource) => {
    setBusy(true);
    try {
      const added = await addAttachment(noteId, source);
      if (added) {
        toast.show(`Attached ${added.filename}`);
        router.back();
        return;
      }
    } catch (e) {
      toast.show(e instanceof AttachmentError ? e.message : 'Could not attach that file');
    }
    setBusy(false);
  };

  return (
    <Screen>
      <Header title="Attach" backLabel="Cancel" />
      <View style={styles.pad}>
        {SOURCES.map((s) => (
          <Pressable
            key={s.source}
            accessibilityRole="button"
            accessibilityLabel={s.label}
            accessibilityHint={s.hint}
            disabled={busy}
            onPress={() => void choose(s.source)}
            style={({ pressed }) => [
              styles.row,
              { backgroundColor: pressed ? t.colors.surfacePressed : t.colors.surface2 },
            ]}
          >
            <s.icon size={24} color={t.colors.primary} />
            <View style={styles.flex}>
              <Text variant="headline">{s.label}</Text>
              <Text variant="footnote" tone="inkSoft">
                {s.hint}
              </Text>
            </View>
          </Pressable>
        ))}
        {busy ? <ActivityIndicator color={t.colors.primary} style={styles.spinner} /> : null}
        <Text variant="footnote" tone="inkFaint" style={styles.note}>
          Attachments are saved on this device straight away and upload when you are online.
        </Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  pad: { padding: 16, gap: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 16, padding: 16, borderRadius: 14 },
  flex: { flex: 1, gap: 2 },
  spinner: { marginTop: 8 },
  note: { marginTop: 8 },
});
