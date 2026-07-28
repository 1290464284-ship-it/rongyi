import tseslint from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import eslint from '@eslint/js';
import globals from 'globals';

export default [
  eslint.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        sourceType: 'module',
        ecmaVersion: 2022,
        ecmaFeatures: { jsx: true },
      },
      globals: {
        ...globals.browser,
      },
    },
    plugins: {
      '@typescript-eslint': tseslint,
    },
    rules: {
      ...tseslint.configs.recommended.rules,
      // no-explicit-any 保持 recommended 默认 error，与 .qoder/rules/no-typescript-any.md 一致
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],
      '@typescript-eslint/no-empty-function': 'off',
      '@typescript-eslint/no-empty-object-type': 'off',
      '@typescript-eslint/no-namespace': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/ban-ts-comment': 'off',
      '@typescript-eslint/no-this-alias': 'off',
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/no-dynamic-delete': 'off',
      '@typescript-eslint/no-extraneous-class': 'off',
      'no-undef': 'off',
      'no-empty': 'off',
      'no-unreachable': 'off',
      'no-case-declarations': 'off',
      'no-fallthrough': 'off',
      'no-useless-escape': 'off',
      'no-redeclare': 'off',
      'no-useless-assignment': 'off',

      // 架构约束：禁止第三方 UI 框架导入（.qoder/rules/frontend-ui-framework.md）
      // 架构约束：禁止前端直接访问数据库（.qoder/rules/frontend-no-direct-data.md）
      // 架构约束：禁止组件直接使用 axios（.qoder/rules/frontend-api-layer.md）
      // lib/api/ 封装层通过下方 override 豁免
      'no-restricted-imports': [
        'error',
        {
          paths: [
            // UI 框架
            { name: 'antd', message: '禁止使用 Ant Design。本项目使用 TailwindCSS + 自定义组件库，参见 .qoder/rules/frontend-ui-framework.md' },
            { name: '@mui/material', message: '禁止使用 MUI。本项目使用 TailwindCSS + 自定义组件库，参见 .qoder/rules/frontend-ui-framework.md' },
            { name: '@chakra-ui/react', message: '禁止使用 Chakra UI。本项目使用 TailwindCSS + 自定义组件库，参见 .qoder/rules/frontend-ui-framework.md' },
            { name: '@emotion/react', message: '禁止使用 Emotion。本项目使用 TailwindCSS + 自定义组件库，参见 .qoder/rules/frontend-ui-framework.md' },
            { name: '@emotion/styled', message: '禁止使用 Emotion styled。本项目使用 TailwindCSS + 自定义组件库，参见 .qoder/rules/frontend-ui-framework.md' },
            { name: 'material-ui', message: '禁止使用 Material UI。本项目使用 TailwindCSS + 自定义组件库，参见 .qoder/rules/frontend-ui-framework.md' },
            { name: 'semantic-ui-react', message: '禁止使用 Semantic UI。本项目使用 TailwindCSS + 自定义组件库，参见 .qoder/rules/frontend-ui-framework.md' },
            { name: 'primereact', message: '禁止使用 PrimeReact。本项目使用 TailwindCSS + 自定义组件库，参见 .qoder/rules/frontend-ui-framework.md' },
            { name: '@blueprintjs/core', message: '禁止使用 Blueprint。本项目使用 TailwindCSS + 自定义组件库，参见 .qoder/rules/frontend-ui-framework.md' },
            // 数据库直接访问
            { name: 'better-sqlite3', message: '前端禁止直接访问数据库，所有数据操作须通过 API 层，参见 .qoder/rules/frontend-no-direct-data.md' },
            { name: 'sqlite3', message: '前端禁止直接访问数据库，所有数据操作须通过 API 层，参见 .qoder/rules/frontend-no-direct-data.md' },
            // 直接 axios 使用（lib/api/ 除外，见下方 override）
            { name: 'axios', message: '组件禁止直接调用 axios，必须通过 lib/api/ 封装层，参见 .qoder/rules/frontend-api-layer.md' },
          ],
        },
      ],
      // 架构约束：禁止组件中直接调用 fetch（.qoder/rules/frontend-api-layer.md）
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.name='fetch']",
          message: '组件禁止直接调用 fetch()，必须通过 lib/api/ 封装层，参见 .qoder/rules/frontend-api-layer.md',
        },
      ],
    },
  },
  // lib/api/ 封装层豁免：允许使用 axios 和 fetch（.qoder/rules/frontend-api-layer.md 例外条款）
  {
    files: ['src/lib/api/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': 'off',
      'no-restricted-syntax': 'off',
    },
  },
  // 测试文件豁免 no-explicit-any（.qoder/rules/no-typescript-any.md 允许测试中使用 as any 进行 mock）
  {
    files: ['src/**/*.test.{ts,tsx}', 'src/**/__tests__/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  {
    ignores: ['dist', 'dist-web', 'node_modules', 'electron', '*.config.*'],
  },
];
