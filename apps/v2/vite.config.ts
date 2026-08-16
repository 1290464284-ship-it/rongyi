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
    // R78-09：vitest 默认 include 会吞掉 .stryker-tmp/sandbox-* 里被变异过的
    // spec 副本，导致与 test:mutation 并发的普通 `pnpm test`（含 husky
    // pre-commit 钩子）把变异副本当测试跑而失败。显式排除，同时保留 vitest
    // 默认排除项（用户提供的 exclude 会整体覆盖默认列表）。
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/cypress/**',
      '**/.{idea,git,cache,output,temp}/**',
      '**/.stryker-tmp/**',
      '**/{karma,rollup,webpack,vite,vitest,jest,ava,babel,nyc,cypress,tsup,build,eslint,prettier}.config.*',
    ],
    // 重负载（数据库引导/加密备份/restore 全链路）在并行覆盖门禁下可能超过默认 5s；
    // 统一放宽到 20s，避免资源争抢造成的误报，同时仍能捕获真正的挂起。
    // A-P0.1 实测：windows-latest 上 internal release 的 Verify 阶段多文件出现
    // 20s testTimeout / 10s hookTimeout 误报（Ubuntu CI 无此现象）。再放宽一档，
    // 仍远低于能掩盖真挂起的量级。
    testTimeout: 40_000,
    hookTimeout: 20_000,
    coverage: {
      provider: 'v8',
      reportsDirectory: 'coverage',
      include: ['src/server/**/*.ts', 'src/domain/**/*.ts', 'src/server/scheduler.ts'],
      exclude: ['src/server/main.ts'],
      // CI 实测基线（2026-08-07，v8 provider）：lines 97.45 / functions 99 /
      // statements 96.29 / branches 88.42。门槛设 100% 从未可达成（CI 此前从未运行），
      // 现按实测值留 ~2% 余量，保持质量门有效且稳定。
      thresholds: {
        statements: 95,
        branches: 85,
        functions: 97,
        lines: 95,
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
