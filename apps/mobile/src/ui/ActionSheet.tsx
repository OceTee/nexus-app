import type { LucideIcon } from 'lucide-react-native';
import { Pressable, ScrollView, StyleSheet } from 'react-native';
import { Sheet } from './primitives';
import { Text } from './Text';
import { useTheme } from './theme';

export interface SheetAction {
  label: string;
  icon?: LucideIcon;
  onPress: () => void;
  destructive?: boolean;
  disabled?: boolean;
}

/** A bottom sheet of actions: context menus and overflow menus (TDD Section C). */
export function ActionSheet({
  visible,
  onClose,
  title,
  actions,
}: {
  visible: boolean;
  onClose: () => void;
  title?: string;
  actions: SheetAction[];
}) {
  const t = useTheme();
  return (
    <Sheet visible={visible} onClose={onClose} {...(title ? { title } : {})}>
      <ScrollView accessibilityRole="menu" style={styles.list}>
        {actions.map(({ label, icon: Icon, onPress, destructive, disabled }, i) => {
          const colour = destructive ? t.colors.danger : t.colors.ink;
          return (
            <Pressable
              key={`${i}-${label}`}
              accessibilityRole="menuitem"
              accessibilityState={{ disabled: Boolean(disabled) }}
              disabled={disabled}
              onPress={() => {
                onClose();
                onPress();
              }}
              style={({ pressed }) => [
                styles.row,
                pressed && { backgroundColor: t.colors.surfacePressed },
                disabled && styles.disabled,
              ]}
            >
              {Icon ? <Icon size={22} color={colour} style={styles.icon} /> : null}
              <Text variant="body" style={{ color: colour }}>
                {label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </Sheet>
  );
}

/** Confirmation sheet with one primary (often destructive) action and Cancel. */
export function ConfirmSheet({
  visible,
  onClose,
  title,
  body,
  confirmLabel,
  onConfirm,
  destructive = false,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  body?: string;
  confirmLabel: string;
  onConfirm: () => void;
  destructive?: boolean;
}) {
  const t = useTheme();
  return (
    <Sheet visible={visible} onClose={onClose} title={title}>
      {body ? (
        <Text variant="callout" tone="inkSoft" style={styles.body}>
          {body}
        </Text>
      ) : null}
      <Pressable
        accessibilityRole="button"
        onPress={() => {
          onClose();
          onConfirm();
        }}
        style={({ pressed }) => [
          styles.row,
          pressed && { backgroundColor: t.colors.surfacePressed },
        ]}
      >
        <Text
          variant="headline"
          style={{ color: destructive ? t.colors.danger : t.colors.primary }}
        >
          {confirmLabel}
        </Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        onPress={onClose}
        style={({ pressed }) => [
          styles.row,
          pressed && { backgroundColor: t.colors.surfacePressed },
        ]}
      >
        <Text variant="body">Cancel</Text>
      </Pressable>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  list: { maxHeight: 440 },
  row: { minHeight: 52, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20 },
  icon: { marginRight: 16 },
  disabled: { opacity: 0.4 },
  body: { paddingHorizontal: 20, marginBottom: 12 },
});
