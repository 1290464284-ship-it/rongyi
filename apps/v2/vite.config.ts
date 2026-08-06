import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

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
      thresholds: {
        statements: 100,
        branches: 100,
        functions: 100,
        lines: 100,
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
    port: 5180,
    proxy: {
      '/api': 'http://localhost:3180',
    },
  },
});
