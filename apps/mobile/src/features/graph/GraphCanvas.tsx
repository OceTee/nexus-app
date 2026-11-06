import {
  Canvas,
  Circle,
  DashPathEffect,
  Group,
  matchFont,
  Path,
  Skia,
  Text as SkiaText,
} from '@shopify/react-native-skia';
import { useEffect, useMemo, useRef } from 'react';
import { Platform, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useDerivedValue, useSharedValue } from 'react-native-reanimated';
import { useTheme } from '@/ui';
import type { GraphEdge, Positioned } from './data';

const font = matchFont({
  fontFamily: Platform.select({ ios: 'Helvetica', default: 'sans-serif' }),
  fontSize: 11,
});

export interface GraphView {
  scale: number;
  x: number;
  y: number;
}

/**
 * GraphCanvas (S-23): Skia drawing of notes and links. Pinch zooms around the
 * fingers, drag pans, tap selects, double-tap opens, long-press pins. The
 * canvas owns its zoom and pan; `focus` centres a node, `initialView` restores
 * a saved view and `onSaveView` reports it when the canvas goes away.
 */
export function GraphCanvas({
  nodes,
  edges,
  selectedId,
  highlight,
  initialView,
  focus,
  onSelect,
  onOpen,
  onPin,
  onSaveView,
}: {
  nodes: Positioned[];
  edges: GraphEdge[];
  selectedId: string | null;
  highlight: ReadonlySet<string>;
  initialView: GraphView | null;
  focus: { id: string; nonce: number } | null;
  onSelect: (id: string | null) => void;
  onOpen: (id: string) => void;
  onPin: (node: Positioned) => void;
  onSaveView: (view: GraphView) => void;
}) {
  const t = useTheme();
  const scale = useSharedValue(initialView?.scale ?? 1);
  const x = useSharedValue(initialView?.x ?? 0);
  const y = useSharedValue(initialView?.y ?? 0);
  const start = useSharedValue({ scale: 1, x: 0, y: 0 });
  const size = useRef({ width: 0, height: 0 });
  const fitted = useRef(initialView !== null);

  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const paths = useMemo(() => {
    const links = Skia.PathBuilder.Make();
    const tags = Skia.PathBuilder.Make();
    for (const e of edges) {
      const a = byId.get(e.source);
      const b = byId.get(e.target);
      if (!a || !b) continue;
      const p = e.kind === 'link' ? links : tags;
      p.moveTo(a.x, a.y);
      p.lineTo(b.x, b.y);
    }
    return { links: links.detach(), tags: tags.detach() };
  }, [edges, byId]);

  // Labels for the most connected notes and the selection keep the canvas readable.
  const labelled = useMemo(() => {
    const top = [...nodes].sort((a, b) => b.degree - a.degree).slice(0, 14);
    const set = new Set(top.filter((n) => n.degree > 0).map((n) => n.id));
    if (selectedId) set.add(selectedId);
    return nodes.filter((n) => set.has(n.id));
  }, [nodes, selectedId]);

  const fit = () => {
    const { width, height } = size.current;
    if (!width || nodes.length === 0) return;
    const xs = nodes.map((n) => n.x);
    const ys = nodes.map((n) => n.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const s = Math.min(
      1.5,
      Math.max(0.15, Math.min(width / (maxX - minX + 80), height / (maxY - minY + 80))),
    );
    scale.set(s);
    x.set(width / 2 - ((minX + maxX) / 2) * s);
    y.set(height / 2 - ((minY + maxY) / 2) * s);
  };

  useEffect(() => {
    if (!fitted.current && nodes.length > 0 && size.current.width) {
      fitted.current = true;
      fit();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fit reads the latest nodes
  }, [nodes]);

  useEffect(() => {
    const n = focus ? byId.get(focus.id) : undefined;
    if (!n) return;
    const { width, height } = size.current;
    const s = Math.max(scale.value, 1);
    scale.set(s);
    x.set(width / 2 - n.x * s);
    y.set(height / 2 - n.y * s);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs per focus request
  }, [focus?.nonce]);

  // Zoom and pan survive tab switches (S-23).
  const saveRef = useRef(onSaveView);
  useEffect(() => {
    saveRef.current = onSaveView;
  });
  useEffect(
    () => () => saveRef.current({ scale: scale.value, x: x.value, y: y.value }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- shared values are stable refs
    [],
  );

  const onLayout = (e: LayoutChangeEvent) => {
    size.current = e.nativeEvent.layout;
    if (!fitted.current && nodes.length > 0) {
      fitted.current = true;
      fit();
    }
  };

  /** The node under a screen point, if any (generous touch radius). */
  const hit = (sx: number, sy: number): Positioned | null => {
    const s = scale.value;
    const gx = (sx - x.value) / s;
    const gy = (sy - y.value) / s;
    let best: Positioned | null = null;
    let bestD = Infinity;
    for (const n of nodes) {
      const d = Math.hypot(n.x - gx, n.y - gy);
      if (d < Math.max(n.r + 8 / s, 22 / s) && d < bestD) {
        best = n;
        bestD = d;
      }
    }
    return best;
  };

  const transform = useDerivedValue(() => [
    { translateX: x.value },
    { translateY: y.value },
    { scale: scale.value },
  ]);

  const pinch = Gesture.Pinch()
    .onStart(() => {
      start.set({ scale: scale.value, x: x.value, y: y.value });
    })
    .onUpdate((e) => {
      const s = Math.min(5, Math.max(0.15, start.value.scale * e.scale));
      const k = s / start.value.scale;
      x.set(e.focalX - (e.focalX - start.value.x) * k);
      y.set(e.focalY - (e.focalY - start.value.y) * k);
      scale.set(s);
    });
  const pan = Gesture.Pan()
    .averageTouches(true)
    .onStart(() => {
      start.set({ scale: scale.value, x: x.value, y: y.value });
    })
    .onUpdate((e) => {
      x.set(start.value.x + e.translationX);
      y.set(start.value.y + e.translationY);
    });
  const tap = Gesture.Tap()
    .runOnJS(true)
    .maxDuration(250)
    .onEnd((e) => onSelect(hit(e.x, e.y)?.id ?? null));
  const doubleTap = Gesture.Tap()
    .runOnJS(true)
    .numberOfTaps(2)
    .onEnd((e) => {
      const n = hit(e.x, e.y);
      if (n) onOpen(n.id);
    });
  const longPress = Gesture.LongPress()
    .runOnJS(true)
    .minDuration(450)
    .onStart((e) => {
      const n = hit(e.x, e.y);
      if (n) onPin(n);
    });
  const gesture = Gesture.Simultaneous(pinch, pan, Gesture.Exclusive(doubleTap, longPress, tap));

  return (
    <GestureDetector gesture={gesture}>
      {/* Skia's Canvas has no onLayout on the new architecture; measure the wrapper. */}
      <View style={styles.fill} onLayout={onLayout}>
        <Canvas style={styles.fill} accessibilityLabel="Graph of notes">
          <Group transform={transform}>
            <Path path={paths.links} style="stroke" strokeWidth={1.2} color={t.colors.line} />
            <Path path={paths.tags} style="stroke" strokeWidth={1} color={t.colors.inkFaint}>
              <DashPathEffect intervals={[4, 4]} />
            </Path>
            {nodes.map((n) => {
              const selected = n.id === selectedId;
              const dim = highlight.size > 0 && !highlight.has(n.id);
              const colour = selected
                ? t.colors.accent
                : n.degree === 0
                  ? t.colors.inkFaint
                  : t.colors.primary;
              return (
                <Circle
                  key={n.id}
                  cx={n.x}
                  cy={n.y}
                  r={selected ? n.r + 3 : n.r}
                  color={colour}
                  opacity={dim ? 0.25 : 1}
                />
              );
            })}
            {labelled.map((n) => (
              <SkiaText
                key={`l-${n.id}`}
                x={n.x + n.r + 3}
                y={n.y + 4}
                text={n.title.length > 28 ? `${n.title.slice(0, 27)}…` : n.title}
                font={font}
                color={t.colors.inkSoft}
              />
            ))}
          </Group>
        </Canvas>
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({ fill: { flex: 1 } });
