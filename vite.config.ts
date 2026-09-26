import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import postCssScss from 'postcss-scss';
import postcssRTLCSS from 'postcss-rtlcss';

export default defineConfig({
  root: 'src',
  publicDir: '../public',
  plugins: [vue()],
  define: {
    FRONTEND_VERSION: JSON.stringify(process.env.npm_package_version || '0.1.0'),
    'process.env': {},
  },
  css: {
    postcss: {
      parser: postCssScss,
      map: false,
      plugins: [postcssRTLCSS],
    },
    preprocessorOptions: {
      scss: {
        loadPaths: [process.cwd()],
        quietDeps: true,
      },
    },
  },
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    commonjsOptions: {
      include: [/.js$/],
    },
  },
});
