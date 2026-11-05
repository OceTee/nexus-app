/** @type {import('jest').Config} */
module.exports = {
  preset: 'jest-expo',
  testMatch: ['<rootDir>/test/**/*.test.ts?(x)'],
  collectCoverageFrom: ['src/**/*.{ts,tsx}', '!src/**/*.web.{ts,tsx}'],
};
