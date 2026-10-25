# @my-games/zuma-core

> 祖玛引擎核心，纯 TypeScript、无框架依赖、零 DOM。当前已落地**轨道曲线**与**彩球链**两块，
> 状态机 / 弹道 / 关卡 / 渲染器随后续提交补入。

```bash
pnpm add @my-games/zuma-core
```

```ts
import { createChain, insertMarble, poseAt, sampleTrack } from '@my-games/zuma-core';

// 关卡控制点 → 弧长参数化轨道
const track = sampleTrack([
  { x: 480, y: 40 },
  { x: 240, y: 240 },
  { x: 480, y: 440 }
]);
// 彩球链：marbles 按 dist 降序，[0] 是头球（最接近洞口）
const chain = createChain(['red', 'green', 'blue'], { spacing: 24 });
// 插入命中球：新球不会嵌进已有球，后段整体让位
const next = insertMarble(chain, { dist: 30, color: 'yellow', id: 99, minDist: 0 });
// 弧长 → 世界坐标与切线角，渲染与命中都用它
const pose = poseAt(track, next.marbles[0]!.dist); // { x, y, angle }
```

产出 ESM / CJS / UMD / IIFE 四格式；IIFE/UMD 全局名 `ZumaCore`。样式：`@my-games/zuma-core/style.css`。

完整说明见仓库根 README：<https://github.com/my-gam/zuma#readme>

## License

MIT.
