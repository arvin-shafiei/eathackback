import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // dev proxy so the local sim server needs no CORS headers: /api/* → http://localhost:8787/api/*
    proxy: { '/api': { target: 'http://localhost:8787', changeOrigin: true } },
  },
  build: { chunkSizeWarningLimit: 2000 },
});
