// Pins the Android SDK CMake used for native builds.
// The default CMake 3.22.1 bundles Ninja 1.10, which cannot handle paths over
// 260 characters on Windows (React Native codegen object paths exceed that).
// CMake 4.1.2 bundles Ninja 1.12.1, which supports long paths. CMake 4 dropped
// compatibility with projects declaring cmake_minimum_required below 3.5 (for
// example expo-sqlite), so every module also gets CMAKE_POLICY_VERSION_MINIMUM.
const { withProjectBuildGradle } = require('expo/config-plugins');

const MARKER = '// @generated nexus-cmake-version';
const ANCHOR = 'apply plugin: "expo-root-project"';

module.exports = function withCmakeVersion(config, { version = '4.1.2' } = {}) {
  return withProjectBuildGradle(config, (cfg) => {
    const src = cfg.modResults.contents;
    if (src.includes(MARKER)) return cfg;
    // Must run before the React Native root plugin, which evaluates :app early.
    const block = `${MARKER}
subprojects {
  ['com.android.application', 'com.android.library'].each { id ->
    pluginManager.withPlugin(id) {
      android.externalNativeBuild.cmake.version = '${version}'
      android.defaultConfig.externalNativeBuild.cmake.arguments '-DCMAKE_POLICY_VERSION_MINIMUM=3.5'
    }
  }
}

`;
    if (!src.includes(ANCHOR)) {
      throw new Error(`withCmakeVersion: anchor not found in android/build.gradle: ${ANCHOR}`);
    }
    cfg.modResults.contents = src.replace(ANCHOR, block + ANCHOR);
    return cfg;
  });
};
