import { router } from 'expo-router';
import { FileText, ImageIcon, UploadCloud } from 'lucide-react-native';
import { Pressable, ScrollView, StyleSheet } from 'react-native';
import { Text, useTheme } from '@/ui';
import { useNoteAttachments } from './useAttachment';

/** AttachmentStrip (S-09): a note's attachments as chips; tap opens S-26. */
export function AttachmentStrip({ noteId }: { noteId: string }) {
  const t = useTheme();
  const items = useNoteAttachments(noteId);
  if (items.length === 0) return null;
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
      accessibilityLabel="Attachments"
    >
      {items.map((a) => {
        const Icon =
          a.status === 'pending'
            ? UploadCloud
            : a.mime_type.startsWith('image/')
              ? ImageIcon
              : FileText;
        return (
          <Pressable
            key={a.id}
            accessibilityRole="button"
            accessibilityLabel={`${a.filename}${a.status === 'pending' ? ', waiting to upload' : ''}`}
            onPress={() =>
              router.push({
                pathname: '/attachment/[attachmentId]',
                params: { attachmentId: a.id },
              })
            }
            style={[styles.chip, { backgroundColor: t.colors.surface2 }]}
          >
            <Icon size={14} color={a.status === 'pending' ? t.colors.accent : t.colors.inkSoft} />
            <Text variant="caption" numberOfLines={1} style={styles.name}>
              {a.filename}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { gap: 8, paddingVertical: 2 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 28,
    paddingHorizontal: 10,
    borderRadius: 14,
  },
  name: { maxWidth: 160 },
});
