import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { simAdminPassword } from './lib/sim-admin.mjs';

// UI 基线截图 + A1 弹窗遮罩层级目验（阶段 1 → 阶段 6 之间的改前基线，R14 视觉回归护栏）
// 用法（在 apps/v2 下）：
//   node scripts/ui-baseline-shots.mjs                     # 亮色
//   $env:UI_BASELINE_SCHEME='dark'; node scripts/ui-baseline-shots.mjs  # 暗色
// 前置：V2_WEB_URL 指向已启动的 dev 服务器（默认 http://localhost:5180），
//       其 API 为模拟库（admin 密码 v2-sim-admin-password，可用 V2_ADMIN_PASSWORD 覆盖）。

process.on('unhandledRejection', (reason) => {
  console.error(reason instanceof Error ? reason.stack ?? reason.message : reason);
  setTimeout(() => process.exit(1), 250);
});
process.on('uncaughtException', (error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  setTimeout(() => process.exit(1), 250);
});

const base = process.env.V2_WEB_URL ?? 'http://localhost:5180';
const adminPassword = simAdminPassword();
const scheme = process.env.UI_BASELINE_SCHEME ?? 'light';
const outDir = path.resolve(process.env.UI_BASELINE_DIR ?? path.join(import.meta.dirname, '..', 'test-results', 'ui-baseline', 'before'));

fs.mkdirSync(outDir, { recursive: true });

// 关键页面（阶段 7 列表）：路由 → hub tab → 页内标题
const PAGES = [
  { route: '/#/login', tab: null, heading: null, name: 'login' },
  { route: '/#/', tab: null, heading: '工作台', name: 'dashboard' },
  { route: '/#/front-desk', tab: '预约', heading: '预约管理', name: 'appointments' },
  { route: '/#/front-desk', tab: '预约看板', heading: '预约看板', name: 'appointment-board' },
  { route: '/#/patients', tab: null, heading: '患者档案', name: 'patients' },
  { route: '/#/finance', tab: '收费', heading: '收费管理', name: 'charges' },
  { route: '/#/inventory', tab: null, heading: '库存工作台', name: 'inventory' },
  { route: '/#/clinical', tab: '病历', heading: '病历管理', name: 'medical-records' },
  { route: '/#/clinical', tab: '头影测量', heading: '头影测量管理', name: 'cephalometric' },
  { route: '/#/system', tab: '桌面端', heading: '桌面端设置', name: 'settings' },
];

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  colorScheme: scheme === 'dark' ? 'dark' : 'light',
});
const page = await context.newPage();
const shot = async (name) => {
  await page.waitForTimeout(450); // 等 pageRise 动画结束、数据稳定
  await page.screenshot({ path: path.join(outDir, `${name}-${scheme}.png`), fullPage: true });
  console.log(`saved ${name}-${scheme}.png`);
};

try {
  // 1. 登录页（未登录态）
  await page.goto(`${base}/#/login`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(900);
  await shot('login');

  // 2. 登录
  await page.fill('input', 'admin');
  await page.fill('input[type="password"]', adminPassword);
  await page.getByRole('button', { name: '登录' }).click();
  await page.waitForURL('**/#/', { timeout: 30_000 });
  await page.getByText('工作台').first().waitFor({ timeout: 30_000 });
  if (await page.getByRole('heading', { name: '新手引导' }).count()) {
    await page.getByRole('button', { name: '完成' }).click();
  }
  await page.waitForTimeout(600);

  // 3. 逐页截图
  for (const p of PAGES.slice(1)) {
    await page.goto(`${base}${p.route}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(500);
    if (p.tab) {
      const tab = page.getByRole('tab', { name: p.tab, exact: true });
      await tab.click();
      await page.waitForTimeout(700);
    }
    if (p.heading) {
      await page.getByRole('heading', { name: p.heading }).waitFor({ timeout: 20_000 }).catch(() => {
        console.warn(`heading not found: ${p.heading} (${p.name})`);
      });
    }
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
    await shot(p.name);
  }

  // 4. A1 目验：打开弹窗，检查顶栏与遮罩的层叠关系
  if (scheme === 'light') {
    await page.goto(`${base}/#/patients`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(600);
    const createBtn = page.getByRole('button', { name: '新建' }).first();
    await createBtn.click();
    await page.waitForSelector('.modal-backdrop', { timeout: 10_000 });
    await page.waitForTimeout(400);
    const a1 = await page.evaluate(() => {
      const q = (sel) => document.querySelector(sel);
      const pageEl = q('.page');
      const topbar = q('.topbar');
      const backdrop = q('.modal-backdrop');
      const cs = pageEl ? getComputedStyle(pageEl) : null;
      const tbRect = topbar?.getBoundingClientRect();
      let elementAtTopbarCenter = null;
      if (tbRect) {
        const el = document.elementFromPoint(tbRect.left + tbRect.width / 2, tbRect.top + tbRect.height / 2);
        elementAtTopbarCenter = el ? `${el.tagName}.${String(el.className)}` : null;
      }
      const backdropRect = backdrop?.getBoundingClientRect();
      let elementAtTopbarTitle = null;
      if (tbRect) {
        const el = document.elementFromPoint(tbRect.left + 40, tbRect.top + tbRect.height / 2);
        elementAtTopbarTitle = el ? `${el.tagName}.${String(el.className)}` : null;
      }
      return {
        pageTransform: cs?.transform,
        pageZIndex: cs?.zIndex,
        topbarZ: topbar ? getComputedStyle(topbar).zIndex : null,
        backdropZ: backdrop ? getComputedStyle(backdrop).zIndex : null,
        backdropPosition: backdrop ? getComputedStyle(backdrop).position : null,
        topbarRect: tbRect ? { top: tbRect.top, height: tbRect.height } : null,
        backdropRect: backdropRect ? { top: backdropRect.top, bottom: backdropRect.bottom } : null,
        elementAtTopbarCenter,
        elementAtTopbarTitle,
      };
    });
    fs.writeFileSync(path.join(outDir, 'a1-stack-probe.json'), JSON.stringify(a1, null, 2));
    console.log('A1 probe:', JSON.stringify(a1));
    await page.screenshot({ path: path.join(outDir, 'a1-modal-open-light.png') });
    console.log('saved a1-modal-open-light.png');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
  }

  console.log(`baseline done (${scheme}) → ${outDir}`);
} catch (error) {
  await page.screenshot({ path: path.join(outDir, `failure-${scheme}.png`), fullPage: true }).catch(() => {});
  throw error;
} finally {
  await context.close();
  await browser.close();
}
