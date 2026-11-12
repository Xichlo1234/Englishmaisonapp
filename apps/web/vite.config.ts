import path from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
  server: {
    port: 5173,
    // API chạy bằng `wrangler dev` (cổng 8787); cùng origin qua proxy để cookie SameSite=Strict hoạt động.
    proxy: { '/api': { target: 'http://localhost:8787', changeOrigin: false } },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 1200,
  },
});
