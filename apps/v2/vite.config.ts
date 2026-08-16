import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { randomBytes } from 'node:crypto';
import { DEFAULT_API_PORT, DEFAULT_WEB_DEV_PORT } from './src/shared/constants.ts';

function devCsp(): { name: string; apply: 'serve'; transformIndexHtml(html: string): string } {
  return {
    name: 'dev-csp',
    apply: 'serve',
    transformIndexHtml(html: string): string {
      // dev 下 React Refresh/HMR 需要内联脚本与样式，将构建期 nonce 占位还原为 'unsafe-inline'
      return html
        .replace("script-src 'self' 'nonce-__CSP_NONCE__';", "script-src 'self' 'unsafe-inline';")
        .replace("style-src 'self' 'nonce-__CSP_NONCE__';", "style-src 'self' 'unsafe-inline';")
        .replace('ws://localhost:__CSP_DEV_WS_PORT__', `ws://localhost:${DEFAULT_WEB_DEV_PORT}`);
    },
  };
}

// 审计 M7：nonce 迁移。构建期生成一次性随机 nonce，替换 index.html 中 meta CSP
// 与入口 script 的 __CSP_NONCE__ 占位符（order: 'post'，在 Vite 重写 script 标签后执行，
// 确保产物中 script 一定带 nonce 属性），彻底移除 'unsafe-inline'。
function cspNonce(): { name: string; apply: 'build'; transformIndexHtml: { order: 'post'; handler(html: string): string } } {
  return {
    name: 'csp-nonce',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(html: string): string {
        const nonce = randomBytes(16).toString('hex');
        return html
          .replaceAll('__CSP_NONCE__', nonce)
          .replaceAll(' ws://localhost:__CSP_DEV_WS_PORT__', '')
          .replace(/<script([^>]*?)>/g, (_match, attrs: string) =>
            attrs.includes('nonce=') ? `<script${attrs}>` : `<script${attrs} nonce="${nonce}">`,
          );
      },
    },
  };
}

export default defineConfig({
  plugins: [react(), devCsp(), cspNonce()],
  test: {
    // 重负载（数据库引导/加密备份/restore 全链路）在并行覆盖门禁下可能超过默认 5s；
    // 统一放宽到 20s，避免资源争抢造成的误报，同时仍能捕获真正的挂起。
    testTimeout: 20_000,
    coverage: {
      provider: 'v8',
      reportsDirectory: 'coverage',
      include: ['src/server/**/*.ts', 'src/domain/**/*.ts', 'src/server/scheduler.ts'],
      exclude: ['src/server/main.ts'],
      // 实测基线（2026-08-07，v8 provider）：lines 97.45 / functions 99 /
      // statements 96.29 / branches 88.42。2026-08 UI 翻新 + 测试补齐后实测
      // 四项均已达 100%（含登记过的 v8-ignore 排除），门槛收紧到实测 −2~5%，
      // 掉几个百分点即红，保持质量门对回归的有效拦截。
      thresholds: {
        statements: 98,
        branches: 95,
        functions: 98,
        lines: 98,
      },
    },
  },
  root: '.',
  base: './',
  build: {
    outDir: 'dist-web',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        // Vite 8（Rolldown 内核）移除了 manualChunks 对象形式，改用 advancedChunks.groups
        // advancedChunks is deprecated in Vite 8; rely on default splitting.
      },
    },
  },
  server: {
    port: Number(process.env.V2_WEB_DEV_PORT) || DEFAULT_WEB_DEV_PORT,
    proxy: {
      // P1-7/P1-8：后端端口不再硬编码，跟随 V2_PORT 环境变量（默认 DEFAULT_API_PORT）
      '/api': `http://127.0.0.1:${process.env.V2_PORT ?? DEFAULT_API_PORT}`,
    },
  },
});
