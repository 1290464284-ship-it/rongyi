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
        statements: 55,
        branches: 45,
        functions: 45,
        lines: 55,
      },
    },
  },
});
