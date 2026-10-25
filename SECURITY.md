# 安全策略 · Security Policy

## 报告漏洞 · Reporting a Vulnerability

**请不要在公开 issue 里贴可利用的安全漏洞细节。**

通过 GitHub Security Advisories 私密追踪：

1. 打开 <https://github.com/my-gam/zuma/security/advisories/new>
2. 标题一句话说明漏洞类型
3. 描述里给出：受影响版本、复现步骤、可能的影响面、建议的修复方向（可选）
4. 提交后 maintainers 会尽快回应

不方便用 GitHub 时，可发信到 npm 主页上 `xyj2156` 用户绑定的邮箱（主题前缀 `[zuma-sec]`）。

## 支持版本 · Supported Versions

| Version | 支持 |
| ------- | ---- |
| `0.0.x` | ⚠️ `0.0.0` 占位版，不做安全承诺 |
| `>= 0.1` | 正式发布线（引擎落地后启用） |

## 已知的信任边界 · Trust boundaries

zuma 是纯前端 / 无网络的休闲游戏。设计上：

- **`storage` 由宿主提供**：localStorage 存档内容经类型守卫反序列化，不合法即丢弃开新局。
- **`rng` / `clock` 可注入**：默认 `Math.random` / `Date.now`；本库不作密码学用途。
- **无网络请求**：库本身不发任何 HTTP / WebSocket。
- **渲染只写 Canvas 位图**：`renderer` 仅调用 `CanvasRenderingContext2D` 画几何与渐变，
  不注入 HTML、不 `innerHTML`、不 `eval`；关卡数据是纯数字与枚举，不构成 XSS 面。
- **IIFE / UMD 全局**：script 引入时挂 `window.ZumaCore`；宿主如允许第三方脚本覆盖
  `globalThis`，请自行做 SRI / CSP。

## 政策 · Policy

- 修复窗口：严重 / 高危 ≤ 7 天，中 ≤ 14 天，低 ≤ 30 天
- 会发布带 CVE 的 GHSA，并同步 `npm deprecate` 受影响版本

Thanks for helping keep zuma and its users safe.
