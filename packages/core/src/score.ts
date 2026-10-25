/**
 * 计分规则 —— 纯函数，单独成模块是为了让「数值手感」能被表驱动单测钉死。
 *
 * 分的四个来源：
 *
 * 1. **消合本身**：一次消掉的球越多，单球价值越高（超线性，鼓励攒长串）。
 * 2. **连锁倍率**：一次消合导致缺口闭合后又撞出新一消，combo 递增，倍率线性叠加。
 * 3. **远射奖励**：弹球飞得越远命中，奖励越高（原版祖玛的经典设计，
 *    逼玩家去打队伍深处的尾部而不是随手打最近的目标）。
 * 4. **过关结算**：清空有大奖，剩余球按颗扣分，命中率高有奖励。
 *
 * 所有函数只吃数字、不碰状态：改公式只需改这里 + 跑测试。
 */

/** 消合的最少连珠数（原版是 3）。 */
export const MIN_MATCH_RUN = 3;

/** 单球基础分。 */
export const BASE_POINTS_PER_MARBLE = 100;

/** 超出最少连珠数时，每颗额外加的分（惩罚短串、奖励长串的斜率）。 */
export const EXTRA_RUN_BONUS_PER_MARBLE = 50;

/** 每 +1 级连锁增加的倍率（combo = 1 即 ×1，combo = 3 即 ×2）。 */
export const COMBO_MULTIPLIER_STEP = 0.5;

/** 远射奖励：弹球每飞这么多世界单位，加一档。 */
export const FAR_SHOT_DISTANCE_STEP = 100;

/** 远射每档的奖励分。 */
export const FAR_SHOT_BONUS_PER_STEP = 25;

/** 清空整条链的过关大奖。 */
export const PERFECT_CLEAR_BONUS = 1000;

/** 命中率奖励分上限（满命中才拿得满）。 */
export const ACCURACY_BONUS_MAX = 500;

/** 过关时每颗剩余球的扣分。 */
export const CLEAR_PENALTY_PER_MARBLE = 15;

function requireNonNegativeFinite(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${label} 必须是 ≥ 0 的有限数，收到 ${value}`);
  }
  return value;
}

/**
 * 一次消合的基础分（未乘连锁倍率）。
 *
 * 表：n=3 → 300，n=4 → 600，n=5 → 1000，n=6 → 1500。
 * `runLength < 3` 返回 0（调用方本该先用 `findRuns` 过滤）。
 */
export function matchPoints(runLength: number): number {
  requireNonNegativeFinite(runLength, 'runLength');
  if (runLength < MIN_MATCH_RUN) return 0;
  const extra = runLength - MIN_MATCH_RUN;
  return runLength * BASE_POINTS_PER_MARBLE + extra * runLength * EXTRA_RUN_BONUS_PER_MARBLE;
}

/** 连锁倍率：`combo` 是第几次连锁（1 = 首次消合，不加倍）。 */
export function comboMultiplier(combo: number): number {
  if (!Number.isInteger(combo) || combo < 1) {
    throw new RangeError(`combo 必须是 ≥ 1 的整数，收到 ${combo}`);
  }
  return 1 + (combo - 1) * COMBO_MULTIPLIER_STEP;
}

/** 一次消合的得分（含连锁倍率），结果取整。 */
export function scoreMatch(runLength: number, combo = 1): number {
  return Math.round(matchPoints(runLength) * comboMultiplier(combo));
}

/**
 * 远射奖励：按弹球从发射点到命中点的**直线飞行距离**算档数。
 *
 * 用直线而非沿轨弧长，是因为玩家的直觉就是「我打得多远」，还省掉一次弧长换算。
 */
export function farShotPoints(travelDistance: number): number {
  requireNonNegativeFinite(travelDistance, 'travelDistance');
  return Math.floor(travelDistance / FAR_SHOT_DISTANCE_STEP) * FAR_SHOT_BONUS_PER_STEP;
}

/**
 * 过关结算分。
 *
 * - `remaining`：链上剩余球数，0（清空）拿大奖，否则按颗扣分。
 * - `shotsFired`：本关发射数；`0` 按 1 处理，防除零也防止「一枪未开发满分」。
 * - `hits`：命中次数；命中率只用来加奖，封顶 1。
 *
 * 结果不会为负（扣分超过奖励时夹到 0）。
 */
export function clearBonus(remaining: number, shotsFired: number, hits: number): number {
  requireNonNegativeFinite(remaining, 'remaining');
  requireNonNegativeFinite(hits, 'hits');
  if (!Number.isFinite(shotsFired) || shotsFired < 0) {
    throw new RangeError(`shotsFired 必须是 ≥ 0 的有限数，收到 ${shotsFired}`);
  }
  if (hits > shotsFired && shotsFired > 0) {
    throw new RangeError(`hits(${hits}) 不可能大于 shotsFired(${shotsFired})`);
  }

  const shots = Math.max(1, shotsFired);
  const accuracy = Math.min(1, hits / shots);
  const raw =
    (remaining === 0 ? PERFECT_CLEAR_BONUS : 0) +
    Math.round(accuracy * ACCURACY_BONUS_MAX) -
    remaining * CLEAR_PENALTY_PER_MARBLE;

  return Math.max(0, raw);
}
