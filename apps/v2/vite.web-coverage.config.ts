import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    testTimeout: 10_000,
    environment: 'jsdom',
    // T-1：单进程收集（vitest 4 官方选项 fileParallelism: false，自动覆盖 maxWorkers=1），
    // 避免多 worker v8 合并丢失分支表（与服务端覆盖配置同口径）。
    fileParallelism: false,
    coverage: {
      provider: 'v8',
      reportsDirectory: 'coverage-web',
      include: ['src/web/**/*.tsx', 'src/web/**/*.ts'],
      // 实测基线（2026-08-07，v8 provider）：lines 85.5 / functions 79.5 /
      // statements 82.16 / branches 71.78。UI 翻新 + 页面测试补齐后实测
      // lines 99.87 / branches 99.91，门槛收紧到实测 −2~5%，杜绝“掉 15 点仍绿”。
      thresholds: {
        statements: 95,
        branches: 95,
        functions: 95,
        lines: 95,
      },
    },
  },
});
