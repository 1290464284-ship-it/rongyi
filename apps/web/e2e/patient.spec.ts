import { test, expect } from '@playwright/test';

test.describe('Patient Management', () => {
  test.beforeEach(async ({ page }) => {
    // Login first
    await page.goto('/login');
    await page.fill('input[id="username"]', 'boss');
    await page.fill('input[id="password"]', '0801');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/dashboard');
  });

  test('should display patient list', async ({ page }) => {
    await page.goto('/patients');
    await expect(page.getByText(/患者|患者列表/i)).toBeVisible();
  });

  test('should open patient form', async ({ page }) => {
    await page.goto('/patients');
    const addBtn = page.getByRole('button', { name: /新增|添加|新建/i });
    if (await addBtn.isVisible()) {
      await addBtn.click();
      await expect(page.getByText(/姓名|基本信息/i)).toBeVisible();
    }
  });
});
