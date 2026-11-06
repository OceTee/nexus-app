// UI preferences (TDD Section G, State management): kv-store backed.

import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import { kv } from '../infra/kv';

export interface Settings {
  theme: 'system' | 'light' | 'dark';
  editorFontSize: number;
  lockEnabled: boolean;
  lockTimeoutSec: number;
  telemetry: boolean;
  serifReading: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'system',
  editorFontSize: 16,
  lockEnabled: false,
  lockTimeoutSec: 30,
  telemetry: false,
  serifReading: true,
};

const KEY = 'settings';

interface SettingsStore extends Settings {
  update(patch: Partial<Settings>): void;
}

export const useSettingsStore = create<SettingsStore>()(
  subscribeWithSelector((set, get) => ({
    ...kv.getJson<Settings>(KEY, DEFAULT_SETTINGS),
    update(patch) {
      set(patch);
      const { update: _update, ...settings } = { ...get(), ...patch };
      kv.setJson(KEY, settings);
    },
  })),
);
