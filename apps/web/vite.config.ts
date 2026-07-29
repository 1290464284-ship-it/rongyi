/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { visualizer } from 'rollup-plugin-visualizer';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_API_PORT, DEFAULT_WEB_PORT } from './src/config/constants';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [
    react(),
    // bundle 分析器：构建后生成 dist/stats.html，手动查看
    visualizer({
      filename: 'dist/stats.html',
      gzipSize: true,
      brotliSize: true,
      open: false,
    }),
  ],
  // 6.4: 生产环境自动剔除 console.log 和 debugger
  esbuild: {
    drop: process.env.NODE_ENV === 'production' ? ['console', 'debugger'] : [],
  },
  resolve: {
    alias: { 
      '@': resolve(__dirname, './src'),
      '@dental/shared': resolve(__dirname, '../../packages/shared/src'),
    } 
  },
  server: { port: DEFAULT_WEB_PORT, proxy: { '/api': `http://localhost:${DEFAULT_API_PORT}` } },
  build: {
    outDir: 'dist-web',
    rollupOptions: {
      output: {
        assetFileNames: 'assets/[name]-[hash][extname]',
        chunkFileNames: 'assets/[name]-[hash].js',
        entryFileNames: 'assets/[name]-[hash].js',
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('echarts')) return 'echarts';
            if (id.includes('lucide-react')) return 'lucide';
            if (id.includes('date-fns')) return 'dateFns';
            if (id.includes('@tanstack/react-query')) return 'reactQuery';
            if (id.includes('axios')) return 'axios';
            if (id.includes('react-router-dom')) return 'router';
          }
        },
      },
    },
  },
  base: './',
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/__tests__/setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    css: false,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'text-summary'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.{test,spec}.{ts,tsx}', 'src/__tests__/**', 'src/main.tsx'],
      // 棘轮阈值：全量 src 口径 2026-07 实测（32.22/19.83/23.37/33.24）设置下限，只升不降
      thresholds: {
        statements: 31,
        branches: 19,
        functions: 22,
        lines: 32,
      },
    },
  },
});
