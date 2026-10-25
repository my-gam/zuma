import { GameZuma } from '@my-games/zuma-react';

/**
 * 0.0.0 空骨架 playground：先渲染 React 占位组件，确认三包产物能被 playground
 * 解析（前提是已 `pnpm build`，见根 README）。真实三 tab（Vanilla / Vue / React）演示、
 * 关卡切换、HUD 与事件日志随引擎补入。
 */
export function App() {
  return (
    <div style={{ padding: 24, fontFamily: 'system-ui, sans-serif' }}>
      <h1>zuma · Playground</h1>
      <p>
        <code>0.0.0</code> 空骨架占位。真实祖玛引擎与 Vanilla / Vue / React 三 tab
        演示将在占位包发布后作为后续提交补入。
      </p>
      <GameZuma title="Zuma" />
    </div>
  );
}
