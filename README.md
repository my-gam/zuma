# zuma（引擎逐块落地中）

> 三层结构 + CI/发布链路已就位，`core` 引擎**正在按功能块逐笔落地**。
> `0.0.0` 是为配置 npm **Trusted Publisher** 而手工种下的占位空包（可信发布者无法发布
> 某个包的第一个版本）；`0.0.1` 起是真实代码。当前**还没有可玩性**：状态机、弹道命中、
> 渲染器与适配层尚未接入，`-vue` / `-react` 的 `GameZuma` 仍是占位组件。

## 这个仓库现在有什么

- **pnpm workspace**：`packages/core` + `packages/vue` + `packages/react`，外加 `playground/`。
- **`@my-games/zuma-core`**：框架无关引擎，`vite build --mode lib` 一次出
  ESM / CJS / UMD / IIFE 四格式 + `.d.ts`。已导出：轨道曲线（向心 Catmull-Rom 采样 +
  弧长参数化查询 `sampleTrack` / `poseAt`）、彩球链（不可变 `createChain` / `advanceChain` /
  `insertMarble` / `closeGaps`）、调色板（`MARBLE_COLORS` / `paletteFor` / `isMarbleColor`）。
  均为纯函数、零依赖、零 DOM。
- **待补**：同色消合与连锁、弹道与命中、关卡与计分、`Zuma` 状态机、存档、
  只依赖 `CanvasRenderingContext2D` 的无框架渲染器，以及两个适配层与 playground 演示。
- **`@my-games/zuma-vue` / `-react`**：组件适配器，各出一个 `GameZuma`（当前仅渲染占位文案）
  并抽出 `dist/index.css`。
- **CI**：`.github/workflows/publish.yml`（推 `v*` tag → 门禁 → OIDC 发布；`workflow_dispatch`
  默认 `dry_run=true` 可安全彩排）与 `pages.yml`（main 推 → 构建 playground → GitHub Pages）。
  两道 workflow 都在 `pnpm build` 后插入 `tools/verify-dist.mjs` 产物守卫，防 `--filter` 空跑。

## 本地跑门禁（不发版、不起监听）

```bash
pnpm install
pnpm build        # 三包 vite lib → dist
pnpm verify:dist  # 断言 11 个必需产物存在且非 0 字节
pnpm typecheck    # core / vue / react 全量 tsc --noEmit
pnpm test         # core 冒烟测试
```

> ⚠ 本仓库测试/构建**不启动 dev server**。`pnpm dev` / `dev:play` 会绑定 `127.0.0.1:5173`
> 触发 Windows 防火墙弹窗，需先获批准再手动跑一次。

## 首次占位发布（维护者手工执行）

占位版本用 `0.0.0`。**注意：不要用 `0.0.0-stage` 作版本号** —— 那是 npm Staged Publishing
特性保留的哨兵版本（`npm stage publish` 会自动发一个 `0.0.0-stage` 占位），普通
`npm publish` / `pnpm publish` 用它会被 registry 拒绝：`403 You cannot publish using the
version: 0.0.0-stage`。想让占位版不占用 `latest`，靠的是 **dist-tag** `--tag stage`，
与版本号无关。

首版仍无法走 Trusted Publishing（可信发布者只能绑定已存在的包），必须用一次性 npm
凭据手工发。**务必带 `--tag stage`**，否则 `0.0.0` 会被设成 `latest`：

```bash
pnpm build && pnpm verify:dist
npm login            # 或 NPM_TOKEN；仅首版需要
# 一把梭（pnpm workspace，三包同一 dist-tag）：
pnpm -r --filter "./packages/**" publish --access public --tag stage --no-git-checks
# 或逐包：
pnpm --filter @my-games/zuma-core  publish --access public --tag stage --no-git-checks
pnpm --filter @my-games/zuma-vue   publish --access public --tag stage --no-git-checks
pnpm --filter @my-games/zuma-react publish --access public --tag stage --no-git-checks
```

> ⚠ **别用 `npm publish -w <包名>`**。本仓是 pnpm workspace，根 `package.json` 里没有
> `workspaces` 字段，npm 看不见这些包：`npm query '.workspace'` 返回 `[]`，
> `npm publish -w @my-games/zuma-core` 直接 `No workspaces found`。
> （上面的 filter 在命令行里用普通双引号即可；`\"…\"` 那种转义只针对 `package.json` 脚本字符串。）

发完务必核对占位版没占用 `latest`：

```bash
npm view @my-games/zuma-core@0.0.0 version   # 要带版本号，否则可能命中本机缓存
npm dist-tag ls @my-games/zuma-core          # 期望 stage → 0.0.0，且 latest 不存在
```

发完在 npmjs 上为 `@my-games` org 的三个包分别登记 Trusted Publisher：指向
`my-gam/zuma` 仓库 + 对应 workflow（`publish.yml`）+ environment `npm`。之后正式版本
（`v0.1.0` 起）由推 tag 的 CI 全自动接管，不再需要本地凭据。

## 接下来会补什么

真实祖玛引擎：轨道曲线（样条 + 弧长参数化）、彩球链推进与同色消合、发射器瞄准 / 弹道 /
插入判定、关卡生成与连锁计分、注入式存档与最佳成绩，外加一个只依赖
`CanvasRenderingContext2D` 的无框架渲染器；Vue / React 适配层负责 Canvas 舞台、
requestAnimationFrame 循环与触控瞄准；playground 三 tab 演示，以及完整 README / 单测。
移动端优先：触控拖拽瞄准、devicePixelRatio 自适应画布、`touch-action: none` 防滚动劫持。

## 红线

**不要自行打 tag / push tag** —— `publish.yml` 一旦被 `v*` tag 触发就会真发 npm 包。

## 许可

MIT · © 2026 xyj2156
