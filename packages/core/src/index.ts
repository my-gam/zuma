/**
 * @my-games/zuma-core —— `0.0.0` 占位实现。
 *
 * 这是一个「空包」骨架：目的仅是把 monorepo 的
 * `build → verify:dist → typecheck → test` 门禁与 npm Trusted Publisher 链路跑通，
 * 好让首版（可信发布者无法发某包的第一个版本）能先手工种进 registry。
 *
 * 真实祖玛引擎 —— 轨道曲线（弧长参数化样条）、彩球链推进与同色消合、发射器瞄准/弹道/
 * 插入判定、关卡生成、连锁计分 —— 以及一个只依赖 `CanvasRenderingContext2D` 的无框架
 * 渲染器，已在占位包发布前按同一三层结构写好并暂存，待 `0.0.0` 上线后作为后续提交补回。
 */

/** 包标识占位。 */
export const ZUMA_PACKAGE = 'zuma-core' as const;

/** 占位版本，与 package.json 的 version 对齐，便于确认发的是 stage 包。 */
export const ZUMA_STAGE = '0.0.0' as const;
