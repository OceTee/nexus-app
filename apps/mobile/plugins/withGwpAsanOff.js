// Opts the app out of Android's GWP-ASan heap sampling
// (android:gwpAsanMode="never").
//
// On Android 14, GWP-ASan occasionally samples one of Hermes' allocations and
// then crashes itself while recording the backtrace (SIGSEGV in libc's
// android_unsafe_frame_pointer_chase, from gwp_asan::...::RecordBacktrace).
// The E2E suite hit this at random, on different flows each run. GWP-ASan is
// a diagnostic, not a feature, so opting out costs users nothing and removes
// the random crash.
const { withAndroidManifest } = require('expo/config-plugins');

module.exports = function withGwpAsanOff(config) {
  return withAndroidManifest(config, (cfg) => {
    const app = cfg.modResults.manifest.application?.[0];
    if (app) app.$['android:gwpAsanMode'] = 'never';
    return cfg;
  });
};
