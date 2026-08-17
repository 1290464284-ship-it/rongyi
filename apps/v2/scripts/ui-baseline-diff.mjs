import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

// UI 基线截图像素级对比（R14 护栏）：逐对计算 before/after 差异率与差异包围盒，
// 生成红色高亮 diff 图供人工复核。
// 用法：node scripts/ui-baseline-diff.mjs
//   环境变量 UI_BASELINE_DIR（默认 apps/v2/test-results/ui-baseline）

const root = process.env.UI_BASELINE_DIR
  ? path.resolve(process.env.UI_BASELINE_DIR)
  : path.resolve(import.meta.dirname, '..', 'test-results', 'ui-baseline');
const beforeDir = path.join(root, 'before');
const afterDir = path.join(root, 'after');
const diffDir = path.join(root, 'diff');
fs.mkdirSync(diffDir, { recursive: true });

const THRESHOLD = 16; // 单通道差值阈值（0-255），低于视为抗锯齿噪声

const beforeFiles = fs.readdirSync(beforeDir).filter((name) => name.endsWith('.png')).sort();
const afterFiles = new Set(fs.readdirSync(afterDir).filter((name) => name.endsWith('.png')));
const pairFilter = process.env.UI_DIFF_PAIR ?? null;
const pairs = beforeFiles.filter((name) => afterFiles.has(name) && (!pairFilter || name === pairFilter));

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
const page = await context.newPage();

const results = [];
for (const name of pairs) {
  const beforePath = path.join(beforeDir, name);
  const afterPath = path.join(afterDir, name);
  const beforeB64 = fs.readFileSync(beforePath).toString('base64');
  const afterB64 = fs.readFileSync(afterPath).toString('base64');
  const entry = await page.evaluate(
    async ({ beforeB64, afterB64, threshold }) => {
      function loadImage(dataUrl) {
        return new Promise((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve(img);
          img.onerror = () => reject(new Error('image load failed'));
          img.src = dataUrl;
        });
      }
      const [beforeImg, afterImg] = await Promise.all([
        loadImage(`data:image/png;base64,${beforeB64}`),
        loadImage(`data:image/png;base64,${afterB64}`),
      ]);
      const width = Math.min(beforeImg.width, afterImg.width);
      const height = Math.min(beforeImg.height, afterImg.height);
      const canvas = document.createElement('canvas');
      canvas.width = beforeImg.width;
      canvas.height = beforeImg.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(beforeImg, 0, 0);
      const beforeData = ctx.getImageData(0, 0, beforeImg.width, beforeImg.height).data;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(afterImg, 0, 0);
      const afterData = ctx.getImageData(0, 0, afterImg.width, afterImg.height).data;

      let changed = 0;
      let strongChanged = 0;
      let total = 0;
      let minX = width;
      let minY = height;
      let maxX = 0;
      let maxY = 0;
      let strongMinX = width;
      let strongMinY = height;
      let strongMaxX = 0;
      let strongMaxY = 0;
      const stride = 4;
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          const i = (y * beforeImg.width + x) * stride;
          const j = (y * afterImg.width + x) * stride;
          total += 1;
          const dr = Math.abs(beforeData[i] - afterData[j]);
          const dg = Math.abs(beforeData[i + 1] - afterData[j + 1]);
          const db = Math.abs(beforeData[i + 2] - afterData[j + 2]);
          if (dr > threshold || dg > threshold || db > threshold) {
            changed += 1;
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
            // 在 after 图上高亮差异（红）
            afterData[j] = 255;
            afterData[j + 1] = Math.max(0, afterData[j + 1] - 120);
            afterData[j + 2] = Math.max(0, afterData[j + 2] - 120);
          }
          // 强差异（>48）：过滤亚像素抗锯齿噪声，标记真实可见改动
          if (dr > 48 || dg > 48 || db > 48) {
            strongChanged += 1;
            if (x < strongMinX) strongMinX = x;
            if (x > strongMaxX) strongMaxX = x;
            if (y < strongMinY) strongMinY = y;
            if (y > strongMaxY) strongMaxY = y;
          }
        }
      }
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.putImageData(new ImageData(afterData, afterImg.width, afterImg.height), 0, 0);
      return {
        width,
        height,
        beforeSize: [beforeImg.width, beforeImg.height],
        afterSize: [afterImg.width, afterImg.height],
        changed,
        strongChanged,
        total,
        bbox: changed > 0 ? { minX, minY, maxX, maxY } : null,
        strongBbox: strongChanged > 0 ? { minX: strongMinX, minY: strongMinY, maxX: strongMaxX, maxY: strongMaxY } : null,
        dataUrl: canvas.toDataURL('image/png'),
      };
    },
    { beforeB64, afterB64, threshold: THRESHOLD },
  );
  const ratio = entry.total > 0 ? entry.changed / entry.total : 0;
  const strongRatio = entry.total > 0 ? entry.strongChanged / entry.total : 0;
  results.push({ name, ratio, strongRatio, changed: entry.changed, strongChanged: entry.strongChanged, sizeMatch: entry.beforeSize.join('x') === entry.afterSize.join('x'), beforeSize: entry.beforeSize.join('x'), afterSize: entry.afterSize.join('x'), bbox: entry.bbox, strongBbox: entry.strongBbox });
  const diffPath = path.join(diffDir, name);
  const base64 = entry.dataUrl.split(',')[1];
  fs.writeFileSync(diffPath, Buffer.from(base64, 'base64'));
  console.log(`${name} | weak ${(ratio * 100).toFixed(2)}% | strong ${(strongRatio * 100).toFixed(3)}% | size ${entry.beforeSize.join('x')} -> ${entry.afterSize.join('x')} | strongBbox ${entry.strongBbox ? JSON.stringify(entry.strongBbox) : 'none'}`);
}

fs.writeFileSync(path.join(diffDir, 'summary.json'), JSON.stringify({ pairs: results }, null, 2));
console.log(`\ndiff done: ${results.length} pairs, diff images + summary.json in ${diffDir}`);

await context.close();
await browser.close();
