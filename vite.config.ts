import { defineConfig } from 'vite';

export default defineConfig({
  root: 'src/renderer',
  build: { outDir: '../../dist/renderer', emptyOutDir: true }
});