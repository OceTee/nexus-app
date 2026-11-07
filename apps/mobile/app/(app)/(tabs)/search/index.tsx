import { LIMITS } from '@nexus/shared';
import { router, useLocalSearchParams } from 'expo-router';
import { Clock, Search as SearchIcon, X } from 'lucide-react-native';
import { useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { repos, type SearchFilters, type SearchHit } from '@/data/repos';
import { useLocalQuery } from '@/data/useLocalQuery';
import { relativeDate } from '@/features/notes/format';
import { collectionPath } from '@/features/notes/useNoteDecor';
import { kv } from '@/infra/kv';
import { ActionSheet, Chip, EmptyState, Screen, Text, useTheme, type SheetAction } from '@/ui';

const DEBOUNCE_MS = 150;
const RECENT_KEY = 'nexus.search.recent';
const RECENT_MAX = 8;
const DAY = 86_400_000;

type Picker = 'tag' | 'collection' | 'date' | null;

const DATES = [
  { label: 'Any time', days: 0 },
  { label: 'Past week', days: 7 },
  { label: 'Past month', days: 30 },
  { label: 'Past year', days: 365 },
];

/** Highlights «matched» terms from FTS snippet(). */
function Snippet({ text }: { text: string }) {
  const t = useTheme();
  const parts = text.split(/(«[^»]*»)/g);
  return (
    <Text variant="callout" tone="inkSoft" numberOfLines={2}>
      {parts.map((p, i) =>
        p.startsWith('«') ? (
          <Text
            key={i}
            variant="callout"
            style={{ color: t.colors.ink, backgroundColor: t.colors.selection }}
          >
            {p.slice(1, -1)}
          </Text>
        ) : (
          p
        ),
      )}
    </Text>
  );
}

/** S-25 Search: full-text search over every note, offline. */
export default function Search() {
  const t = useTheme();
  const params = useLocalSearchParams<{ q?: string }>();
  // nexus://search?q= pre-fills the query.
  const [query, setQuery] = useState(() => params.q ?? '');
  const [debounced, setDebounced] = useState('');
  const [filters, setFilters] = useState<SearchFilters>({});
  const [dateLabel, setDateLabel] = useState('Any time');
  const [picker, setPicker] = useState<Picker>(null);
  const [recent, setRecent] = useState<string[]>(
    () => kv.getJson<{ items: string[] }>(RECENT_KEY, { items: [] }).items,
  );
  const [hits, setHits] = useState<SearchHit[] | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query.trim()), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    let alive = true;
    if (!debounced) {
      void Promise.resolve().then(() => alive && setHits(null));
    } else {
      void repos.links.search(debounced, filters).then((r) => alive && setHits(r));
    }
    return () => {
      alive = false;
    };
  }, [debounced, filters]);

  const { data: meta } = useLocalQuery(['tags', 'collections'], async () => ({
    tags: await repos.tags.list(),
    collections: await repos.collections.list(),
  }));
  const collectionMap = useMemo(
    () => new Map((meta?.collections ?? []).map((c) => [c.id, c])),
    [meta?.collections],
  );

  const remember = (q: string) => {
    const items = [q, ...recent.filter((r) => r !== q)].slice(0, RECENT_MAX);
    setRecent(items);
    kv.setJson(RECENT_KEY, { items });
  };

  const open = (hit: SearchHit) => {
    remember(debounced);
    router.push({ pathname: '/note/[noteId]', params: { noteId: hit.noteId } });
  };

  const tagName = meta?.tags.find((x) => x.id === filters.tagId)?.name;
  const collectionName = filters.collectionId
    ? collectionMap.get(filters.collectionId)?.name
    : undefined;
  const hasFilters = Boolean(
    filters.tagId || filters.collectionId || filters.since || filters.hasAttachment,
  );

  const pickerActions: SheetAction[] =
    picker === 'tag'
      ? [
          { label: 'Any tag', onPress: () => setFilters(({ tagId: _x, ...f }) => f) },
          ...(meta?.tags ?? []).map((tag) => ({
            label: tag.name,
            onPress: () => setFilters((f) => ({ ...f, tagId: tag.id })),
          })),
        ]
      : picker === 'collection'
        ? [
            {
              label: 'Any collection',
              onPress: () => setFilters(({ collectionId: _x, ...f }) => f),
            },
            ...(meta?.collections ?? []).map((c) => ({
              label: collectionPath(collectionMap, c.id)
                .map((p) => p.name)
                .join(' › '),
              onPress: () => setFilters((f) => ({ ...f, collectionId: c.id })),
            })),
          ]
        : picker === 'date'
          ? DATES.map((d) => ({
              label: d.label,
              onPress: () => {
                setDateLabel(d.label);
                setFilters(({ since: _x, ...f }) =>
                  d.days ? { ...f, since: new Date(Date.now() - d.days * DAY).toISOString() } : f,
                );
              },
            }))
          : [];

  return (
    <Screen>
      <View style={styles.top}>
        <View style={[styles.field, { backgroundColor: t.colors.surface2 }]}>
          <SearchIcon size={18} color={t.colors.inkSoft} />
          <TextInput
            accessibilityLabel="Search notes"
            testID="search-input"
            value={query}
            onChangeText={setQuery}
            autoFocus
            placeholder="Search notes"
            placeholderTextColor={t.colors.inkFaint}
            maxLength={LIMITS.searchQueryMax}
            returnKeyType="search"
            onSubmitEditing={() => debounced && remember(debounced)}
            style={[t.type('body'), styles.input, { color: t.colors.ink }]}
          />
          {query ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Clear search"
              onPress={() => setQuery('')}
              hitSlop={8}
            >
              <X size={18} color={t.colors.inkSoft} />
            </Pressable>
          ) : null}
        </View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chips}
        >
          <Chip
            label={tagName ?? 'Tag'}
            accessibilityLabel={tagName ? `Tag: ${tagName}` : 'Tag'}
            selected={Boolean(tagName)}
            onPress={() => setPicker('tag')}
          />
          <Chip
            label={collectionName ?? 'Collection'}
            accessibilityLabel={collectionName ? `Collection: ${collectionName}` : 'Collection'}
            selected={Boolean(collectionName)}
            onPress={() => setPicker('collection')}
          />
          <Chip
            label={filters.since ? dateLabel : 'Date'}
            accessibilityLabel={filters.since ? `Date: ${dateLabel}` : 'Date'}
            selected={Boolean(filters.since)}
            onPress={() => setPicker('date')}
          />
          <Chip
            label="Has attachment"
            accessibilityLabel={'Has attachment'}
            selected={Boolean(filters.hasAttachment)}
            onPress={() =>
              setFilters(({ hasAttachment, ...f }) =>
                hasAttachment ? f : { ...f, hasAttachment: true },
              )
            }
          />
        </ScrollView>
      </View>

      {!debounced ? (
        recent.length > 0 ? (
          <View>
            <Text variant="caption" tone="inkSoft" style={styles.section}>
              RECENT SEARCHES
            </Text>
            {recent.map((r) => (
              <Pressable
                key={r}
                accessibilityRole="button"
                onPress={() => setQuery(r)}
                style={({ pressed }) => [
                  styles.recent,
                  pressed && { backgroundColor: t.colors.surface2 },
                ]}
              >
                <Clock size={16} color={t.colors.inkFaint} />
                <Text variant="body">{r}</Text>
              </Pressable>
            ))}
          </View>
        ) : (
          <EmptyState
            icon={SearchIcon}
            title="Search everything"
            body="Titles and text of every note, even offline."
          />
        )
      ) : hits && hits.length === 0 ? (
        <EmptyState
          icon={SearchIcon}
          title={`No results for “${debounced}”`}
          {...(hasFilters ? { body: 'Try removing a filter.' } : {})}
        />
      ) : (
        <FlatList
          data={hits ?? []}
          keyExtractor={(h) => h.noteId}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <Pressable
              accessibilityRole="button"
              onPress={() => open(item)}
              style={({ pressed }) => [
                styles.hit,
                pressed && { backgroundColor: t.colors.surface2 },
              ]}
            >
              <Text variant="headline" numberOfLines={1}>
                {item.title || 'Untitled'}
              </Text>
              <Snippet text={item.snippet} />
              <Text variant="footnote" tone="inkFaint">
                {[
                  item.updatedAt ? relativeDate(item.updatedAt) : null,
                  collectionPath(collectionMap, item.collectionId ?? null)
                    .map((c) => c.name)
                    .join(' › ') || null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </Text>
            </Pressable>
          )}
        />
      )}

      <ActionSheet
        visible={picker !== null}
        onClose={() => setPicker(null)}
        title={picker === 'tag' ? 'Tag' : picker === 'collection' ? 'Collection' : 'Edited'}
        actions={pickerActions}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  top: { paddingHorizontal: 16, paddingTop: 12, gap: 10 },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 12,
    paddingHorizontal: 12,
    height: 44,
  },
  input: { flex: 1, paddingVertical: 0 },
  chips: { gap: 8, paddingBottom: 8 },
  section: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 6 },
  recent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    minHeight: 48,
  },
  list: { paddingBottom: 48 },
  hit: { paddingHorizontal: 16, paddingVertical: 12, gap: 4 },
});
