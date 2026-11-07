import { Tabs } from 'expo-router';
import { FileText, Folder, Search, Settings, Share2, type LucideIcon } from 'lucide-react-native';
import type { ColorValue } from 'react-native';
import { Text, useTheme } from '../../../src/ui';

const icon = (Icon: LucideIcon) =>
  function TabIcon({ color, size }: { color: ColorValue; size: number }) {
    return <Icon color={color as string} size={size} />;
  };

/** Tab labels grow with the font scale up to 1.3× and then truncate (TDD Section C). */
function TabLabel({ color, children }: { color: ColorValue; children: string }) {
  return (
    <Text variant="caption" maxFontSizeMultiplier={1.3} numberOfLines={1} style={{ color }}>
      {children}
    </Text>
  );
}

export const unstable_settings = { anchor: 'notes/index' };

/** Bottom tabs (TDD Section B, Navigation architecture). */
export default function TabsLayout() {
  const t = useTheme();
  return (
    <Tabs
      backBehavior="initialRoute"
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: t.colors.primary,
        tabBarInactiveTintColor: t.colors.inkSoft,
        tabBarLabel: TabLabel,
        tabBarStyle: { backgroundColor: t.colors.surface, borderTopColor: t.colors.line },
        sceneStyle: { backgroundColor: t.colors.surface },
      }}
    >
      <Tabs.Screen name="notes/index" options={{ title: 'Notes', tabBarIcon: icon(FileText) }} />
      <Tabs.Screen
        name="collections/index"
        options={{ title: 'Collections', tabBarIcon: icon(Folder) }}
      />
      <Tabs.Screen name="graph/index" options={{ title: 'Graph', tabBarIcon: icon(Share2) }} />
      <Tabs.Screen name="search/index" options={{ title: 'Search', tabBarIcon: icon(Search) }} />
      <Tabs.Screen
        name="settings/index"
        options={{ title: 'Settings', tabBarIcon: icon(Settings) }}
      />
    </Tabs>
  );
}
