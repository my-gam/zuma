# @my-games/zuma-vue

> 祖玛的 Vue 3 组件适配器。**当前是占位组件**（Canvas 舞台 + 触控瞄准随引擎后续功能块补入）。

```bash
pnpm add @my-games/zuma-vue vue
```

```vue
<script setup lang="ts">
import { GameZuma } from '@my-games/zuma-vue';
import '@my-games/zuma-vue/style.css';
</script>

<template>
  <GameZuma title="Zuma" />
</template>
```

**样式需显式引入**：vite lib build 把内部 CSS import 抽到 `dist/index.css`。
真实游戏组件（Canvas 舞台 + 触控瞄准）与 `useGame()` composable 随引擎后续提交补入。

完整说明见仓库根 README：<https://github.com/my-gam/zuma#readme>

## License

MIT.
