import { test, expect } from '@playwright/test';

test.describe('Login', () => {
  test('should login with valid credentials', async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[name="username"], input[type="text"]', 'boss');
    await page.fill('input[name="password"], input[type="password"]', '123456');
    await page.click('button[type="submit"]');
    await expect(page).not.toHaveURL('/login');
  });

  test('should show error with invalid credentials', async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[name="username"], input[type="text"]', 'wrong');
    await page.fill('input[name="password"], input[type="password"]', 'wrong');
    await page.click('button[type="submit"]');
    await expect(page.getByText(/错误|失败|invalid/i)).toBeVisible();
  });
});
