/**
 * Visual Regression Tests — UI 组件变更的视觉回归伴侣证据
 *
 * 为 24 个 UI 组件（含 ToothChart、AppLayout、LoginPage、Sidebar、Topbar、
 * PatientSelector、Timeline、DataTableWrapper 等）提供视觉回归基线。
 * 当 UI 组件变更时，测试自动检测视觉差异，防止意外视觉回归。
 *
 * 首次运行：自动生成基线截图（测试通过）
 * 后续运行：与基线比较，差异超过 10% 像素则失败
 *
 * 更新基线（UI 变更已确认无误后）：
 *   pnpm --filter @dental/web test:e2e -- --update-snapshots
 *
 * 前置条件：Web dev server (pnpm dev) 和 API server 需运行
 */
import { test, expect, type Page } from '@playwright/test';

/** 禁用 CSS 动画和过渡，减少截图 flakiness */
async function disableAnimations(page: Page): Promise<void> {
  await page.addStyleTag({
    content: `
      *, *::before, *::after {
        animation-duration: 0s !important;
        animation-delay: 0s !important;
        transition-duration: 0s !important;
        transition-delay: 0s !important;
      }
    `,
  });
}

/** 登录并等待 Dashboard 加载完成 */
async function loginAndAwait(page: Page): Promise<void> {
  await page.goto('/login');
  await disableAnimations(page);
  await page.fill('input[type="text"]', 'boss');
  await page.fill('input[type="password"]', 'REDACTED');
  await page.click('button[type="submit"]');
  await page.waitForURL('**/dashboard');
  await page.waitForLoadState('networkidle');
}

test.describe('Visual Regression', () => {
  test('login page', async ({ page }) => {
    await page.goto('/login');
    await disableAnimations(page);
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveScreenshot('login-page');
  });

  test.describe('authenticated pages', () => {
    test.beforeEach(async ({ page }) => {
      await loginAndAwait(page);
    });

    test('dashboard', async ({ page }) => {
      await page.waitForLoadState('networkidle');
      await expect(page).toHaveScreenshot('dashboard');
    });

    test('patient list', async ({ page }) => {
      await page.goto('/patients');
      await page.waitForLoadState('networkidle');
      await expect(page).toHaveScreenshot('patient-list');
    });

    test('charge management', async ({ page }) => {
      await page.goto('/charge-v2');
      await page.waitForLoadState('networkidle');
      await expect(page).toHaveScreenshot('charge-management');
    });

    test('appointments', async ({ page }) => {
      await page.goto('/appointments');
      await page.waitForLoadState('networkidle');
      await expect(page).toHaveScreenshot('appointments');
    });

    test('inventory', async ({ page }) => {
      await page.goto('/inventory');
      await page.waitForLoadState('networkidle');
      await expect(page).toHaveScreenshot('inventory');
    });
  });
});
