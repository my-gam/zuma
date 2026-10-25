export { GameZuma, type GameZumaHandle, type GameZumaProps } from './GameZuma';
export { useGame } from './useGame';
export type { UseGameOptions, UseGameReturn } from './useGame';

// 宿主不必另外安装 core 也能拿到关键类型（沿用 2048 / sudoku 的 re-export 约定）。
export type {
  Burst,
  GamePhase,
  LevelSpec,
  MarbleColor,
  Projectile,
  Vec2,
  ZumaOptions,
  ZumaState
} from '@my-games/zuma-core';
