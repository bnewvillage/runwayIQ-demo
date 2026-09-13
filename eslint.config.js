import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';

/**
 * Minimal, deliberately: the rules that catch bugs a build cannot.
 * `no-undef` and `no-unused-vars` would each have caught a real defect
 * that reached production -- a bootstrap effect deleted during a refactor
 * left getBrands imported but never called, and a removed const left
 * inactiveCount referenced but undefined. Both are valid JavaScript, so
 * Vite built them without complaint.
 */
export default [
  { ignores: ['dist/**', 'node_modules/**'] },
  {
    files: ['src/**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.browser },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...js.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      // JSX identifiers read as unused to the base rule.
      'no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z]', args: 'none' }],
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
];
