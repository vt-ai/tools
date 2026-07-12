import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  base: '/', // custom domain served at root
  build: {
    chunkSizeWarningLimit: 1600,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        pdf: resolve(__dirname, 'pdf-tools.html'),
        md: resolve(__dirname, 'md-tools.html'),
      },
    },
  },
  worker: {
    format: 'es',
  },
});
