import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// 占位阶段只需一份组件样式；真实 playground 会挂 Vue/React/Vanilla 三 tab。
import '@my-games/zuma-react/style.css';
import { App } from './App';

const el = document.getElementById('app');
if (!el) throw new Error('#app not found');
createRoot(el).render(
  <StrictMode>
    <App />
  </StrictMode>
);
