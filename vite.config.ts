import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        game: resolve(import.meta.dirname, 'index.html'),
        assets: resolve(import.meta.dirname, 'assets.html'),
      },
    },
  },
});
