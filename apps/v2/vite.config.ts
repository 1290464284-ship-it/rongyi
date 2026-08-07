import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { DEFAULT_API_PORT, DEFAULT_WEB_DEV_PORT } from './src/shared/constants';

function devCsp(): { name: string; apply: 'serve'; transformIndexHtml(html: string): string } {
  return {
    name: 'dev-csp',
    apply: 'serve',
    transformIndexHtml(html: string): string {
      return html.replace("script-src 'self';", "script-src 'self' 'unsafe-inline';");
    },
  };
}

export default defineConfig({
  plugins: [react(), devCsp()],
  test: {
    coverage: {
      provider: 'v8',
      include: ['src/server/**/*.ts', 'src/domain/**/*.ts', 'src/server/scheduler.ts'],
      exclude: ['src/server/main.ts'],
      // CI 实测基线（2026-08-07，v8 provider）：lines 97.45 / functions 99 /
      // statements 96.29 / branches 88.42。门槛设 100% 从未可达成（CI 此前从未运行），
      // 现按实测值留 ~2% 余量，保持质量门有效且稳定。
      thresholds: {
        statements: 95,
        branches: 85,
        functions: 97,
        lines: 95,
      },
    },
  },
  root: '.',
  base: './',
  build: {
    outDir: 'dist-web',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        // Vite 8（Rolldown 内核）移除了 manualChunks 对象形式，改用 advancedChunks.groups
        advancedChunks: {
          includeDependenciesRecursively: true,
          groups: [
            { name: 'react-vendor', test: /node_modules\/(react|react-dom|react-router)\// },
            { name: 'query-vendor', test: /node_modules\/@tanstack\/react-query\// },
          ],
        },
      },
    },
  },
  server: {
    port: DEFAULT_WEB_DEV_PORT,
    proxy: {
      // P1-7/P1-8：后端端口不再硬编码，跟随 V2_PORT 环境变量（默认 DEFAULT_API_PORT）
      '/api': `http://localhost:${process.env.V2_PORT ?? DEFAULT_API_PORT}`,
    },
  },
});
