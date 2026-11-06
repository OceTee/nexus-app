import type { ExpoConfig } from 'expo/config';
import makeConfig from '../app.config';

// Guards the identifiers fixed by the TDD (Section G, Expo configuration).
function config(env: string): ExpoConfig {
  const previous = process.env.APP_ENV;
  process.env.APP_ENV = env;
  try {
    return makeConfig({ config: {} } as never);
  } finally {
    process.env.APP_ENV = previous;
  }
}

describe('app config', () => {
  it('uses the NEXUS identity and scheme', () => {
    const c = config('production');
    expect(c.name).toBe('NEXUS');
    expect(c.scheme).toBe('nexus');
  });

  it('suffixes non-production ids so builds install side by side', () => {
    expect(config('production').android?.package).toBe('com.gladprosper.nexus');
    expect(config('development').android?.package).toBe('com.gladprosper.nexus.development');
    expect(config('preview').ios?.bundleIdentifier).toBe('com.gladprosper.nexus.preview');
    expect(config('development').name).toBe('NEXUS (development)');
  });

  it('enables FTS, embeds the fonts and keeps the CMake pin plugin', () => {
    const plugins = JSON.stringify(config('development').plugins);
    expect(plugins).toContain('"enableFTS":true');
    expect(plugins).toContain('Inter-Regular.ttf');
    expect(plugins).toContain('./plugins/withCmakeVersion');
  });
});
