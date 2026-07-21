import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: { 
    alias: { 
      '@': resolve(__dirname, './src'),
      '@dental/shared': resolve(__dirname, '../../packages/shared/dist'),
    } 
  },
  server: { port: 5173, proxy: { '/api': 'http://localhost:3001' } },
  build: {
    outDir: 'dist-web',
    rollupOptions: {
      output: {
        assetFileNames: 'assets/[name]-[hash][extname]',
        chunkFileNames: 'assets/[name]-[hash].js',
        entryFileNames: 'assets/[name]-[hash].js',
        manualChunks: {
          echarts: ['echarts', 'echarts-for-react'],
          lucide: ['lucide-react'],
          dateFns: ['date-fns'],
          reactQuery: ['@tanstack/react-query'],
          axios: ['axios'],
          router: ['react-router-dom'],
        },
      },
    },
  },
  base: './',
});
