import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { simAdminPassword } from './lib/sim-admin.mjs';

// A1 精确定位：从 modal-backdrop 向上遍历祖先链，找出持有 transform/contain 的祖先，
// 并验证顶栏在弹窗打开期间是否可交互（elementFromPoint 命中测试）。

process.on('unhandledRejection', (reason) => {
  console.error(reason instanceof Error ? reason.stack ?? reason.message : reason);
  setTimeout(() => process.exit(1), 250);
});

const base = process.env.V2_WEB_URL ?? 'http://localhost:5180';
const adminPassword = simAdminPassword();
const outDir = path.resolve(process.env.UI_BASELINE_DIR ?? path.join(import.meta.dirname, '..', 'test-results', 'ui-baseline', 'before'));
fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();

try {
  await page.goto(`${base}/#/login`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(700);
  await page.fill('input', 'admin');
  await page.fill('input[type="password"]', adminPassword);
  await page.getByRole('button', { name: '登录' }).click();
  await page.waitForURL('**/#/', { timeout: 30_000 });
  await page.getByText('工作台').first().waitFor({ timeout: 30_000 });
  if (await page.getByRole('heading', { name: '新手引导' }).count()) {
    await page.getByRole('button', { name: '完成' }).click();
  }

  await page.goto(`${base}/#/patients`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(700);
  await page.getByRole('button', { name: '新建' }).first().click();
  await page.waitForSelector('.modal-backdrop', { timeout: 10_000 });
  await page.waitForTimeout(500);

  const probe = await page.evaluate(() => {
    const backdrop = document.querySelector('.modal-backdrop');
    const chain = [];
    let el = backdrop;
    while (el) {
      const cs = getComputedStyle(el);
      chain.push({
        sel: `${el.tagName.toLowerCase()}${typeof el.className === 'string' && el.className ? `.${String(el.className).split(/\s+/).join('.')}` : ''}`,
        transform: cs.transform,
        position: cs.position,
        zIndex: cs.zIndex,
        contain: cs.contain,
        filter: cs.filter,
        animation: cs.animationName,
        rect: el.getBoundingClientRect().toJSON(),
      });
      el = el.parentElement;
    }
    const topbar = document.querySelector('.topbar');
    const tbRect = topbar?.getBoundingClientRect();
    const points = [];
    if (tbRect) {
      for (const x of [tbRect.left + 100, tbRect.left + tbRect.width / 2, tbRect.right - 120]) {
        const hit = document.elementFromPoint(x, tbRect.top + tbRect.height / 2);
        points.push({ x, hit: hit ? `${hit.tagName}.${String(hit.className)}` : null });
      }
    }
    const searchInput = document.querySelector('.topbar-search');
    const searchDisabled = searchInput ? searchInput.matches(':disabled') : null;
    const searchPointerEvents = searchInput ? getComputedStyle(searchInput).pointerEvents : null;
    return { chain, points, topbarRect: tbRect?.toJSON(), searchDisabled, searchPointerEvents };
  });
  fs.writeFileSync(path.join(outDir, 'a1-ancestor-probe.json'), JSON.stringify(probe, null, 2));
  console.log(JSON.stringify(probe, null, 2));
  await page.screenshot({ path: path.join(outDir, 'a1-modal-open-light.png') });
  console.log('saved a1-modal-open-light.png');
} finally {
  await context.close();
  await browser.close();
}
