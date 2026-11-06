import {
  Bold,
  Braces,
  Heading,
  Italic,
  Link2,
  Paperclip,
  List,
  ListTodo,
  Redo2,
  Undo2,
  type LucideIcon,
} from 'lucide-react-native';
import { ScrollView, StyleSheet, View } from 'react-native';
import { IconButton, useTheme } from '@/ui';

export type ToolbarAction =
  'bold' | 'italic' | 'heading' | 'list' | 'task' | 'code' | 'link' | 'attach' | 'undo' | 'redo';

const ITEMS: { action: ToolbarAction; icon: LucideIcon; label: string }[] = [
  { action: 'bold', icon: Bold, label: 'Bold' },
  { action: 'italic', icon: Italic, label: 'Italic' },
  { action: 'heading', icon: Heading, label: 'Heading' },
  { action: 'list', icon: List, label: 'Bulleted list' },
  { action: 'task', icon: ListTodo, label: 'Task' },
  { action: 'code', icon: Braces, label: 'Code' },
  { action: 'link', icon: Link2, label: 'Link to a note' },
  { action: 'attach', icon: Paperclip, label: 'Attach a file' },
];

/** Keyboard toolbar (S-09): formatting on the left, undo and redo pinned right. */
export function EditorToolbar({
  onAction,
  canUndo,
  canRedo,
}: {
  onAction: (a: ToolbarAction) => void;
  canUndo: boolean;
  canRedo: boolean;
}) {
  const t = useTheme();
  return (
    <View
      accessibilityRole="toolbar"
      style={[styles.bar, { backgroundColor: t.colors.surface2, borderTopColor: t.colors.line }]}
    >
      <ScrollView horizontal keyboardShouldPersistTaps="always" style={styles.scroll}>
        {ITEMS.map((i) => (
          <IconButton
            key={i.action}
            icon={i.icon}
            label={i.label}
            onPress={() => onAction(i.action)}
          />
        ))}
      </ScrollView>
      <IconButton icon={Undo2} label="Undo" disabled={!canUndo} onPress={() => onAction('undo')} />
      <IconButton icon={Redo2} label="Redo" disabled={!canRedo} onPress={() => onAction('redo')} />
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 48,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 4,
  },
  scroll: { flex: 1 },
});
