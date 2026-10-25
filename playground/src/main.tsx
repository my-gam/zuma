import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// 组件样式（core 的 .game-zuma-* 已被打进 react 包的 dist/index.css）。
import '@my-games/zuma-react/style.css';
// ⚠ 外壳样式必须在这里显式引入：playground 的 `pg-*` 规则全在这个文件里，
// 漏掉的话构建照样成功、页面照样渲染，只是样式静默全丢（sudoku 落地时踩过一次）。
import './playground.css';
import { App } from './App';

const el = document.getElementById('app');
if (!el) throw new Error('#app not found');
createRoot(el).render(
  <StrictMode>
    <App />
  </StrictMode>
);
