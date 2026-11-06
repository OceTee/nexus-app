import { create } from 'zustand';

export interface GraphFilters {
  tagIds: string[];
  collectionId: string | null;
  showOrphans: boolean;
  /** Dashed edges between notes that share a tag. */
  tagEdges: boolean;
}

export const DEFAULT_FILTERS: GraphFilters = {
  tagIds: [],
  collectionId: null,
  showOrphans: true,
  tagEdges: false,
};

interface GraphStore {
  filters: GraphFilters;
  /** Saved view so zoom and pan survive tab switches (S-23). */
  view: { scale: number; x: number; y: number } | null;
  /** Long-pressed nodes keep their position across re-layouts. */
  pinned: Record<string, { x: number; y: number }>;
  listView: boolean;
  legend: boolean;
  setFilters(patch: Partial<GraphFilters>): void;
  resetFilters(): void;
  saveView(view: GraphStore['view']): void;
  togglePin(id: string, at: { x: number; y: number }): void;
  setListView(on: boolean): void;
  setLegend(on: boolean): void;
}

export const useGraphStore = create<GraphStore>()((set) => ({
  filters: DEFAULT_FILTERS,
  view: null,
  pinned: {},
  listView: false,
  legend: false,
  setFilters: (patch) => set((s) => ({ filters: { ...s.filters, ...patch } })),
  resetFilters: () => set({ filters: DEFAULT_FILTERS }),
  saveView: (view) => set({ view }),
  togglePin: (id, at) =>
    set((s) => {
      const pinned = { ...s.pinned };
      if (pinned[id]) delete pinned[id];
      else pinned[id] = at;
      return { pinned };
    }),
  setListView: (listView) => set({ listView }),
  setLegend: (legend) => set({ legend }),
}));

/** Number of active filters, for the filter button badge. */
export function activeFilterCount(f: GraphFilters): number {
  return (
    (f.tagIds.length > 0 ? 1 : 0) +
    (f.collectionId ? 1 : 0) +
    (f.showOrphans ? 0 : 1) +
    (f.tagEdges ? 1 : 0)
  );
}
