import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: here,
  publicDir: join(here, '..', 'public'),
  plugins: [react()],
  server: {
    port: 5799,
    proxy: {
      '/api': 'http://localhost:7787',
      '/renders': 'http://localhost:7787',
    },
  },
  build: {outDir: join(here, 'dist')},
});
