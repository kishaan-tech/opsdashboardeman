import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';

// Emit to repo-root /dist so Vercel (Root Directory = ".") finds it as "dist".
const rootDist = fileURLToPath(new URL('../dist', import.meta.url));

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // .env lives at the repo root, one level up
  envDir: fileURLToPath(new URL('..', import.meta.url)),
  build: {
    outDir: rootDist,
    emptyOutDir: true,
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:8787',
        changeOrigin: true,
      },
      '/webhooks': {
        target: 'http://localhost:8787',
        changeOrigin: true,
      },
    },
  },
});
