const tseslint = require('@typescript-eslint/eslint-plugin');
const tsParser = require('@typescript-eslint/parser');
const eslint = require('@eslint/js');
const globals = require('globals');

module.exports = [
  eslint.configs.recommended,
  {
    files: ['**/*.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        sourceType: 'module',
        ecmaVersion: 2022,
      },
      globals: {
        ...globals.node,
        ...globals.jest,
      },
    },
    plugins: {
      '@typescript-eslint': tseslint,
    },
    rules: {
      ...tseslint.configs.recommended.rules,
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/no-empty-function': 'off',
      '@typescript-eslint/no-empty-object-type': 'off',
      '@typescript-eslint/no-namespace': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/ban-ts-comment': 'off',
      '@typescript-eslint/ban-types': 'off',
      '@typescript-eslint/no-this-alias': 'off',
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/no-dynamic-delete': 'off',
      '@typescript-eslint/no-extraneous-class': 'off',
      'no-undef': 'off',
      'no-empty': 'off',
      'no-unreachable': 'off',
      'no-import-assign': 'off',
      'prefer-const': 'off',
      'no-case-declarations': 'off',
      'no-fallthrough': 'off',
      'no-useless-escape': 'off',
      'no-redeclare': 'off',
      'no-useless-assignment': 'off',
    },
  },
  {
    ignores: ['dist', 'node_modules', 'bundle', 'eslint.config.js', 'eslint.config.cjs'],
  },
];
