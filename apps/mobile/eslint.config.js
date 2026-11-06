// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');
const prettier = require('eslint-config-prettier');

module.exports = defineConfig([
  expoConfig,
  prettier,
  {
    ignores: ['dist/*', 'android/*', 'ios/*', '.expo/*', 'coverage/*'],
  },
  {
    // Maestro runScript files: GraalJS with Maestro's globals and flow env vars.
    files: ['.maestro/scripts/**/*.js'],
    languageOptions: {
      globals: {
        http: 'readonly',
        output: 'writable',
        maestro: 'readonly',
        API_URL: 'readonly',
        EMAIL: 'readonly',
        PASSWORD: 'readonly',
        ACTION: 'readonly',
        TITLE: 'readonly',
        EDIT_TEXT: 'readonly',
        EXPECT: 'readonly',
      },
    },
  },
]);
