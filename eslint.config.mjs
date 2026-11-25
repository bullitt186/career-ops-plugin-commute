// ESLint (repo-kit CI standard, category 2): `npm run lint` (with `prettier --check`).
import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['node_modules/**', 'reports/**', '.stryker-tmp/**'] },
  {
    files: ['**/*.mjs'],
    ...js.configs.recommended,
    languageOptions: { ecmaVersion: 2022, sourceType: 'module', globals: { ...globals.node } },
    rules: {
      ...js.configs.recommended.rules,
      // A leading underscore marks a parameter that is required by the signature but unused.
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
];
