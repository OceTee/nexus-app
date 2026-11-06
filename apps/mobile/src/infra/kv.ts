// Preferences that are not secret (theme, lock timeout, cached profile bits),
// stored in expo-sqlite's kv-store. Failures fall back to defaults: a broken
// preference must never stop the app from starting.

import Storage from 'expo-sqlite/kv-store';

export const kv = {
  get(key: string): string | null {
    try {
      return Storage.getItemSync(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string): void {
    try {
      Storage.setItemSync(key, value);
    } catch {
      // ignore: preferences are best effort
    }
  },
  remove(key: string): void {
    try {
      Storage.removeItemSync(key);
    } catch {
      // ignore
    }
  },
  getJson<T>(key: string, fallback: T): T {
    const raw = kv.get(key);
    if (!raw) return fallback;
    try {
      return { ...fallback, ...(JSON.parse(raw) as T) };
    } catch {
      return fallback;
    }
  },
  setJson(key: string, value: unknown): void {
    kv.set(key, JSON.stringify(value));
  },
};
