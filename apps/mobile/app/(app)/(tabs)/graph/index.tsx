import { router } from 'expo-router';
import { List, Network, Share2, SlidersHorizontal, X } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { useLocalQuery } from '@/data/useLocalQuery';
import { layoutGraph, loadGraph } from '@/features/graph/data';
import { GraphCanvas } from '@/features/graph/GraphCanvas';
import { activeFilterCount, useGraphStore } from '@/features/graph/store';
import {
  alpha,
  Button,
  EmptyState,
  IconButton,
  ListRow,
  Screen,
  Text,
  toast,
  useTheme,
} from '@/ui';

const openNote = (noteId: string) =>
  router.push({ pathname: '/note/[noteId]', params: { noteId } });

/** S-23 Graph: notes as nodes, links as edges; filters on S-24. */
export default function Graph() {
  const t = useTheme();
  const filters = useGraphStore((s) => s.filters);
  const pinned = useGraphStore((s) => s.pinned);
  const listView = useGraphStore((s) => s.listView);
  const legend = useGraphStore((s) => s.legend);
  const store = useGraphStore.getState;
  const [initialView] = useState(() => useGraphStore.getState().view);
  const [focus, setFocus] = useState<{ id: string; nonce: number } | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [find, setFind] = useState('');

  const { data } = useLocalQuery(['notes', 'note_links', 'note_tags'], () => loadGraph(filters), [
    JSON.stringify(filters),
  ]);
  const nodes = useMemo(() => (data ? layoutGraph(data, pinned) : []), [data, pinned]);
  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const highlight = useMemo(() => {
    const q = find.trim().toLowerCase();
    return new Set(
      q ? nodes.filter((n) => n.title.toLowerCase().includes(q)).map((n) => n.id) : [],
    );
  }, [find, nodes]);

  const centreOn = (id: string) => {
    setSelected(id);
    setFocus({ id, nonce: Date.now() });
  };

  const filterCount = activeFilterCount(filters);
  const sel = selected ? byId.get(selected) : undefined;
  const linkCount = data?.edges.filter((e) => e.kind === 'link').length ?? 0;

  const topBar = (
    <View style={styles.bar}>
      <View style={[styles.find, { backgroundColor: alpha(t.colors.surface2, 0.95) }]}>
        <TextInput
          accessibilityLabel="Find a note in the graph"
          value={find}
          onChangeText={setFind}
          placeholder="Find in graph"
          placeholderTextColor={t.colors.inkFaint}
          returnKeyType="search"
          onSubmitEditing={() => {
            const first = nodes.find((n) => highlight.has(n.id));
            if (first) centreOn(first.id);
            else if (find.trim()) toast.show('No note with that title in the graph');
          }}
          style={[t.type('callout'), styles.findInput, { color: t.colors.ink }]}
        />
        {find ? <IconButton icon={X} label="Clear" size={18} onPress={() => setFind('')} /> : null}
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Filters${filterCount ? `, ${filterCount} active` : ''}`}
        onPress={() => router.push('/graph/filters')}
        style={[styles.filterBtn, { backgroundColor: alpha(t.colors.surface2, 0.95) }]}
      >
        <SlidersHorizontal size={20} color={t.colors.ink} />
        {filterCount ? (
          <View style={[styles.badge, { backgroundColor: t.colors.primary }]}>
            <Text variant="caption" style={{ color: t.colors.onPrimary }}>
              {filterCount}
            </Text>
          </View>
        ) : null}
      </Pressable>
      <IconButton
        icon={listView ? Share2 : List}
        label={listView ? 'Show graph' : 'Show as list'}
        onPress={() => store().setListView(!listView)}
      />
    </View>
  );

  if (
    data &&
    (data.nodes.length === 0 || (linkCount === 0 && !filters.tagEdges && filterCount === 0))
  ) {
    return (
      <Screen title="Graph">
        <EmptyState
          icon={Network}
          title="No connections yet"
          body="Link two notes with [[ to see your graph."
          {...(filterCount
            ? { action: { label: 'Clear filters', onPress: () => store().resetFilters() } }
            : {})}
        />
      </Screen>
    );
  }

  return (
    <Screen>
      {data && data.total > data.nodes.length && data.total > 500 ? (
        <Text variant="footnote" tone="inkSoft" style={styles.cap} accessibilityRole="alert">
          Showing 500 of {data.total.toLocaleString()} notes — refine filters
        </Text>
      ) : null}
      {listView ? (
        <>
          {topBar}
          <FlatList
            data={[...nodes].sort((a, b) => b.degree - a.degree)}
            keyExtractor={(n) => n.id}
            renderItem={({ item }) => (
              <ListRow
                title={item.title}
                subtitle={item.degree === 1 ? '1 connection' : `${item.degree} connections`}
                onPress={() => openNote(item.id)}
              />
            )}
          />
        </>
      ) : (
        <View style={styles.fill}>
          <GraphCanvas
            nodes={nodes}
            edges={data?.edges ?? []}
            selectedId={selected}
            highlight={highlight}
            initialView={initialView}
            focus={focus}
            onSelect={setSelected}
            onOpen={openNote}
            onPin={(n) => {
              store().togglePin(n.id, { x: n.x, y: n.y });
              toast.show(pinned[n.id] ? 'Unpinned' : 'Pinned in place');
            }}
            onSaveView={(v) => store().saveView(v)}
          />
          <View style={styles.overlay} pointerEvents="box-none">
            {topBar}
          </View>
          {legend ? (
            <View
              style={[
                styles.legend,
                { backgroundColor: alpha(t.colors.surface, 0.95), borderColor: t.colors.line },
              ]}
            >
              <Text variant="footnote">● Note (bigger = more links)</Text>
              <Text variant="footnote" tone="inkFaint">
                ● Not linked yet
              </Text>
              <Text variant="footnote" style={{ color: t.colors.accent }}>
                ● Selected
              </Text>
              <Text variant="footnote" tone="inkSoft">
                — link · - - shared tag
              </Text>
            </View>
          ) : null}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={legend ? 'Hide legend' : 'Show legend'}
            onPress={() => store().setLegend(!legend)}
            style={[styles.legendBtn, { backgroundColor: alpha(t.colors.surface2, 0.95) }]}
          >
            <Text variant="caption">{legend ? 'Hide legend' : 'Legend'}</Text>
          </Pressable>
          {sel ? (
            <View
              style={[
                styles.card,
                { backgroundColor: t.colors.surface, borderColor: t.colors.line },
              ]}
            >
              <Text variant="headline" numberOfLines={1}>
                {sel.title}
              </Text>
              {sel.excerpt ? (
                <Text variant="callout" tone="inkSoft" numberOfLines={2}>
                  {sel.excerpt}
                </Text>
              ) : null}
              <Text variant="footnote" tone="inkFaint">
                {sel.degree === 1 ? '1 connection' : `${sel.degree} connections`}
                {pinned[sel.id] ? ' · pinned' : ''}
              </Text>
              <View style={styles.cardActions}>
                <Button label="Open note" onPress={() => openNote(sel.id)} block={false} />
                <Button
                  label="Close"
                  variant="text"
                  onPress={() => setSelected(null)}
                  block={false}
                />
              </View>
            </View>
          ) : null}
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  overlay: { position: 'absolute', top: 0, left: 0, right: 0 },
  bar: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12 },
  find: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    paddingLeft: 12,
    height: 44,
  },
  findInput: { flex: 1, paddingVertical: 0 },
  filterBtn: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    position: 'absolute',
    top: 4,
    right: 4,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  cap: { paddingHorizontal: 16, paddingTop: 8 },
  legend: {
    position: 'absolute',
    left: 12,
    bottom: 64,
    padding: 10,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 2,
  },
  legendBtn: {
    position: 'absolute',
    left: 12,
    bottom: 16,
    paddingHorizontal: 12,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
  },
  card: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 12,
    padding: 16,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 4,
  },
  cardActions: { flexDirection: 'row', gap: 8, marginTop: 8 },
});
