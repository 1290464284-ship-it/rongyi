// 蓉易口腔诊所 · UI 原型 —— 本地验证脚本（Playwright，非交付物）
// 用法：node scripts/verify.js <相对页面> '<JSON 检查项>' [截图名]
// 检查项示例：[{"sel":".btn-primary","css":"background-color","eq":"rgb(14, 138, 138)"}]
//   - 只有 sel：元素存在
//   - sel + css + eq：计算样式等于 eq
//   - sel + css + re：计算样式匹配正则
const { chromium } = require('D:/Desktop/rongyi/source/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright');
const path = require('path');

(async () => {
  const [file, checksJson, shot] = process.argv.slice(2);
  const url = 'file://' + path.resolve(__dirname, '..', file).replace(/\\/g, '/');
  const checks = JSON.parse(checksJson);
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  await page.goto(url, { waitUntil: 'networkidle' });
  let fail = 0;
  for (const c of checks) {
    const el = await page.$(c.sel);
    if (!el) {
      console.log('FAIL ' + c.sel + ': 元素不存在');
      fail++;
      continue;
    }
    if (c.css) {
      const v = await el.evaluate((e, p) => getComputedStyle(e)[p], c.css);
      const ok = c.eq ? v === c.eq : (c.re ? c.re.test(v) : true);
      console.log((ok ? 'PASS' : 'FAIL') + ' ' + c.sel + ' ' + c.css + '=' + v + (c.eq ? ' (期望 ' + c.eq + ')' : ''));
      if (!ok) fail++;
    } else {
      console.log('PASS ' + c.sel + ' 存在');
    }
  }
  if (shot) {
    const dir = path.join(__dirname, '..', 'screenshots');
    require('fs').mkdirSync(dir, { recursive: true });
    await page.screenshot({ path: path.join(dir, shot), fullPage: true });
  }
  await browser.close();
  console.log(fail === 0 ? 'ALL PASS' : fail + ' FAILED');
  process.exit(fail === 0 ? 0 : 1);
})();
