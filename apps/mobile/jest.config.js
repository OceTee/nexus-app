/** @type {import('jest').Config} */
module.exports = {
  preset: 'jest-expo',
  setupFiles: ['<rootDir>/src/test/jest.setup.ts'],
  testMatch: ['<rootDir>/__tests__/**/*.test.ts?(x)'],
  collectCoverageFrom: ['src/**/*.{ts,tsx}', 'app/**/*.{ts,tsx}', '!src/test/**'],
  // TDD Section L, Coverage targets: CI fails when coverage drops below these.
  coverageThreshold: {
    global: { lines: 80, branches: 70 },
    './src/data/sync/': { lines: 90, branches: 85 },
    './src/data/repos/outbox.ts': { lines: 90, branches: 85 },
    './src/features/': { lines: 70, branches: 60 },
    './src/ui/': { lines: 70, branches: 60 },
    './app/': { lines: 70, branches: 60 },
  },
  // lucide resolves to its ES module build under the react-native condition; use its CommonJS build in Jest.
  moduleNameMapper: {
    '^lucide-react-native$':
      '<rootDir>/../../node_modules/lucide-react-native/dist/cjs/lucide-react-native.js',
  },
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|react-navigation|@react-navigation/.*|lucide-react-native|react-native-svg|standard-navigation|@nexus/.*))',
  ],
};
