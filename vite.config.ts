import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  root: 'src/client',
  plugins: [vue()],
  build: {
    outDir: '../../dist',
    emptyOutDir: true,
  },
});
