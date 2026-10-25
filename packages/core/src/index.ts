/**
 * @my-games/zuma-core —— 引擎 barrel。
 *
 * 骨架阶段（`0.0.0`）只为把 monorepo 的 `build → verify:dist → typecheck → test`
 * 门禁与 npm Trusted Publisher 链路跑通，故留着 `ZUMA_PACKAGE` / `ZUMA_STAGE` 两个占位
 * 常量；引擎本体按功能块逐笔补入，正式版发布前（bump 到 `0.0.1` 时）再移除占位常量。
 *
 * 已落地：轨道曲线（向心 Catmull-Rom 采样 + 弧长参数化查询）。
 * 待补：彩球链与同色消合、发射器弹道与插入判定、关卡与计分、状态机、存档、
 * 以及只依赖 `CanvasRenderingContext2D` 的无框架渲染器。
 *
 * 分层纪律：core 不依赖 Vue / React，不查 DOM、不发网络请求、不自建定时器；
 * `renderer` 只接受一个已经拿到的 2D context。
 */

export {
  DEFAULT_SAMPLES_PER_SEGMENT,
  clampTrackDist,
  poseAt,
  sampleTrack
} from './track';
export type { Track, TrackOptions, TrackPose, Vec2 } from './track';

/** 包标识占位。 */
export const ZUMA_PACKAGE = 'zuma-core' as const;

/** 占位版本，与 package.json 的 version 对齐，便于确认发的是 stage 包。 */
export const ZUMA_STAGE = '0.0.0' as const;
