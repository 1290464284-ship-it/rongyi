import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30000,
  retries: 1,
  fullyParallel: false,
  use: {
    baseURL: 'http://localhost:5173',
    headless: true,
    screenshot: 'only-on-failure',
    viewport: { width: 1280, height: 720 },
  },
  expect: {
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.1,
      threshold: 0.2,
    },
  },
  webServer: {
    // 同时启动 API (port 3001) 和 Web (port 5173) dev server
    // E2E 测试需要后端 API 支持登录、数据查询等操作
    command: 'cd ../.. && pnpm dev',
    port: 5173,
    reuseExistingServer: true,
    timeout: 120000,
  },
});
