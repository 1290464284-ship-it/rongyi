import { test, expect } from '@playwright/test';

test.describe('Charge Management', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[type="text"]', 'boss');
    await page.fill('input[type="password"]', '123456');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/dashboard');
  });

  test('should display charge list', async ({ page }) => {
    await page.goto('/charge-v2');
    await expect(page.getByText(/收费|收费管理/i)).toBeVisible();
  });
});
