import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

// 诊断工具：对一对截图做 x/y 带差异分布统计，定位变化集中区域。
// 用法：UI_DIFF_PAIR=<name> [UI_DIFF_BANDS=20] node scripts/ui-band-analysis.mjs

const root = process.env.UI_BASELINE_DIR
  ? path.resolve(process.env.UI_BASELINE_DIR)
  : path.resolve(import.meta.dirname, '..', 'test-results', 'ui-baseline');
const name = process.env.UI_DIFF_PAIR ?? 'appointments-light.png';
const bandCount = Number(process.env.UI_DIFF_BANDS ?? 20);

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
const page = await context.newPage();
const beforeB64 = fs.readFileSync(path.join(root, 'before', name)).toString('base64');
const afterB64 = fs.readFileSync(path.join(root, 'after', name)).toString('base64');

const result = await page.evaluate(async ({ beforeB64, afterB64, bandCount }) => {
  const load = (b64) => new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('load failed'));
    img.src = `data:image/png;base64,${b64}`;
  });
  const [a, b] = await Promise.all([load(beforeB64), load(afterB64)]);
  const w = Math.min(a.width, b.width);
  const h = Math.min(a.height, b.height);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(a, 0, 0);
  const da = ctx.getImageData(0, 0, w, h).data;
  ctx.drawImage(b, 0, 0);
  const db = ctx.getImageData(0, 0, w, h).data;
  const cols = new Array(bandCount).fill(0);
  const rows = new Array(bandCount).fill(0);
  for (let y = 0; y < h; y += 2) {
    for (let x = 0; x < w; x += 2) {
      const i = (y * w + x) * 4;
      const strong = Math.abs(da[i] - db[i]) > 48 || Math.abs(da[i + 1] - db[i + 1]) > 48 || Math.abs(da[i + 2] - db[i + 2]) > 48;
      if (strong) {
        cols[Math.min(bandCount - 1, Math.floor((x / w) * bandCount))] += 1;
        rows[Math.min(bandCount - 1, Math.floor((y / h) * bandCount))] += 1;
      }
    }
  }
  // 平移分析：after 图按 dx/dy 平移后与 before 比较，若某偏移下差异骤降则为整体平移
  const shifts = [];
  for (let dy = -3; dy <= 3; dy += 1) {
    for (let dx = -3; dx <= 3; dx += 1) {
      let strong = 0;
      let total = 0;
      for (let y = 0; y < h; y += 2) {
        for (let x = 0; x < w; x += 2) {
          const sx = x + dx;
          const sy = y + dy;
          if (sx < 0 || sx >= w || sy < 0 || sy >= h) continue;
          const i = (y * w + x) * 4;
          const j = (sy * w + sx) * 4;
          total += 1;
          if (Math.abs(da[i] - db[j]) > 48 || Math.abs(da[i + 1] - db[j + 1]) > 48 || Math.abs(da[i + 2] - db[j + 2]) > 48) strong += 1;
        }
      }
      shifts.push({ dx, dy, ratio: total > 0 ? strong / total : 0 });
    }
  }
  shifts.sort((a, b) => a.ratio - b.ratio);
  return { size: [w, h], cols, rows, colLabels: cols.map((_, i) => Math.round((i / bandCount) * w) + '-' + Math.round(((i + 1) / bandCount) * w)), rowLabels: rows.map((_, i) => Math.round((i / bandCount) * h) + '-' + Math.round(((i + 1) / bandCount) * h)), bestShifts: shifts.slice(0, 5) };
}, { beforeB64, afterB64, bandCount });

console.log(`pair=${name} size=${result.size.join('x')}`);
console.log('best shifts (dx,dy,strongRatio):');
result.bestShifts.forEach((s) => console.log(`  dx=${s.dx} dy=${s.dy} | ${(s.ratio * 100).toFixed(3)}%`));
console.log('x-band strong counts:');
result.cols.forEach((c, i) => console.log(`  ${String(result.colLabels[i]).padStart(12)} | ${c}`));
console.log('y-band strong counts:');
result.rows.forEach((c, i) => console.log(`  ${String(result.rowLabels[i]).padStart(12)} | ${c}`));
await context.close();
await browser.close();
