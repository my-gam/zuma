# 贡献指南 · Contributing

感谢关注 zuma。仓库当前处于 **`0.0.0` 空骨架** 阶段：三层结构 + CI/发布链路已就位，
游戏引擎待补。

**快捷入口**

- npm：`@my-games/zuma-core` · `@my-games/zuma-vue` · `@my-games/zuma-react`
- 安全漏洞：见 [SECURITY.md](./SECURITY.md)

## 项目结构 · Layout

```
zuma/
├── packages/
│   ├── core/     @my-games/zuma-core   纯 TS 引擎（ESM/CJS/UMD/IIFE 四格式）
│   ├── vue/      @my-games/zuma-vue    Vue 3 SFC + composable
│   └── react/    @my-games/zuma-react  React 18/19 组件 + hook
├── playground/   Vite SPA（Vanilla / Vue / React 三 tab，引擎落地后补全）
├── tools/        CI 侧脚本（pages.mjs、verify-dist.mjs）
└── .github/      Actions workflow + issue/PR 模板
```

`core` 是唯一事实来源；`vue` / `react` 只订阅引擎状态 + 桥接输入输出。想上新玩法，先改
`core`，再让两个适配器的 typecheck/build 都过。

## 门禁 · Gates before submitting

任何 PR 都必须本地跑通（顺序 build → typecheck → test）：

```bash
pnpm build        # 三包 vite lib；core 拓扑序先建，供 vue/react 解析 dist/index.d.ts
pnpm verify:dist  # 断言 11 个必需产物存在且非 0 字节（防 --filter 空跑假绿）
pnpm typecheck    # core / vue / react 各自 tsc --noEmit
pnpm test         # core vitest
```

> ⚠ Windows 下 `pnpm` 跑 package.json 脚本不剥单引号，`--filter` 必须用转义双引号
> `\"./packages/**\"`（见根 `package.json`），否则匹配 0 项目且退出码仍为 0，门禁变假绿灯。

## 提交风格 · Commits

- **每个 commit 必须 GPG-signed**（本仓库依赖全局 `commit.gpgsign=true`）。
- 走 [Conventional Commits](https://www.conventionalcommits.org/zh-hans/)：`type(scope): 中文描述`，
  `type` ∈ feat/fix/chore/refactor/docs/perf/test，`scope` 用包名（core/vue/react/playground/ci/release）。
- 提交后**不自行 push、不自行打 tag**，等维护者指示。

## 版本与发布 · Versioning & release

三包版本 **lockstep**。npm 可信发布者无法发某个包的第一个版本，故：

1. **首版手工 seed**：三包 `version = 0.0.0`（**勿用 `0.0.0-stage`** —— 它是 npm Staged
   Publishing 保留的哨兵版本，`npm publish` 用它会被 403 拒），`pnpm build && pnpm verify:dist`
   后用 npm 凭据 `npm publish --access public --tag stage`（**必须 `--tag stage`** 作 dist-tag，
   否则 `0.0.0` 会被设成 `latest`）。见根 README「首次占位发布」。
2. 在 npmjs 为三包登记 Trusted Publisher → `my-gam/zuma` + `publish.yml` + environment `npm`。
3. 之后正式版本：bump 三包 `version` 到同一 semver → 跑四道门禁 → `chore(release): vX.Y.Z` 签名提交
   → 在该提交上 `git tag -s vX.Y.Z` → **由维护者明确指示后** push tag 触发 `publish.yml` 全自动发。

**红线：tag 一旦 push 就真的发包。** 绝不自行打/推 tag。
