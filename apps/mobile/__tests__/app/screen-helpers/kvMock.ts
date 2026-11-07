// In-memory stand-in for src/infra/kv (expo-sqlite's kv-store has no Node backend).
export const kvStore = new Map<string, string>();

export const kv = {
  get: (key: string): string | null => kvStore.get(key) ?? null,
  set: (key: string, value: string): void => void kvStore.set(key, value),
  remove: (key: string): void => void kvStore.delete(key),
  getJson<T>(key: string, fallback: T): T {
    const raw = kvStore.get(key);
    return raw ? { ...fallback, ...(JSON.parse(raw) as T) } : fallback;
  },
  setJson: (key: string, value: unknown): void => void kvStore.set(key, JSON.stringify(value)),
};
