// Signs Android release builds with an upload key when one is supplied as
// Gradle properties (CI passes them from GitHub secrets; see
// .github/workflows/release.yml):
//   -PNEXUS_UPLOAD_STORE_FILE=… -PNEXUS_UPLOAD_STORE_PASSWORD=…
//   -PNEXUS_UPLOAD_KEY_ALIAS=…  -PNEXUS_UPLOAD_KEY_PASSWORD=…
// Without them, release builds keep Expo's default debug signing, so local
// and E2E builds work unchanged.
const { withAppBuildGradle } = require('expo/config-plugins');

const MARKER = '// @generated nexus-release-signing';

const SIGNING = `${MARKER}
        release {
            if (project.hasProperty('NEXUS_UPLOAD_STORE_FILE')) {
                storeFile file(NEXUS_UPLOAD_STORE_FILE)
                storePassword NEXUS_UPLOAD_STORE_PASSWORD
                keyAlias NEXUS_UPLOAD_KEY_ALIAS
                keyPassword NEXUS_UPLOAD_KEY_PASSWORD
            }
        }`;

module.exports = function withReleaseSigning(config) {
  return withAppBuildGradle(config, (cfg) => {
    let src = cfg.modResults.contents;
    if (src.includes(MARKER)) return cfg;

    // 1. A release signing config next to the debug one.
    const debugConfig = /signingConfigs \{\s*\n(\s*)debug \{[^}]*\}/;
    if (!debugConfig.test(src))
      throw new Error('withReleaseSigning: signingConfigs block not found');
    src = src.replace(debugConfig, (m) => `${m}\n        ${SIGNING}`);

    // 2. The release build type uses it when the upload key was supplied.
    const releaseType =
      /(buildTypes \{[\s\S]*?release \{[\s\S]*?)signingConfig signingConfigs\.debug/;
    if (!releaseType.test(src)) throw new Error('withReleaseSigning: release buildType not found');
    src = src.replace(
      releaseType,
      `$1signingConfig project.hasProperty('NEXUS_UPLOAD_STORE_FILE') ? signingConfigs.release : signingConfigs.debug`,
    );

    cfg.modResults.contents = src;
    return cfg;
  });
};
