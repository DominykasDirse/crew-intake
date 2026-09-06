import type { ConfigContext, ExpoConfig } from 'expo/config';

// eslint-disable-next-line @typescript-eslint/no-require-imports -- plain CJS so CI can run it with node alone
const { assertNoPublicSecrets } = require('./scripts/check-public-env.js') as {
  assertNoPublicSecrets: () => void;
};
// Every expo start / export / eas build evaluates this file: a secret under EXPO_PUBLIC_ stops it here.
assertNoPublicSecrets();

const EAS_PROJECT_ID = '52529350-6421-4916-a602-d4440e49bcec';

// Permanent once published. Do not change.
const ANDROID_PACKAGE = 'io.github.dominykasdirse.crewintake';

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'Crew Intake',
  slug: 'crew-intake',
  version: '0.1.0',
  orientation: 'portrait',
  icon: './assets/icon.png',
  scheme: 'crewintake',
  userInterfaceStyle: 'automatic',
  android: {
    package: ANDROID_PACKAGE,
    adaptiveIcon: {
      backgroundColor: '#111111',
      foregroundImage: './assets/android-icon-foreground.png',
      backgroundImage: './assets/android-icon-background.png',
      monochromeImage: './assets/android-icon-monochrome.png',
    },
    predictiveBackGestureEnabled: false,
    // Android App Links: https://dominykasdirse.github.io/crew-intake/claim?token=… opens the
    // claim screen directly once /.well-known/assetlinks.json on that host lists the app's
    // signing certificate (phase 11). Until then the same URL shows the browser fallback page.
    intentFilters: [
      {
        action: 'VIEW',
        autoVerify: true,
        data: [
          { scheme: 'https', host: 'dominykasdirse.github.io', pathPrefix: '/crew-intake/claim' },
        ],
        category: ['BROWSABLE', 'DEFAULT'],
      },
    ],
  },
  experiments: { typedRoutes: true },
  plugins: [
    'expo-router',
    'expo-secure-store',
    'expo-localization',
    [
      'expo-font',
      {
        fonts: [
          'node_modules/@expo-google-fonts/archivo/400Regular/Archivo_400Regular.ttf',
          'node_modules/@expo-google-fonts/archivo/500Medium/Archivo_500Medium.ttf',
          'node_modules/@expo-google-fonts/archivo/600SemiBold/Archivo_600SemiBold.ttf',
          'node_modules/@expo-google-fonts/archivo/700Bold/Archivo_700Bold.ttf',
          'node_modules/@expo-google-fonts/jetbrains-mono/400Regular/JetBrainsMono_400Regular.ttf',
          'node_modules/@expo-google-fonts/jetbrains-mono/600SemiBold/JetBrainsMono_600SemiBold.ttf',
        ],
      },
    ],
    [
      'expo-splash-screen',
      {
        image: './assets/splash-icon.png',
        imageWidth: 200,
        resizeMode: 'contain',
        backgroundColor: '#111111',
      },
    ],
    ['expo-notifications', { color: '#111111' }],
    [
      'expo-camera',
      {
        cameraPermission:
          'Crew Intake uses the camera to scan your invite QR code and to photograph faults.',
      },
    ],
    [
      'expo-image-picker',
      {
        photosPermission: 'Crew Intake needs your photos so you can attach a picture to a report.',
        cameraPermission: 'Crew Intake uses the camera to photograph faults.',
      },
    ],
    // Sentry is scaffolded but inert until SENTRY_ORG/SENTRY_PROJECT (build) and
    // EXPO_PUBLIC_SENTRY_DSN (runtime) are set. See Q15 in PLAN.md.
    ...(process.env.SENTRY_ORG && process.env.SENTRY_PROJECT
      ? [
          [
            '@sentry/react-native/expo',
            {
              organization: process.env.SENTRY_ORG,
              project: process.env.SENTRY_PROJECT,
              url: 'https://sentry.io/',
            },
          ] as [string, Record<string, string>],
        ]
      : []),
  ],
  // EAS Update: JS fixes reach installed phones on next launch (eas update --channel preview).
  updates: {
    url: `https://u.expo.dev/${EAS_PROJECT_ID}`,
    enabled: true,
    checkAutomatically: 'ON_LOAD',
    fallbackToCacheTimeout: 0,
  },
  runtimeVersion: { policy: 'appVersion' },
  extra: {
    eas: { projectId: EAS_PROJECT_ID },
    router: {},
    // shown in the onboarding notice: who to contact. Plain text, not a secret.
    supportContact: process.env.EXPO_PUBLIC_SUPPORT_CONTACT ?? 'your tour manager',
  },
});
