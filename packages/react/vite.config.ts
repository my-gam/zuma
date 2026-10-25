import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import dts from 'vite-plugin-dts';
import { defineConfig } from 'vite';

/**
 * React 包走 vite lib build（与 core/vue 一致）：
 * - plugin-react 提供 JSX runtime + Fast Refresh（dev 场景用；lib 模式只跑 transform）
 * - vite-plugin-dts 产 dist/index.d.ts
 * - react/react-dom/core 走 external，不打进组件包
 *
 * Vite 8 的 ESM config 无 __dirname，用 fileURLToPath 兜底。
 */
const entryFile = fileURLToPath(new URL('./src/index.ts', import.meta.url));

export default defineConfig({
  plugins: [
    react(),
    dts({
      include: ['src/**/*.ts', 'src/**/*.tsx'],
      outDir: 'dist',
      insertTypesEntry: true,
      rollupTypes: true
    })
  ],
  build: {
    lib: {
      entry: entryFile,
      formats: ['es'],
      fileName: 'index'
    },
    rollupOptions: {
      external: ['react', 'react-dom', 'react/jsx-runtime', '@my-games/zuma-core']
    },
    sourcemap: true,
    emptyOutDir: true,
    target: 'es2020',
    minify: false
  }
});
