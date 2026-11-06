import Constants from 'expo-constants';

/**
 * API base URL, baked in per build profile (EXPO_PUBLIC_API_URL). For a phone
 * on USB or Wi-Fi debugging, `adb reverse tcp:4000 tcp:4000` makes
 * localhost on the phone reach the API on the computer.
 */
export const API_URL: string = (process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:4000').replace(
  /\/$/,
  '',
);

export const APP_VERSION: string = Constants.expoConfig?.version ?? '1.0.0';

/** Request timeout; sync batches can be large, so this is generous. */
export const REQUEST_TIMEOUT_MS = 20_000;
