import type { ConfigContext, ExpoConfig } from 'expo/config';

// TDD Section G, Expo configuration. APP_ENV gives each build its own id so
// development, preview and production can be installed side by side.
const fonts = [
  'Inter-Regular',
  'Inter-Medium',
  'Inter-SemiBold',
  'InterDisplay-SemiBold',
  'SourceSerif4-Regular',
  'SourceSerif4-Italic',
  'SourceSerif4-SemiBold',
  'JetBrainsMono-Regular',
  'JetBrainsMono-Medium',
].map((name) => `./assets/fonts/${name}.ttf`);

export default ({ config }: ConfigContext): ExpoConfig => {
  const profile = process.env.APP_ENV ?? 'development';
  const suffix = profile === 'production' ? '' : `.${profile}`;
  return {
    ...config,
    name: profile === 'production' ? 'NEXUS' : `NEXUS (${profile})`,
    slug: 'nexus',
    version: '1.0.0',
    runtimeVersion: { policy: 'appVersion' },
    scheme: 'nexus',
    orientation: 'default',
    userInterfaceStyle: 'automatic',
    icon: './assets/images/icon.png',
    ios: {
      bundleIdentifier: `com.gladprosper.nexus${suffix}`,
      supportsTablet: true,
      associatedDomains: ['applinks:app.nexus.example'],
      infoPlist: {
        NSFaceIDUsageDescription: 'Unlock NEXUS with Face ID.',
        ITSAppUsesNonExemptEncryption: false,
      },
    },
    android: {
      package: `com.gladprosper.nexus${suffix}`,
      adaptiveIcon: {
        foregroundImage: './assets/images/android-icon-foreground.png',
        backgroundImage: './assets/images/android-icon-background.png',
        monochromeImage: './assets/images/android-icon-monochrome.png',
        backgroundColor: '#1C2340',
      },
      permissions: ['USE_BIOMETRIC', 'USE_FINGERPRINT'],
      predictiveBackGestureEnabled: false,
      intentFilters: [
        {
          action: 'VIEW',
          autoVerify: true,
          data: [{ scheme: 'https', host: 'app.nexus.example', pathPrefix: '/' }],
          category: ['BROWSABLE', 'DEFAULT'],
        },
      ],
    },
    web: { favicon: './assets/images/favicon.png' },
    plugins: [
      'expo-router',
      [
        'expo-splash-screen',
        {
          backgroundColor: '#3B5BDB',
          image: './assets/images/splash-icon.png',
          imageWidth: 160,
          dark: { backgroundColor: '#3B5BDB', image: './assets/images/splash-icon.png' },
        },
      ],
      ['expo-sqlite', { enableFTS: true }],
      'expo-secure-store',
      ['expo-local-authentication', { faceIDPermission: 'Unlock NEXUS with Face ID.' }],
      [
        'expo-image-picker',
        {
          photosPermission: 'NEXUS attaches the photos you choose to your notes.',
          cameraPermission: 'NEXUS uses the camera to attach photos to your notes.',
          microphonePermission: false,
        },
      ],
      // Fonts are embedded at build time, so nothing loads at launch (cold start budget).
      ['expo-font', { fonts }],
      './plugins/withCmakeVersion',
    ],
    experiments: { typedRoutes: true, reactCompiler: true },
    extra: { apiUrl: process.env.EXPO_PUBLIC_API_URL },
  };
};
