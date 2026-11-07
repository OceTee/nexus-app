// Skia cannot render in Jest: a stand-in canvas that exposes the node
// callbacks as labelled buttons, so screen tests can drive the graph.
import { Pressable, Text, View } from 'react-native';
import type { GraphCanvas as Real } from '../../../src/features/graph/GraphCanvas';

type Props = Parameters<typeof Real>[0];

export function GraphCanvas(p: Props) {
  return (
    <View>
      {p.nodes.map((n) => (
        <View key={n.id}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Node ${n.title}`}
            accessibilityState={{ selected: p.selectedId === n.id }}
            onPress={() => p.onSelect(n.id)}
          >
            <Text>{p.highlight.has(n.id) ? `${n.title} (match)` : n.title}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Open node ${n.title}`}
            onPress={() => p.onOpen(n.id)}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Pin node ${n.title}`}
            onPress={() => p.onPin(n)}
          />
        </View>
      ))}
      <Text>{p.focus ? `Focus ${p.focus.id}` : 'No focus'}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Save view"
        onPress={() => p.onSaveView({ scale: 2, x: 1, y: 1 })}
      />
    </View>
  );
}
