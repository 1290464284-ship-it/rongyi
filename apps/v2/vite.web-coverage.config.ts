import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    coverage: {
      provider: 'v8',
      include: ['src/web/ResourceHub.tsx', 'src/web/ResourcePage.tsx', 'src/web/hub-tabs.tsx'],
      thresholds: {
        statements: 90,
        branches: 75,
        functions: 90,
        lines: 95,
      },
    },
  },
});
