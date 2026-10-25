/**
 * @my-games/zuma-core —— 引擎 barrel。
 *
 * 骨架阶段（`0.0.0`）只为把 monorepo 的 `build → verify:dist → typecheck → test`
 * 门禁与 npm Trusted Publisher 链路跑通，导出过两个占位常量；引擎本体从 `0.0.1`
 * 起按功能块逐笔替换它们（沿用 sudoku 的同名约定：占位常量随引擎落地退役）。
 *
 * 分层纪律：core 不依赖 Vue / React，不查 DOM、不发网络请求、不自建定时器；
 * `renderer`（待补）只接受一个已经拿到的 2D context。
 */

export {
  MARBLE_COLORS,
  MARBLE_PALETTE,
  MAX_MARBLE_COLORS,
  isMarbleColor,
  paletteFor
} from './types';
export type { MarbleColor } from './types';

export {
  advanceChain,
  closeGaps,
  createChain,
  findInsertIndex,
  gapAfter,
  hasGaps,
  headOf,
  insertMarble,
  isEmptyChain,
  marblesInWindow,
  tailOf
} from './chain';
export type { Chain, CreateChainOptions, InsertOptions, Marble, MarbleId } from './chain';

export { collapseChain, findRuns, hasRun, removeRuns } from './match';
export type { CollapseEvent, CollapseResult, MatchRun } from './match';

export {
  ACCURACY_BONUS_MAX,
  BASE_POINTS_PER_MARBLE,
  CLEAR_PENALTY_PER_MARBLE,
  COMBO_MULTIPLIER_STEP,
  EXTRA_RUN_BONUS_PER_MARBLE,
  FAR_SHOT_BONUS_PER_STEP,
  FAR_SHOT_DISTANCE_STEP,
  MIN_MATCH_RUN,
  PERFECT_CLEAR_BONUS,
  clearBonus,
  comboMultiplier,
  farShotPoints,
  matchPoints,
  scoreMatch
} from './score';

export {
  DEFAULT_SAMPLES_PER_SEGMENT,
  boundsOf,
  clampTrackDist,
  isOutsideBounds,
  poseAt,
  projectDist,
  sampleTrack
} from './track';
export type { Bounds, Track, TrackOptions, TrackPose, Vec2 } from './track';

export {
  fire,
  isProjectileLost,
  projectileAngle,
  projectileSpeed,
  rayCircleT,
  stepProjectile,
  sweepProjectile
} from './projectile';
export type {
  FireOptions,
  Projectile,
  ProjectileHit,
  SweepResult
} from './projectile';
