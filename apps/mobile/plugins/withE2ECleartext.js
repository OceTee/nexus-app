// Allows plain-HTTP traffic in release builds made for the E2E suite only
// (EXPO_PUBLIC_E2E=1). CI tests a release APK, as Expo and Maestro recommend,
// against the API and MinIO on http://localhost through `adb reverse`; Android
// blocks cleartext in release builds by default. Every other build is untouched.
const { withAndroidManifest } = require('expo/config-plugins');

module.exports = function withE2ECleartext(config) {
  if (process.env.EXPO_PUBLIC_E2E !== '1') return config;
  return withAndroidManifest(config, (cfg) => {
    const app = cfg.modResults.manifest.application?.[0];
    if (app) app.$['android:usesCleartextTraffic'] = 'true';
    return cfg;
  });
};
