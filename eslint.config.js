const js = require('@eslint/js');
const globals = require('globals');
module.exports = [
  { ignores: ['node_modules/**', '.vscode-test/**', 'dist/**'] },
  js.configs.recommended,
  { files: ['src/core/**/*.js'], rules: {
    'no-restricted-modules': ['error', { patterns: ['vscode', '**/adapters/**', '**/presentation/**'] }],
    'no-restricted-imports': ['error', { patterns: ['vscode', '**/adapters/**', '**/presentation/**'] }]
  } },
  { files: ['src/adapters/**/*.js'], rules: {
    'no-restricted-modules': ['error', { patterns: ['**/presentation/**'] }],
    'no-restricted-imports': ['error', { patterns: ['**/presentation/**'] }]
  } },
  { languageOptions: { ecmaVersion: 2022, sourceType: 'commonjs', globals: globals.node },
    rules: { 'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }] } }
];
