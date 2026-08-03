import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    coverage: {
      provider: 'v8',
      thresholds: {
        statements: 100,
        branches: 100,
        functions: 100,
        lines: 100,
      },
    },
  },
  root: '.',
  build: {
    outDir: 'dist-web',
    emptyOutDir: true,
  },
  server: {
    port: 5180,
    proxy: {
      '/api': 'http://localhost:3180',
    },
  },
});
