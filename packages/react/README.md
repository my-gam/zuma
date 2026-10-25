# @my-games/zuma-react

> 祖玛的 React 18/19 组件适配器。**当前为 `0.0.0` 占位版本**，`GameZuma` 仅渲染占位文案。

```bash
pnpm add @my-games/zuma-react react react-dom
```

```tsx
import { GameZuma } from '@my-games/zuma-react';
import '@my-games/zuma-react/style.css';

export function Demo() {
  return <GameZuma title="Zuma" />;
}
```

**样式需显式引入**：vite lib build 把内部 CSS import 抽到 `dist/index.css`。
真实游戏组件（Canvas 舞台 + 触控瞄准）、`forwardRef` 句柄与 `useGame()` hook 随引擎后续提交补入。

完整说明见仓库根 README：<https://github.com/my-gam/zuma#readme>

## License

MIT.
