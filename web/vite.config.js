import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // .env lives at the repo root, one level up
  envDir: fileURLToPath(new URL('..', import.meta.url)),
});
