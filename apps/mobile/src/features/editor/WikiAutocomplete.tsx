import { normaliseTitle } from '@nexus/shared';
import { FilePlus2, FileText } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { repos } from '@/data/repos';
import { Text, useTheme } from '@/ui';

/** Autocomplete debounce; the TDD budget is 150 ms from keystroke to results. */
const DEBOUNCE_MS = 60;

/**
 * Anchored popover for `[[` (S-09): matching titles as you type, plus
 * "Create" when no title matches exactly (a ghost link until saved).
 */
export function WikiAutocomplete({
  query,
  excludeId,
  onPick,
}: {
  query: string;
  excludeId: string;
  onPick: (title: string) => void;
}) {
  const t = useTheme();
  const [hits, setHits] = useState<{ id: string; title: string }[]>([]);

  useEffect(() => {
    let alive = true;
    const timer = setTimeout(() => {
      void repos.links.autocomplete(query).then((r) => {
        if (alive) setHits(r.filter((h) => h.id !== excludeId));
      });
    }, DEBOUNCE_MS);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [query, excludeId]);

  const typed = query.trim();
  const exact = hits.some((h) => normaliseTitle(h.title) === normaliseTitle(typed));
  const rows = [
    ...hits.map((h) => ({ key: h.id, title: h.title, create: false })),
    ...(typed && !exact ? [{ key: 'create', title: typed, create: true }] : []),
  ];

  if (rows.length === 0) {
    return (
      <View style={[styles.box, { backgroundColor: t.colors.surface, borderColor: t.colors.line }]}>
        <Text variant="footnote" tone="inkFaint" style={styles.hint}>
          Type a note title to link it
        </Text>
      </View>
    );
  }

  return (
    <View
      accessibilityRole="list"
      accessibilityLabel="Link suggestions"
      style={[styles.box, { backgroundColor: t.colors.surface, borderColor: t.colors.line }]}
    >
      <ScrollView keyboardShouldPersistTaps="always">
        {rows.map((r) => {
          const Icon = r.create ? FilePlus2 : FileText;
          return (
            <Pressable
              key={r.key}
              accessibilityRole="button"
              accessibilityLabel={
                r.create ? `Create link to new note ${r.title}` : `Link ${r.title}`
              }
              onPress={() => onPick(r.title)}
              style={({ pressed }) => [
                styles.row,
                pressed && { backgroundColor: t.colors.surfacePressed },
              ]}
            >
              <Icon size={18} color={r.create ? t.colors.primary : t.colors.inkSoft} />
              <Text
                variant="callout"
                numberOfLines={1}
                style={[styles.flex, r.create && { color: t.colors.primary }]}
              >
                {r.create ? `Create “${r.title}”` : r.title}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    maxHeight: 220,
    marginHorizontal: 8,
    marginBottom: 6,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 44,
    paddingHorizontal: 12,
  },
  flex: { flex: 1 },
  hint: { padding: 12 },
});
