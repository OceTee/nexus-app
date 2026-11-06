import { Image } from 'expo-image';
import { CloudOff, ImageOff } from 'lucide-react-native';
import { Pressable, StyleSheet, View } from 'react-native';
import { Skeleton, Text, useTheme } from '@/ui';
import { useAttachment } from './useAttachment';

/** An attachment image inside rendered Markdown; tap opens the viewer (S-26). */
export function AttachmentImage({ id, onPress }: { id: string; onPress: () => void }) {
  const t = useTheme();
  const load = useAttachment(id);

  if (load.kind === 'loading') return <Skeleton height={180} style={styles.gap} />;
  if (load.kind !== 'ready') {
    const Icon = load.kind === 'offline' ? CloudOff : ImageOff;
    return (
      <Pressable
        accessibilityRole="button"
        onPress={onPress}
        style={[styles.placeholder, styles.gap, { backgroundColor: t.colors.surface2 }]}
      >
        <Icon size={20} color={t.colors.inkSoft} />
        <Text variant="footnote" tone="inkSoft">
          {load.kind === 'offline' ? 'Image available when online' : 'Image missing'}
        </Text>
      </Pressable>
    );
  }

  const { row, file } = load;
  const ratio = row.width && row.height ? row.width / row.height : 4 / 3;
  return (
    <Pressable
      accessibilityRole="imagebutton"
      accessibilityLabel={row.filename}
      accessibilityHint="Opens the image"
      onPress={onPress}
      style={styles.gap}
    >
      <View style={[styles.frame, { backgroundColor: t.colors.surface2 }]}>
        <Image
          source={{ uri: file.uri }}
          style={{ width: '100%', aspectRatio: Math.max(0.3, Math.min(3, ratio)) }}
          contentFit="cover"
          transition={120}
        />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  gap: { marginBottom: 12 },
  frame: { borderRadius: 12, overflow: 'hidden' },
  placeholder: {
    height: 72,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
});
