/**
 * 同色消合与连锁 —— 祖玛的「爽感」来源，全部是纯函数。
 *
 * 关键语义（也是最容易被想当然的地方）：**只有紧贴的球才算一串**。
 * 彩球链在消合后会留下空隙，后段要等 `closeGaps` 把它拉回接触才算同一段；
 * 如果无视空隙直接按颜色分组，就会出现「隔着一条鸿沟的两颗同色球被算成连珠」，
 * 玩家在屏幕上看到的明明是断开的两截，分数却涨了。所以检测时 `gapAfter` 必须 ≈ 0。
 *
 * 连锁（combo）不是独立机制，而是这个规则的自然结果：消掉中间一段 → 前后段合拢 →
 * 断口两侧同色 → 又成一串 → 倍率再涨一档。`collapseChain()` 把这一串迭代一次跑完，
 * 供离线结算与单测用；实时玩法里状态机每帧调 `findRuns()`，连锁会随空隙闭合逐拍发生。
 */
import { closeGaps, gapAfter, type Chain } from './chain';
import { MIN_MATCH_RUN, scoreMatch } from './score';
import type { MarbleColor } from './types';

/** 判定「紧贴」的弧长间隙容差（世界单位）。 */
const CONTACT_EPS = 1e-9;

/** 链上一段连续同色且紧贴的球。 */
export interface MatchRun {
  /** 起始下标（含），按 `chain.marbles` 的降序索引。 */
  readonly from: number;
  /** 结束下标（含）。 */
  readonly to: number;
  readonly color: MarbleColor;
  /** 球数，等于 `to - from + 1`。 */
  readonly length: number;
}

/** 一波消合（同一个 combo 层级内同时发生的所有 run）。 */
export interface CollapseEvent {
  /** 第几波连锁，从 1 起。 */
  readonly combo: number;
  readonly runs: readonly MatchRun[];
  /** 这一波的得分（已乘该波倍率）。 */
  readonly points: number;
  /** 这一波消掉的球数。 */
  readonly removed: number;
}

/** `collapseChain()` 的完整结果。 */
export interface CollapseResult {
  /** 结算后的链（不再有可消的 run）。 */
  readonly chain: Chain;
  readonly events: readonly CollapseEvent[];
  /** 消掉的球总数。 */
  readonly removed: number;
  /** 总得分。 */
  readonly points: number;
  /** 达到的最高连锁层级（0 = 什么都没消）。 */
  readonly maxCombo: number;
}

/**
 * 找出链上所有可消的 run（同色 + 紧贴 + 长度 ≥ `minRun`），按下标升序。
 *
 * @throws RangeError `minRun` 不是 ≥ 2 的整数（2 连就消会让游戏失去意义）
 */
export function findRuns(chain: Chain, minRun: number = MIN_MATCH_RUN): readonly MatchRun[] {
  if (!Number.isInteger(minRun) || minRun < 2) {
    throw new RangeError(`minRun 必须是 ≥ 2 的整数，收到 ${minRun}`);
  }
  const runs: MatchRun[] = [];
  const marbles = chain.marbles;
  let i = 0;
  while (i < marbles.length) {
    const color = marbles[i]!.color;
    let j = i;
    while (
      j + 1 < marbles.length &&
      marbles[j + 1]!.color === color &&
      gapAfter(chain, j) <= CONTACT_EPS
    ) {
      j += 1;
    }
    const length = j - i + 1;
    if (length >= minRun) {
      runs.push({ from: i, to: j, color, length });
    }
    i = j + 1;
  }
  return runs;
}

/** 链上是否存在可消 run（状态机每帧的快筛）。 */
export function hasRun(chain: Chain, minRun: number = MIN_MATCH_RUN): boolean {
  return findRuns(chain, minRun).length > 0;
}

/**
 * 一次性摘掉多个 run。
 *
 * 做法是把所有 run 的下标收成**并集**再过滤，而不是逐个 `splice`：后者会让后面每个 run
 * 的 `from` / `to` 随前面删掉的球整体错位，是这类代码最经典的 bug 源。并集顺带定义了
 * 重叠语义——理论上 `findRuns` 产出的 run 互不重叠，真传进重叠区间也只删一次。
 *
 * 空 run 列表返回**同一个引用**（状态机每帧都会调快筛，避免无谓的快照分配）。
 */
export function removeRuns(chain: Chain, runs: readonly MatchRun[]): Chain {
  if (runs.length === 0) return chain;
  const doomed = new Set<number>();
  for (const run of runs) {
    for (let i = run.from; i <= run.to; i += 1) {
      doomed.add(i);
    }
  }
  if (doomed.size === 0) return chain;
  return {
    spacing: chain.spacing,
    marbles: chain.marbles.filter((_, index) => !doomed.has(index))
  };
}

/**
 * 把消合 + 空隙闭合 + 连锁迭代到底。
 *
 * 每波：先找 run → 记分 → 摘除 → 用 `closeGaps(∞)` 让断口瞬间合拢 → 再看有没有新一波。
 * 迭代上限取球的总数（每波至少消掉 `minRun ≥ 2` 颗，必然收敛），
 * 但仍写成带 guard 的循环，防止未来改动让它不收敛时死循环。
 */
export function collapseChain(
  chain: Chain,
  options: { readonly minRun?: number } = {}
): CollapseResult {
  const minRun = options.minRun ?? MIN_MATCH_RUN;
  const maxWaves = Math.floor(chain.marbles.length / minRun) + 1;

  let current = chain;
  const events: CollapseEvent[] = [];
  let totalRemoved = 0;
  let totalPoints = 0;

  for (let wave = 1; wave <= maxWaves; wave += 1) {
    const runs = findRuns(current, minRun);
    if (runs.length === 0) break;

    let waveRemoved = 0;
    let wavePoints = 0;
    for (const run of runs) {
      waveRemoved += run.length;
      wavePoints += scoreMatch(run.length, wave);
    }

    events.push({ combo: wave, runs, points: wavePoints, removed: waveRemoved });
    totalRemoved += waveRemoved;
    totalPoints += wavePoints;

    current = closeGaps(removeRuns(current, runs), Number.POSITIVE_INFINITY);
  }

  return {
    chain: current,
    events,
    removed: totalRemoved,
    points: totalPoints,
    maxCombo: events.length
  };
}
