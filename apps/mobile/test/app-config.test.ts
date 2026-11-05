import appJson from '../app.json';

// Guards the identifiers fixed by the TDD (Section G, Expo configuration).
describe('app config', () => {
  const { expo } = appJson;

  it('uses the NEXUS identity', () => {
    expect(expo.name).toBe('NEXUS');
    expect(expo.scheme).toBe('nexus');
  });

  it('uses the approved bundle and package identifiers', () => {
    expect(expo.android.package).toBe('com.gladprosper.nexus');
    expect(expo.ios.bundleIdentifier).toBe('com.gladprosper.nexus');
  });

  it('keeps the CMake pin plugin that fixes Windows long-path builds', () => {
    expect(expo.plugins).toContain('./plugins/withCmakeVersion');
  });
});
