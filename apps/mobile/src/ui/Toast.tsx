import { useEffect, useState } from 'react';
import { Animated, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { create } from 'zustand';
import { Text } from './Text';
import { useTheme } from './theme';

interface ToastState {
  message: string | null;
  id: number;
  show(message: string): void;
  hide(): void;
}

/** One toast at a time; `toast.show('Saved')` from anywhere. */
export const useToastStore = create<ToastState>()((set) => ({
  message: null,
  id: 0,
  show: (message) => set((s) => ({ message, id: s.id + 1 })),
  hide: () => set({ message: null }),
}));

export const toast = { show: (m: string) => useToastStore.getState().show(m) };

/** Toast host: bottom-anchored, radius 12, inverted colours, 2.5 s (TDD Section C). */
export function ToastHost() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { message, id, hide } = useToastStore();
  const [opacity] = useState(() => new Animated.Value(0));

  useEffect(() => {
    if (!message) return;
    Animated.timing(opacity, { toValue: 1, duration: 120, useNativeDriver: true }).start();
    const timer = setTimeout(() => {
      Animated.timing(opacity, { toValue: 0, duration: 200, useNativeDriver: true }).start(() =>
        hide(),
      );
    }, 2500);
    return () => clearTimeout(timer);
  }, [message, id, opacity, hide]);

  if (!message) return null;
  const light = t.scheme === 'light';
  return (
    <Animated.View
      accessibilityLiveRegion="polite"
      accessibilityRole="alert"
      pointerEvents="none"
      style={[
        styles.toast,
        {
          opacity,
          bottom: 72 + insets.bottom,
          backgroundColor: light ? t.colors.ink : t.colors.surface2,
        },
      ]}
    >
      <Text variant="callout" style={{ color: light ? '#E6E8F0' : t.colors.ink }} numberOfLines={1}>
        {message}
      </Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  toast: {
    position: 'absolute',
    left: 16,
    right: 16,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
});
