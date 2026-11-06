import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import * as Sharing from 'expo-sharing';
import {
  CloudOff,
  FileText,
  HardDriveDownload,
  MoreVertical,
  Share2,
  Trash2,
} from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { deleteAttachment } from '@/features/attachments/attachments';
import { formatBytes } from '@/features/notes/format';
import { isPinned, setPinned } from '@/features/attachments/cache';
import { useAttachment } from '@/features/attachments/useAttachment';
import {
  ActionSheet,
  Button,
  ConfirmSheet,
  EmptyState,
  Header,
  IconButton,
  Screen,
  Text,
  toast,
  useTheme,
} from '@/ui';

/** Pinch to zoom, pan when zoomed, double-tap to toggle 2x. */
function ZoomableImage({ uri, label }: { uri: string; label: string }) {
  const scale = useSharedValue(1);
  const saved = useSharedValue(1);
  const x = useSharedValue(0);
  const y = useSharedValue(0);
  const sx = useSharedValue(0);
  const sy = useSharedValue(0);

  const pinch = Gesture.Pinch()
    .onUpdate((e) => {
      scale.value = Math.min(6, Math.max(1, saved.value * e.scale));
    })
    .onEnd(() => {
      saved.value = scale.value;
      if (scale.value <= 1) {
        x.value = withTiming(0);
        y.value = withTiming(0);
      }
    });
  const pan = Gesture.Pan()
    .averageTouches(true)
    .onUpdate((e) => {
      if (scale.value > 1) {
        x.value = sx.value + e.translationX;
        y.value = sy.value + e.translationY;
      }
    })
    .onEnd(() => {
      sx.value = x.value;
      sy.value = y.value;
    });
  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd(() => {
      const next = scale.value > 1 ? 1 : 2;
      scale.value = withTiming(next);
      saved.value = next;
      if (next === 1) {
        x.value = withTiming(0);
        y.value = withTiming(0);
        sx.value = 0;
        sy.value = 0;
      }
    });

  const style = useAnimatedStyle(() => ({
    transform: [{ translateX: x.value }, { translateY: y.value }, { scale: scale.value }],
  }));

  return (
    <GestureDetector gesture={Gesture.Simultaneous(pinch, pan, doubleTap)}>
      <Animated.View style={[styles.flex, style]}>
        <Image
          source={{ uri }}
          style={styles.flex}
          contentFit="contain"
          accessibilityLabel={label}
          accessibilityHint="Pinch or double-tap to zoom"
        />
      </Animated.View>
    </GestureDetector>
  );
}

/** S-26 Attachment viewer: zoomable image, or a PDF opened in the system viewer. */
export default function AttachmentViewer() {
  const t = useTheme();
  const { attachmentId } = useLocalSearchParams<{ attachmentId: string }>();
  const load = useAttachment(attachmentId);
  const [menu, setMenu] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [pinned, setPinnedState] = useState(false);

  useEffect(() => {
    void isPinned(attachmentId).then(setPinnedState);
  }, [attachmentId, load.kind]);

  if (load.kind === 'loading') {
    return (
      <Screen>
        <Header title="Attachment" />
        <ActivityIndicator color={t.colors.primary} style={styles.spinner} />
      </Screen>
    );
  }
  if (load.kind === 'missing') {
    return (
      <Screen>
        <Header title="Attachment" />
        <EmptyState icon={FileText} title="This attachment was deleted" />
      </Screen>
    );
  }
  if (load.kind === 'offline') {
    return (
      <Screen>
        <Header title={load.row.filename} />
        <EmptyState
          icon={CloudOff}
          title="Not on this device yet"
          body="Connect to download it, or keep it offline next time you open it."
        />
      </Screen>
    );
  }

  const { row, file } = load;
  const isImage = row.mime_type.startsWith('image/');
  const share = async () => {
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(file.uri, { mimeType: row.mime_type, dialogTitle: row.filename });
    } else toast.show('Sharing is not available on this device');
  };

  return (
    <Screen edges={['top', 'left', 'right', 'bottom']}>
      <Header
        title={row.filename}
        right={
          <IconButton icon={MoreVertical} label="More actions" onPress={() => setMenu(true)} />
        }
      />
      {isImage ? (
        <View style={[styles.flex, { backgroundColor: t.colors.surface2 }]}>
          <ZoomableImage uri={file.uri} label={row.filename} />
        </View>
      ) : (
        <View style={styles.pdf}>
          <FileText size={56} color={t.colors.primary} />
          <Text variant="title2" align="center">
            {row.filename}
          </Text>
          <Text variant="callout" tone="inkSoft">
            PDF · {formatBytes(row.size_bytes)}
          </Text>
          <Button
            label="Open"
            onPress={() => void file.preview().catch(() => share())}
            block={false}
          />
        </View>
      )}
      <View style={[styles.meta, { borderTopColor: t.colors.line }]}>
        <Text variant="footnote" tone="inkSoft">
          {formatBytes(row.size_bytes)}
          {row.width && row.height ? ` · ${row.width} × ${row.height}` : ''}
          {row.status === 'pending' ? ' · waiting to upload' : ''}
          {pinned ? ' · kept offline' : ''}
        </Text>
      </View>
      <ActionSheet
        visible={menu}
        onClose={() => setMenu(false)}
        actions={[
          { label: 'Share', icon: Share2, onPress: () => void share() },
          {
            label: pinned ? 'Stop keeping offline' : 'Keep offline',
            icon: HardDriveDownload,
            onPress: () =>
              void setPinned(row, !pinned).then(() => {
                setPinnedState(!pinned);
                toast.show(pinned ? 'Can be cleared to save space' : 'Kept on this device');
              }),
          },
          { label: 'Delete', icon: Trash2, destructive: true, onPress: () => setConfirm(true) },
        ]}
      />
      <ConfirmSheet
        visible={confirm}
        onClose={() => setConfirm(false)}
        title="Delete this attachment?"
        body="It is removed from the note on every device."
        confirmLabel="Delete"
        destructive
        onConfirm={() =>
          void deleteAttachment(row).then(() => {
            toast.show('Attachment deleted');
            router.back();
          })
        }
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  spinner: { marginTop: 48 },
  pdf: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 },
  meta: { paddingHorizontal: 16, paddingVertical: 10, borderTopWidth: StyleSheet.hairlineWidth },
});
