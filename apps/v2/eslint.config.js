import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';

export default tseslint.config(
  {
    ignores: [
      'node_modules/**',
      'dist-web/**',
      'dist-electron/**',
      'release-v2/**',
      'coverage/**',
      'coverage-web/**',
      'data/**',
      'logs/**',
      'legacy/**',
    ],
  },
  ...tseslint.configs.recommended,
  {
    files: ['**/*.cjs'],
    languageOptions: {
      globals: {
        Buffer: 'readonly',
        URL: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        clearInterval: 'readonly',
        clearTimeout: 'readonly',
        console: 'readonly',
        exports: 'writable',
        fetch: 'readonly',
        global: 'readonly',
        module: 'writable',
        process: 'readonly',
        require: 'readonly',
        setImmediate: 'readonly',
        setInterval: 'readonly',
        setTimeout: 'readonly',
      },
    },
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
      'no-undef': 'error',
    },
  },
  {
    files: ['**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-namespace': 'off',
    },
  },
  {
    // 路由/配置桶和表格列文件不是可独立热更新的组件模块，
    // react-refresh 规则在这里产生的是误报，定向关闭而不是全局关闭。
    files: [
      'src/web/components/hub-tabs.tsx',
      'src/web/components/index.tsx',
      'src/web/appointments/columns.tsx',
      'src/web/schedules/columns.tsx',
    ],
    rules: {
      'react-refresh/only-export-components': 'off',
    },
  },
);
