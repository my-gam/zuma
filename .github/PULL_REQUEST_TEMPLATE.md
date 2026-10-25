## 关联 issue · Related issue

Closes #
Refs #

## 变更点 · What changes

<!-- 一段话说清做了什么；如果 diff 很大或语义复杂，请列要点 -->
-
-

## 决策依据 · Why

<!-- 为什么这么做；被排除的替代做法与理由；跟版考古点（若有） -->

## 门禁证据 · Gate evidence

本地必须三 gate 全绿，把最后一段输出贴过来：

```
$ pnpm -r build && pnpm -r typecheck && pnpm -r test

```

<!-- 若改的是 UI 或输入行为，请附一张无头浏览器 DOM 截图或一段 dump-dom 摘要 -->
- [ ] UI 变更已附实跑证据

## Checklist

- [ ] Commit 已 GPG-signed（`git log --pretty='%h %G?'` 全部 `G`）
- [ ] `packages/*/package.json` 的 `version` 未动（本 PR 不是 release）
- [ ] 新增/改动的公共 API 已同步 README 与对应包的 `README.md`
- [ ] 新增依赖只在必要处（不加就更好的方案优先），已在描述里说明理由
- [ ] 若改了 `core` 的公共类型或行为，vue/react 适配器的 typecheck/build 都跑过
