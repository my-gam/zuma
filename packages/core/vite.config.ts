import { fileURLToPath } from 'node:url';
import dts from 'vite-plugin-dts';
import { defineConfig } from 'vite';

/**
 * core 包 vite lib build —— 四种格式一起出：
 *
 * | 格式  | 产物                | 场景                                            |
 * | ----- | ------------------- | ----------------------------------------------- |
 * | es    | `index.js`          | 现代 bundler / Node ESM 消费者（默认走这条）    |
 * | cjs   | `index.cjs`         | CommonJS Node / 旧 webpack                      |
 * | umd   | `index.umd.js`      | AMD / CommonJS / 全局三兼容；require.js 场景    |
 * | iife  | `index.iife.js`     | 浏览器 `<script>` 直接引入，全局 `ZumaCore`   |
 *
 * IIFE / UMD 都需要一个 `name`（全局变量），Vite lib build 强制要求。
 * `ZumaCore` 上会挂：`Zuma` / `solve` / `countSolutions` / `generatePuzzle` /
 * 纯函数原语 / 存储工具 —— 与 ESM 侧完全一致。
 *
 * 类型：vite-plugin-dts 从 .ts 源码提取并 rollup 成 dist/index.d.ts，
 * 只服务 ESM/CJS 消费者；IIFE/UMD 用户没有类型层面（本来也是无编译器的 script 场景）。
 *
 * Vite 8 config loader 在 ESM 上下文里没有 `__dirname`，用 fileURLToPath。
 */
const entryFile = fileURLToPath(new URL('./src/index.ts', import.meta.url));

export default defineConfig({
  plugins: [
    dts({
      include: ['src/**/*.ts'],
      outDir: 'dist',
      insertTypesEntry: true,
      rollupTypes: true
    })
  ],
  build: {
    lib: {
      entry: entryFile,
      name: 'ZumaCore',
      formats: ['es', 'cjs', 'umd', 'iife'],
      fileName: (format) => {
        switch (format) {
          case 'es': return 'index.js';
          case 'cjs': return 'index.cjs';
          case 'umd': return 'index.umd.js';
          case 'iife': return 'index.iife.js';
          default: return `index.${format}.js`;
        }
      }
    },
    sourcemap: true,
    emptyOutDir: true,
    target: 'es2020',
    minify: false
  }
});
