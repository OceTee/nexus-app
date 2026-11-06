import { router, useLocalSearchParams } from 'expo-router';
import { Link2 } from 'lucide-react-native';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { repos, type Backlink } from '@/data/repos';
import { useLocalQuery } from '@/data/useLocalQuery';
import { EmptyState, Header, Screen, Text, toast, useTheme } from '@/ui';

/** S-14 Backlinks: notes linking here with context, then unlinked mentions. */
export default function Backlinks() {
  const t = useTheme();
  const { noteId } = useLocalSearchParams<{ noteId: string }>();
  const { data } = useLocalQuery(
    ['notes', 'note_links'],
    async () => {
      const note = await repos.notes.get(noteId);
      const [linked, mentions] = await Promise.all([
        repos.links.backlinks(noteId),
        note?.title ? repos.links.unlinkedMentions(noteId, note.title) : Promise.resolve([]),
      ]);
      return { title: note?.title ?? '', linked, mentions };
    },
    [noteId],
  );

  const open = (b: Backlink) =>
    router.push({ pathname: '/note/[noteId]', params: { noteId: b.noteId } });

  const linkIt = async (b: Backlink) => {
    if (data && (await repos.notes.linkMention(b.noteId, data.title))) {
      toast.show(`Linked from “${b.title || 'Untitled'}”`);
    }
  };

  /** The context sentence with the title highlighted. */
  const context = (b: Backlink) => {
    const needle = data?.title.toLowerCase() ?? '';
    const at = needle ? b.context.toLowerCase().indexOf(needle) : -1;
    if (at < 0)
      return (
        <Text variant="callout" tone="inkSoft">
          {b.context}
        </Text>
      );
    return (
      <Text variant="callout" tone="inkSoft" numberOfLines={3}>
        {b.context.slice(0, at)}
        <Text variant="callout" style={{ color: t.colors.primary }}>
          {b.context.slice(at, at + needle.length)}
        </Text>
        {b.context.slice(at + needle.length)}
      </Text>
    );
  };

  return (
    <Screen>
      <Header title="Backlinks" />
      {data && data.linked.length === 0 && data.mentions.length === 0 ? (
        <EmptyState
          icon={Link2}
          title="No backlinks"
          body="No notes link here yet. Type [[ in another note to create a link."
        />
      ) : (
        <ScrollView contentContainerStyle={styles.pad}>
          {data?.linked.map((b) => (
            <Pressable
              key={b.noteId}
              accessibilityRole="button"
              onPress={() => open(b)}
              style={({ pressed }) => [
                styles.row,
                pressed && { backgroundColor: t.colors.surface2 },
              ]}
            >
              <Text variant="headline" numberOfLines={1}>
                {b.title || 'Untitled'}
              </Text>
              {context(b)}
            </Pressable>
          ))}
          {data && data.mentions.length > 0 ? (
            <>
              <Text variant="caption" tone="inkFaint" style={styles.section}>
                UNLINKED MENTIONS
              </Text>
              {data.mentions.map((b) => (
                <View key={b.noteId} style={styles.mention}>
                  <Pressable accessibilityRole="button" onPress={() => open(b)} style={styles.flex}>
                    <Text variant="headline" numberOfLines={1}>
                      {b.title || 'Untitled'}
                    </Text>
                    {context(b)}
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Link the mention in ${b.title || 'Untitled'}`}
                    onPress={() => void linkIt(b)}
                    hitSlop={8}
                    style={styles.linkBtn}
                  >
                    <Text variant="headline" style={{ color: t.colors.primary }}>
                      Link
                    </Text>
                  </Pressable>
                </View>
              ))}
            </>
          ) : null}
        </ScrollView>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  pad: { paddingVertical: 8, paddingBottom: 48 },
  row: { paddingHorizontal: 16, paddingVertical: 12, gap: 4 },
  section: { paddingHorizontal: 16, paddingTop: 24, paddingBottom: 8 },
  mention: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
  },
  flex: { flex: 1, gap: 4 },
  linkBtn: { paddingHorizontal: 8, paddingVertical: 6 },
});
