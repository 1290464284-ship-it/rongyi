import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    coverage: {
      provider: 'v8',
      include: ['src/web/**/*.tsx', 'src/web/**/*.ts'],
      thresholds: {
        statements: 98.5,
        // TODO: 逐步恢复 branches 阈值到 92.5
        branches: 88,
        functions: 98.5,
        lines: 100,
      },
    },
  },
});
