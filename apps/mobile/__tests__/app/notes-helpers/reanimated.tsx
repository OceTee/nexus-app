// A minimal Reanimated for screens that animate with shared values: values are
// plain objects and animated styles are computed once. Reanimated 4's own Jest
// mock needs the native worklets runtime, which is not available here.
// Use with: jest.mock('react-native-reanimated', () => jest.requireActual('../notes-helpers/reanimated'));
// expo-router/testing-library re-mocks Reanimated when imported, so import the screen first.
import { View } from 'react-native';

export const useSharedValue = <T,>(value: T) => ({ value });
export const useAnimatedStyle = <T,>(style: () => T) => style();
export const withTiming = <T,>(value: T) => value;

export default { View };
