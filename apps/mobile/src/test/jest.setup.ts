// Jest setup: mocks for native modules that have no JavaScript fallback.
jest.mock('react-native-keyboard-controller', () =>
  jest.requireActual('react-native-keyboard-controller/jest'),
);
