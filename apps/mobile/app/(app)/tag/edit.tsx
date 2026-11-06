import { LIMITS } from '@nexus/shared';
import { router, useLocalSearchParams } from 'expo-router';
import { Check } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { DuplicateTagError, repos, type Tag } from '@/data/repos';
import { TAG_COLOURS } from '@/features/notes/format';
import { validateTagName } from '@/features/tags/validate';
import { Button, ConfirmSheet, Header, Screen, Text, TextField, toast, useTheme } from '@/ui';

/**
 * S-22 Tag editor (modal): create, rename and recolour; `mode=merge` picks
 * another tag to merge this one into.
 */
export default function TagEditor() {
  const t = useTheme();
  const { id, mode } = useLocalSearchParams<{ id?: string; mode?: 'merge' | 'colour' }>();
  const [name, setName] = useState('');
  const [colour, setColour] = useState<string>(TAG_COLOURS[0]);
  const [error, setError] = useState<string | null>(null);
  const [others, setOthers] = useState<Tag[]>([]);
  const [mergeInto, setMergeInto] = useState<Tag | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void repos.tags.list().then((all) => {
      const self = id ? all.find((x) => x.id === id) : undefined;
      if (self) {
        setName(self.name);
        setColour(self.colour ?? TAG_COLOURS[0]);
      } else {
        setColour(TAG_COLOURS[all.length % TAG_COLOURS.length] ?? TAG_COLOURS[0]);
      }
      setOthers(all.filter((x) => x.id !== id));
    });
  }, [id]);

  const save = async () => {
    const problem = validateTagName(name);
    if (problem) return setError(problem);
    setBusy(true);
    try {
      await repos.tags.save({ ...(id ? { id } : {}), name: name.trim(), colour });
      toast.show(id ? 'Tag saved' : `Created “${name.trim()}”`);
      router.back();
    } catch (e) {
      setError(e instanceof DuplicateTagError ? e.message : 'Could not save the tag');
      setBusy(false);
    }
  };

  const merge = async (target: Tag) => {
    if (!id) return;
    await repos.tags.merge(id, target.id);
    toast.show(`Merged into “${target.name}”`);
    router.dismissTo({ pathname: '/tag/[tagId]', params: { tagId: target.id } });
  };

  if (mode === 'merge') {
    return (
      <Screen>
        <Header title={`Merge “${name}” into…`} backLabel="Cancel" />
        <ScrollView contentContainerStyle={styles.list}>
          {others.map((tag) => (
            <Pressable
              key={tag.id}
              accessibilityRole="button"
              onPress={() => setMergeInto(tag)}
              style={({ pressed }) => [
                styles.row,
                pressed && { backgroundColor: t.colors.surface2 },
              ]}
            >
              <View style={[styles.dot, { backgroundColor: tag.colour ?? t.colors.primary }]} />
              <Text variant="body" style={styles.flex}>
                {tag.name}
              </Text>
              <Text variant="footnote" tone="inkFaint">
                {tag.noteCount}
              </Text>
            </Pressable>
          ))}
          {others.length === 0 ? (
            <Text variant="callout" tone="inkSoft" style={styles.pad}>
              There are no other tags to merge into.
            </Text>
          ) : null}
        </ScrollView>
        <ConfirmSheet
          visible={mergeInto !== null}
          onClose={() => setMergeInto(null)}
          title={`Merge into “${mergeInto?.name ?? ''}”?`}
          body={`Notes tagged “${name}” get “${mergeInto?.name ?? ''}” instead, and “${name}” is deleted.`}
          confirmLabel="Merge tags"
          onConfirm={() => mergeInto && void merge(mergeInto)}
        />
      </Screen>
    );
  }

  return (
    <Screen>
      <Header
        title={id ? (mode === 'colour' ? 'Recolour tag' : 'Edit tag') : 'New tag'}
        backLabel="Cancel"
      />
      <ScrollView contentContainerStyle={styles.pad} keyboardShouldPersistTaps="handled">
        <TextField
          label="Name"
          value={name}
          onChangeText={(v) => {
            setName(v);
            setError(null);
          }}
          autoFocus={mode !== 'colour'}
          autoCapitalize="none"
          autoCorrect={false}
          maxLength={LIMITS.tagNameMax}
          error={error ?? undefined}
          hint="One word, up to 40 characters"
        />
        <Text variant="footnote" tone="inkSoft" style={styles.label}>
          Colour
        </Text>
        <View style={styles.swatches} accessibilityRole="radiogroup">
          {TAG_COLOURS.map((c) => (
            <Pressable
              key={c}
              accessibilityRole="radio"
              accessibilityState={{ checked: c === colour }}
              accessibilityLabel={`Colour ${TAG_COLOURS.indexOf(c) + 1}`}
              onPress={() => setColour(c)}
              style={[styles.swatch, { backgroundColor: c }]}
            >
              {c === colour ? <Check size={20} color="#FFFFFF" /> : null}
            </Pressable>
          ))}
        </View>
        <Button label={id ? 'Save' : 'Create'} onPress={() => void save()} loading={busy} />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  pad: { padding: 16 },
  list: { paddingBottom: 48 },
  label: { marginBottom: 8 },
  swatches: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginBottom: 24 },
  swatch: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
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
