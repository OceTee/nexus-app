import { Pin, PinOff, Trash2 } from 'lucide-react-native';
import { memo, useRef } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Swipeable, { type SwipeableMethods } from 'react-native-gesture-handler/ReanimatedSwipeable';
import type { Note, Tag } from '@/data/repos';
import { Chip, Text, useTheme } from '@/ui';
import { relativeDate } from './format';

export interface NoteRowProps {
  note: Note;
  tags: Tag[];
  breadcrumb: string;
  conflicted: boolean;
  onPress: (note: Note) => void;
  onLongPress: (note: Note) => void;
  onTogglePin: (note: Note) => void;
  onDelete: (note: Note) => void;
}

/**
 * NoteRow (S-08): title, two-line excerpt, relative date, up to three tag
 * chips, collection breadcrumb and a conflict dot. Swipe right reveals Pin,
 * swipe left reveals Delete.
 */
export const NoteRow = memo(function NoteRow({
  note,
  tags,
  breadcrumb,
  conflicted,
  onPress,
  onLongPress,
  onTogglePin,
  onDelete,
}: NoteRowProps) {
  const t = useTheme();
  const swipe = useRef<SwipeableMethods>(null);
  const PinIcon = note.isPinned ? PinOff : Pin;
  const title = note.title || 'Untitled';

  const panel = (
    colour: string,
    label: string,
    Icon: typeof Pin,
    action: () => void,
    align: 'flex-start' | 'flex-end',
  ) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={() => {
        swipe.current?.close();
        action();
      }}
      style={[styles.panel, { backgroundColor: colour, alignItems: align }]}
    >
      <View style={styles.panelInner}>
        <Icon size={22} color="#FFFFFF" />
        <Text variant="caption" style={styles.panelText}>
          {label}
        </Text>
      </View>
    </Pressable>
  );

  return (
    <Swipeable
      ref={swipe}
      friction={1.6}
      leftThreshold={64}
      rightThreshold={64}
      renderLeftActions={() =>
        panel(
          t.colors.primary,
          note.isPinned ? 'Unpin' : 'Pin',
          PinIcon,
          () => onTogglePin(note),
          'flex-start',
        )
      }
      renderRightActions={() =>
        panel(t.colors.danger, 'Delete', Trash2, () => onDelete(note), 'flex-end')
      }
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={[
          title,
          note.isPinned ? 'pinned' : null,
          conflicted ? 'has a conflict' : null,
          relativeDate(note.updatedAt),
        ]
          .filter(Boolean)
          .join(', ')}
        accessibilityHint="Opens the note. Long press for more actions."
        accessibilityActions={[
          { name: 'pin', label: note.isPinned ? 'Unpin' : 'Pin' },
          { name: 'delete', label: 'Delete' },
        ]}
        onAccessibilityAction={(e) =>
          e.nativeEvent.actionName === 'pin' ? onTogglePin(note) : onDelete(note)
        }
        onPress={() => onPress(note)}
        onLongPress={() => onLongPress(note)}
        style={({ pressed }) => [
          styles.row,
          { backgroundColor: pressed ? t.colors.surface2 : t.colors.surface },
        ]}
      >
        <View style={styles.titleLine}>
          {note.isPinned ? <Pin size={14} color={t.colors.accent} style={styles.pin} /> : null}
          <Text variant="headline" numberOfLines={1} style={styles.flex}>
            {title}
          </Text>
          {conflicted ? (
            <View style={[styles.conflictDot, { backgroundColor: t.colors.accent }]} />
          ) : null}
          <Text variant="footnote" tone="inkFaint">
            {relativeDate(note.updatedAt)}
          </Text>
        </View>
        {note.excerpt ? (
          <Text variant="callout" tone="inkSoft" numberOfLines={2}>
            {note.excerpt}
          </Text>
        ) : null}
        {tags.length > 0 || breadcrumb ? (
          <View style={styles.meta}>
            {tags.slice(0, 3).map((tag) => (
              <Chip key={tag.id} label={tag.name} colour={tag.colour} />
            ))}
            {breadcrumb ? (
              <Text variant="footnote" tone="inkFaint" numberOfLines={1} style={styles.flex}>
                {breadcrumb}
              </Text>
            ) : null}
          </View>
        ) : null}
        <View style={[styles.divider, { backgroundColor: t.colors.line }]} />
      </Pressable>
    </Swipeable>
  );
});

const styles = StyleSheet.create({
  row: { paddingHorizontal: 16, paddingVertical: 12, gap: 4 },
  titleLine: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  pin: { marginRight: -2 },
  flex: { flex: 1 },
  conflictDot: { width: 8, height: 8, borderRadius: 4 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  divider: {
    position: 'absolute',
    left: 16,
    right: 0,
    bottom: 0,
    height: StyleSheet.hairlineWidth,
  },
  panel: { width: 96, justifyContent: 'center' },
  panelInner: { width: 96, alignItems: 'center', gap: 4 },
  panelText: { color: '#FFFFFF' },
});
