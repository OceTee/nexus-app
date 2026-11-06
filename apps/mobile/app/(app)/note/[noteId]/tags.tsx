import { LIMITS } from '@nexus/shared';
import { useLocalSearchParams } from 'expo-router';
import { Check, Plus } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { DuplicateTagError, repos } from '@/data/repos';
import { useLocalQuery } from '@/data/useLocalQuery';
import { TAG_COLOURS } from '@/features/notes/format';
import { validateTagName } from '@/features/tags/validate';
import { Header, Screen, Text, TextField, toast, useTheme } from '@/ui';

/** Tag picker for one note (S-09 overflow → Tags): toggle tags or create one. */
export default function NoteTags() {
  const t = useTheme();
  const { noteId } = useLocalSearchParams<{ noteId: string }>();
  const [query, setQuery] = useState('');
  const { data } = useLocalQuery(
    ['tags', 'note_tags'],
    async () => {
      const [all, mine] = await Promise.all([repos.tags.list(), repos.tags.forNote(noteId)]);
      return { all, mine: new Set(mine.map((m) => m.id)) };
    },
    [noteId],
  );

  const q = query.trim().toLowerCase();
  const shown = (data?.all ?? []).filter((tag) => !q || tag.name.toLowerCase().includes(q));
  const exact = data?.all.some((tag) => tag.name.toLowerCase() === q);
  const nameError = q ? validateTagName(query) : null;

  const toggle = async (tagId: string, on: boolean) => {
    if (on && (data?.mine.size ?? 0) >= LIMITS.tagsPerNoteMax) {
      toast.show(`A note can have up to ${LIMITS.tagsPerNoteMax} tags`);
      return;
    }
    await repos.tags.setMembership(noteId, tagId, on);
  };

  const create = async () => {
    if (nameError) return;
    try {
      const colour = TAG_COLOURS[(data?.all.length ?? 0) % TAG_COLOURS.length] ?? null;
      const id = await repos.tags.save({ name: query.trim(), colour });
      await toggle(id, true);
      setQuery('');
    } catch (e) {
      toast.show(e instanceof DuplicateTagError ? e.message : 'Could not create the tag');
    }
  };

  return (
    <Screen>
      <Header title="Tags" />
      <View style={styles.search}>
        <TextField
          label="Find or create a tag"
          testID="tag-query"
          value={query}
          onChangeText={setQuery}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="done"
          onSubmitEditing={() => !exact && void create()}
          error={nameError ?? undefined}
        />
      </View>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.list}>
        {q && !exact && !nameError ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => void create()}
            style={({ pressed }) => [styles.row, pressed && { backgroundColor: t.colors.surface2 }]}
          >
            <Plus size={20} color={t.colors.primary} />
            <Text variant="body" style={{ color: t.colors.primary }}>
              Create “{query.trim()}”
            </Text>
          </Pressable>
        ) : null}
        {shown.map((tag) => {
          const on = data?.mine.has(tag.id) ?? false;
          return (
            <Pressable
              key={tag.id}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: on }}
              accessibilityLabel={tag.name}
              onPress={() => void toggle(tag.id, !on)}
              style={({ pressed }) => [
                styles.row,
                pressed && { backgroundColor: t.colors.surface2 },
              ]}
            >
              <View style={[styles.dot, { backgroundColor: tag.colour ?? t.colors.primary }]} />
              <Text variant="body" style={styles.flex}>
                {tag.name}
              </Text>
              {on ? <Check size={20} color={t.colors.primary} /> : null}
            </Pressable>
          );
        })}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  search: { paddingHorizontal: 16, paddingTop: 12 },
  list: { paddingBottom: 48 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 52,
    paddingHorizontal: 16,
  },
  dot: { width: 12, height: 12, borderRadius: 6 },
  flex: { flex: 1 },
});
