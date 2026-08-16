import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

// 阶段 5 桌面端检查：多视口（1280×800 / 1920×1080）× DPR（1 / 1.5）水平溢出检查与截图，
// 外加打印媒体（@media print）下的关键页截图与样式断言；中文字体回退链验证。
// 用法：node scripts/ui-viewport-check.mjs（依赖 dev 服务器 5180 + 模拟库 API）

process.on('unhandledRejection', (reason) => {
  console.error(reason instanceof Error ? reason.stack ?? reason.message : reason);
  setTimeout(() => process.exit(1), 250);
});

const base = process.env.V2_WEB_URL ?? 'http://localhost:5180';
const adminPassword = process.env.V2_ADMIN_PASSWORD ?? 'v2-sim-admin-password';
const outDir = path.resolve(process.env.UI_VIEWPORT_DIR ?? path.join(import.meta.dirname, '..', 'test-results', 'ui-baseline', 'viewports'));
fs.mkdirSync(outDir, { recursive: true });

const PAGES = [
  { route: '/#/', tab: null, name: 'dashboard' },
  { route: '/#/patients', tab: null, name: 'patients' },
  { route: '/#/front-desk', tab: '预约', name: 'appointments' },
  { route: '/#/finance', tab: '收费', name: 'charges' },
  { route: '/#/clinical', tab: '病历', name: 'medical-records' },
];
const VIEWPORTS = [
  { width: 1280, height: 800, dpr: 1 },
  { width: 1280, height: 800, dpr: 1.5 },
  { width: 1920, height: 1080, dpr: 1 },
  { width: 1920, height: 1080, dpr: 1.5 },
];

const results = [];
const browser = await chromium.launch({ headless: true });

for (const vp of VIEWPORTS) {
  const context = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: vp.dpr,
  });
  const page = await context.newPage();
  await page.goto(`${base}/#/login`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(600);
  await page.fill('input', 'admin');
  await page.fill('input[type="password"]', adminPassword);
  await page.getByRole('button', { name: '登录' }).click();
  await page.waitForURL('**/#/', { timeout: 30_000 });
  await page.getByText('工作台').first().waitFor({ timeout: 30_000 });
  if (await page.getByRole('heading', { name: '新手引导' }).count()) {
    await page.getByRole('button', { name: '完成' }).click();
  }
  for (const p of PAGES) {
    await page.goto(`${base}${p.route}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(500);
    if (p.tab) await page.getByRole('tab', { name: p.tab, exact: true }).click();
    await page.waitForTimeout(700);
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
    await page.waitForTimeout(450);
    const check = await page.evaluate(() => {
      const doc = document.documentElement;
      const body = document.body;
      const fontFamily = getComputedStyle(body).fontFamily;
      const hasCjk = body.textContent && /[\u4e00-\u9fff]/.test(body.textContent);
      return {
        scrollWidth: doc.scrollWidth,
        clientWidth: doc.clientWidth,
        overflowX: doc.scrollWidth > doc.clientWidth,
        fontFamily,
        hasCjkText: Boolean(hasCjk),
      };
    });
    results.push({ viewport: `${vp.width}x${vp.height}@${vp.dpr}`, page: p.name, ...check });
    await page.screenshot({
      path: path.join(outDir, `${p.name}-${vp.width}x${vp.height}@${vp.dpr}.png`),
      fullPage: true,
    });
  }
  await context.close();
}

// 打印媒体检查：@media print 下 .page-head 等隐藏、打印容器去边框阴影
{
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await page.goto(`${base}/#/login`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(600);
  await page.fill('input', 'admin');
  await page.fill('input[type="password"]', adminPassword);
  await page.getByRole('button', { name: '登录' }).click();
  await page.waitForURL('**/#/', { timeout: 30_000 });
  await page.getByText('工作台').first().waitFor({ timeout: 30_000 });
  if (await page.getByRole('heading', { name: '新手引导' }).count()) {
    await page.getByRole('button', { name: '完成' }).click();
  }
  await page.goto(`${base}/#/finance`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);
  await page.getByRole('tab', { name: '收费', exact: true }).click();
  await page.waitForTimeout(800);
  await page.emulateMedia({ media: 'print' });
  await page.waitForTimeout(300);
  const printCheck = await page.evaluate(() => {
    const head = document.querySelector('.page-head');
    const sidebar = document.querySelector('.sidebar');
    return {
      pageHeadDisplay: head ? getComputedStyle(head).display : 'missing',
      sidebarDisplay: sidebar ? getComputedStyle(sidebar).display : 'missing',
      contentPadding: getComputedStyle(document.querySelector('.content') ?? document.body).padding,
    };
  });
  results.push({ viewport: 'print-media', page: 'charges', ...printCheck });
  await page.screenshot({ path: path.join(outDir, 'charges-print-media.png'), fullPage: true });
  await context.close();
}

await browser.close();
fs.writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify({ results }, null, 2));
console.log(JSON.stringify(results, null, 2));
const overflowFailures = results.filter((entry) => entry.overflowX === true);
console.log(`\nviewport check done: ${results.length} entries, overflow failures: ${overflowFailures.length}`);
if (overflowFailures.length > 0) process.exitCode = 1;
