import { test, expect } from '@playwright/test';

test.describe('Charge Management', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[id="username"]', 'boss');
    await page.fill('input[id="password"]', '0801');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/dashboard');
  });

  test('should display charge list', async ({ page }) => {
    await page.goto('/charge-v2');
    // 页面含多个"收费"文本（待处理收费、本月收费笔数等），用 first 避免严格模式冲突
    await expect(page.getByText(/收费|收费管理/i).first()).toBeVisible();
  });
});
