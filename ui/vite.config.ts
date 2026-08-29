import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The war-room page proxies TrueForge same-origin so the embedded UI SDK
// needs no CORS: /api/* → the local TrueForge server.
export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 7500,
    proxy: {
      '/api': {
        target: process.env.TRUEFORGE_BASE_URL ?? 'http://localhost:8790',
        changeOrigin: true,
      },
    },
  },
});
