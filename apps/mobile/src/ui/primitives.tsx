// Generic primitives from TDD Section C, UI component styling.

import { Plus, type LucideIcon } from 'lucide-react-native';
import { useEffect, useState, type ReactNode } from 'react';
import {
  Animated,
  Modal,
  Pressable,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button } from './Button';
import { Text } from './Text';
import { alpha, useTheme } from './theme';

/** Card: radius 14, padding 16; flat with a Line border in light, Surface 2 in dark. */
export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const t = useTheme();
  return (
    <View
      style={[
        styles.card,
        t.scheme === 'light'
          ? { backgroundColor: t.colors.surface, borderWidth: 1, borderColor: t.colors.line }
          : { backgroundColor: t.colors.surface2 },
        style,
      ]}
    >
      {children}
    </View>
  );
}

/** Tag chip: 28 pt, coloured dot, fill at 12 %, selected adds a 1.5 pt border. */
export function Chip({
  label,
  colour,
  selected = false,
  onPress,
  accessibilityLabel,
}: {
  label: string;
  colour?: string | null;
  selected?: boolean;
  onPress?: () => void;
  /** Defaults to "Tag <label>"; filter chips pass their own. */
  accessibilityLabel?: string;
}) {
  const t = useTheme();
  const c = colour ?? t.colors.primary;
  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : 'text'}
      accessibilityLabel={accessibilityLabel ?? `Tag ${label}`}
      accessibilityState={{ selected }}
      onPress={onPress}
      hitSlop={8}
      style={[
        styles.chip,
        { backgroundColor: alpha(c, 0.12) },
        selected && { borderWidth: 1.5, borderColor: c },
      ]}
    >
      <View style={[styles.dot, { backgroundColor: c }]} />
      <Text variant="caption" maxFontSizeMultiplier={1.3} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

/** List row: min 56 pt, 16 pt insets, inset divider, Surface 2 when pressed. */
export function ListRow({
  title,
  subtitle,
  icon: Icon,
  right,
  onPress,
  divider = true,
  accessibilityLabel,
}: {
  title: string;
  subtitle?: string | undefined;
  icon?: LucideIcon;
  right?: ReactNode;
  onPress?: () => void;
  divider?: boolean;
  accessibilityLabel?: string;
}) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={accessibilityLabel ?? [title, subtitle].filter(Boolean).join(', ')}
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: t.colors.surface2 }]}
    >
      {Icon ? <Icon size={22} color={t.colors.inkSoft} style={styles.rowIcon} /> : null}
      <View style={styles.rowText}>
        <Text variant="headline" numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text variant="callout" tone="inkSoft" numberOfLines={2}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {right}
      {divider ? <View style={[styles.divider, { backgroundColor: t.colors.line }]} /> : null}
    </Pressable>
  );
}

/** Segmented control: 36 pt track in Surface 2, selected segment in Surface with a Line border. */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  label: string;
}) {
  const t = useTheme();
  return (
    <View
      accessibilityRole="tablist"
      accessibilityLabel={label}
      style={[styles.segTrack, { backgroundColor: t.colors.surface2 }]}
    >
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            accessibilityLabel={o.label}
            onPress={() => onChange(o.value)}
            style={[
              styles.segItem,
              selected && {
                backgroundColor: t.colors.surface,
                borderWidth: 1,
                borderColor: t.colors.line,
              },
            ]}
          >
            <Text
              variant="caption"
              tone={selected ? 'ink' : 'inkSoft'}
              maxFontSizeMultiplier={1.3}
              numberOfLines={1}
            >
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Floating action button: 56 pt Cobalt circle, 16 pt from the edges. */
export function Fab({
  label,
  onPress,
  icon: Icon = Plus,
}: {
  label: string;
  onPress: () => void;
  icon?: LucideIcon;
}) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [
        styles.fab,
        {
          backgroundColor: t.colors.primary,
          bottom: 16 + insets.bottom * 0,
          transform: [{ scale: pressed ? 0.96 : 1 }],
        },
      ]}
    >
      <Icon size={24} color={t.colors.onPrimary} />
    </Pressable>
  );
}

/** Loading placeholder that pulses gently. */
export function Skeleton({
  width = '100%',
  height = 16,
  style,
}: {
  width?: number | `${number}%`;
  height?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTheme();
  const [opacity] = useState(() => new Animated.Value(0.5));
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 600, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.5, duration: 600, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);
  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        { width, height, borderRadius: 8, backgroundColor: t.colors.surface2, opacity },
        style,
      ]}
    />
  );
}

/** Empty state: icon, title, one line of help and an optional action. */
export function EmptyState({
  icon: Icon,
  title,
  body,
  action,
}: {
  icon: LucideIcon;
  title: string;
  body?: string;
  action?: { label: string; onPress: () => void };
}) {
  const t = useTheme();
  return (
    <View style={styles.empty}>
      <Icon size={40} color={t.colors.inkFaint} />
      <Text variant="title2" align="center" style={styles.emptyTitle}>
        {title}
      </Text>
      {body ? (
        <Text variant="callout" tone="inkSoft" align="center">
          {body}
        </Text>
      ) : null}
      {action ? (
        <View style={styles.emptyAction}>
          <Button label={action.label} onPress={action.onPress} block={false} />
        </View>
      ) : null}
    </View>
  );
}

/** Bottom sheet: radius 20 top corners, 36 × 4 grabber, backdrop Ink at 40 %. */
export function Sheet({
  visible,
  onClose,
  title,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
}) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Close"
        style={[StyleSheet.absoluteFill, { backgroundColor: alpha('#1C2340', 0.4) }]}
        onPress={onClose}
      />
      <View
        style={[
          styles.sheet,
          { backgroundColor: t.colors.surface, paddingBottom: 16 + insets.bottom },
        ]}
      >
        <View style={[styles.grabber, { backgroundColor: t.colors.line }]} />
        {title ? (
          <Text variant="title2" style={styles.sheetTitle}>
            {title}
          </Text>
        ) : null}
        {children}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 14, padding: 16 },
  chip: {
    minHeight: 28,
    borderRadius: 14,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  row: {
    minHeight: 56,
    paddingHorizontal: 16,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
  },
  rowIcon: { marginRight: 14 },
  rowText: { flex: 1, gap: 2 },
  divider: {
    position: 'absolute',
    left: 16,
    right: 0,
    bottom: 0,
    height: StyleSheet.hairlineWidth * 2,
  },
  segTrack: { minHeight: 36, borderRadius: 10, flexDirection: 'row', padding: 2 },
  segItem: { flex: 1, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  fab: {
    position: 'absolute',
    right: 16,
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#1C2340',
    shadowOpacity: 0.2,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 8 },
  emptyTitle: { marginTop: 8 },
  emptyAction: { marginTop: 16 },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 16,
  },
  grabber: { width: 36, height: 4, borderRadius: 2, alignSelf: 'center', marginVertical: 8 },
  sheetTitle: { marginBottom: 12 },
});
