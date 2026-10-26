/**
 * 彩球链 —— 祖玛的核心数据结构：一串沿轨道排布的球。
 *
 * 位置一律用**弧长 `dist`** 表示（见 `track.ts`），不用 x/y：这样轨道形状与球的排布
 * 彻底解耦，换任何曲线都不用改这里的逻辑，渲染时再由 `poseAt(track, dist)` 换算成坐标。
 *
 * 两条贯穿全模块的约定：
 *
 * 1. **降序排列**：`marbles[0]` 是头球（`dist` 最大、最接近洞口），最后一颗是尾球
 *    （最接近生成口）。洞口在 `dist = track.length` 一侧，生成口在 `dist = 0` 一侧。
 * 2. **不可变**：所有函数返回新链，绝不原地改。状态机要靠快照做 `subscribe` /
 *    时间旅行调试，共享引用的链会让「上一帧」跟着一起变。
 *
 * 间隙语义：相邻两球的 `dist` 差恰好等于 `spacing` 表示紧贴；更大表示有空隙
 * （消合后会出现）。有空隙时**只有靠生成口那一段在动**：`pushChain` 从尾球往前
 * 传播推进量，推进量先被空隙吃掉，闭合之后才轮到靠洞口那一段。所以「后面没有推
 * 到」的前段会停在原地，直到空隙重新接上。
 */
import { isMarbleColor, type MarbleColor } from './types';

/** 彩球 id：由状态机的计数器分配，链本身不生成，保证可复现。 */
export type MarbleId = number;

/** 一颗彩球。 */
export interface Marble {
  readonly id: MarbleId;
  readonly color: MarbleColor;
  /** 沿轨道的弧长位置（世界单位）。 */
  readonly dist: number;
}

/** 一条彩球链。 */
export interface Chain {
  /** 按 `dist` **降序**：`[0]` 为头球。 */
  readonly marbles: readonly Marble[];
  /** 紧贴时相邻两球的中心距，等于 2 × 球半径。 */
  readonly spacing: number;
}

/** `createChain()` 的选项。 */
export interface CreateChainOptions {
  /** 相邻球中心距（= 2 × 球半径），必须为正有限数。 */
  readonly spacing: number;
  /**
   * 头球的弧长位置。省略时让尾球正好落在生成口（`dist = 0`），
   * 即整条链刚从生成口出来。
   */
  readonly headDist?: number;
  /** 首颗球的 id，默认 0；状态机用它续接自己的 id 计数器。 */
  readonly startId?: MarbleId;
}

/** 校验并归一化间距。 */
function requireSpacing(spacing: number): number {
  if (!Number.isFinite(spacing) || spacing <= 0) {
    throw new RangeError(`spacing 必须是正有限数，收到 ${spacing}`);
  }
  return spacing;
}

/** 弧长位置必须是有限数（NaN / Infinity 传进来都是调用方的 bug）。 */
function requireFiniteDist(dist: number, label = 'dist'): number {
  if (!Number.isFinite(dist)) {
    throw new RangeError(`${label} 必须是有限数，收到 ${dist}`);
  }
  return dist;
}

/**
 * 由颜色序列建链。序列顺序 = **从洞口往生成口**（`colors[0]` 是头球），
 * 与 `marbles` 的降序约定一致，便于关卡数据自上而下直接读。
 *
 * @throws RangeError 间距非法、颜色不在调色板内、或 `headDist` 非有限数
 */
export function createChain(
  colors: readonly MarbleColor[],
  options: CreateChainOptions
): Chain {
  const spacing = requireSpacing(options.spacing);
  const count = colors.length;

  const head = options.headDist ?? (count - 1) * spacing;
  if (!Number.isFinite(head)) {
    throw new RangeError(`headDist 必须是有限数，收到 ${head}`);
  }

  const startId = options.startId ?? 0;
  const marbles: Marble[] = [];
  for (let i = 0; i < count; i += 1) {
    const color = colors[i]!;
    if (!isMarbleColor(color)) {
      throw new RangeError(`颜色序列[${i}] 不是合法彩球颜色：${String(color)}`);
    }
    marbles.push({ id: startId + i, color, dist: head - i * spacing });
  }
  return { marbles, spacing };
}

/** 头球（最接近洞口）；空链返回 `null`。 */
export function headOf(chain: Chain): Marble | null {
  return chain.marbles[0] ?? null;
}

/** 尾球（最接近生成口）；空链返回 `null`。 */
export function tailOf(chain: Chain): Marble | null {
  return chain.marbles[chain.marbles.length - 1] ?? null;
}

/** 空链判定，供胜利条件（链被清空）复用。 */
export function isEmptyChain(chain: Chain): boolean {
  return chain.marbles.length === 0;
}

/** 整条链平移 `delta`（向洞口为正）。不夹边界，交给状态机按轨道长度裁决。 */
export function advanceChain(chain: Chain, delta: number): Chain {
  if (!Number.isFinite(delta)) {
    throw new RangeError(`delta 必须是有限数，收到 ${delta}`);
  }
  if (delta === 0) return chain;
  return {
    spacing: chain.spacing,
    marbles: chain.marbles.map((m) => ({ id: m.id, color: m.color, dist: m.dist + delta }))
  };
}

/** 判「紧贴」的容差：小于它的空隙按没有空隙处理。 */
const CONTACT_EPS = 1e-9;

/**
 * 按**接触传播**平移整条链：尾球（靠生成口那颗）恒定位移 `delta`（入口一直在推它），
 * 往前每一颗能拿到多少推进量，取决于它和后面那颗之间还剩多少空隙要吃。
 *
 * 设第 `i` 颗（靠洞口侧）实际位移为 `m[i]`、它与后一颗之间的空隙为 `gap[i]`：
 *
 * - `delta > 0`（前进 / 推挤）：`m[尾] = delta`，`m[i] = max(0, m[i+1] - gap[i])`。
 *   于是紧贴的串成一起走（`gap = 0` 时 `m[i] = m[i+1]`），而断开的前段**在空隙吃掉
 *   推进量之前一步都不动** —— 后段以链速追上去，追上那一刻才轮到前段继续走。
 *   一帧闭合不完的空隙按比例结转，所以**任何一颗的位移都不会超过 `delta`**，
 *   不会出现「后段以 2 倍速狂奔」。
 * - `delta < 0`（倒退 / 拉动）：入口把尾球往回吸，靠**粘着**带动前面那些：
 *   `m[i] = m[i+1]`（当 `gap[i] = 0`）或 `0`（有空隙就拉不动）。
 *   推挤是接触才传，拉动是断开即止，两者不对称是刻意的 —— 球不会互相吸附。
 * - `delta = 0`：返回同一引用（状态机每帧都调，别白抄快照）。
 *
 * 不夹边界：`dist` 跌进负区间（被吸回入口外）是合法状态，由状态机裁决。
 * 结果恒满足不变量「任意相邻间距 ≥ `spacing`」，即不会出现两球互相嵌入。
 *
 * @throws RangeError `delta` 非有限数
 */
export function pushChain(chain: Chain, delta: number): Chain {
  if (!Number.isFinite(delta)) {
    throw new RangeError(`delta 必须是有限数，收到 ${delta}`);
  }
  const count = chain.marbles.length;
  if (delta === 0 || count === 0) return chain;

  const { spacing } = chain;
  const marbles: Marble[] = new Array<Marble>(count);
  // 尾球无条件跟着入口走。
  let moving = delta;
  for (let i = count - 1; i >= 0; i -= 1) {
    const cur = chain.marbles[i]!;
    if (i === count - 1) {
      marbles[i] = { id: cur.id, color: cur.color, dist: cur.dist + moving };
      continue;
    }
    // `gap` 是 cur（靠洞口侧）与后一颗之间的**原始**空隙。
    const gap = cur.dist - chain.marbles[i + 1]!.dist - spacing;
    if (delta > 0) {
      moving = Math.max(0, moving - Math.max(0, gap));
    } else {
      // 必须读 `moving` 而不是 `delta`：一旦某对之间有空隙，拉动就到此为止，
      // 后面（靠洞口侧）的所有颗都得冻结。写错成 delta 会让「断开」这个状态传不下去，
      // 隔着一道空隙又把前面的球拽回来 —— 前面的球倒着撞穿后面的球，链随即乱序，
      // 而 `findInsertIndex` 是二分查找，此后每次插入的位置全都不可信。
      moving = gap <= CONTACT_EPS ? moving : 0;
    }
    marbles[i] = { id: cur.id, color: cur.color, dist: cur.dist + moving };
  }
  return { spacing, marbles };
}

/**
 * `dist` 该插在哪个下标：返回第一个 `marbles[i].dist <= dist` 的 `i`
 * （即新球落在它靠洞口一侧）。降序数组上的二分。
 */
export function findInsertIndex(chain: Chain, dist: number): number {
  requireFiniteDist(dist);
  let lo = 0;
  let hi = chain.marbles.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (chain.marbles[mid]!.dist > dist) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  return lo;
}

/** `insertMarble()` 的入参。 */
export interface InsertOptions {
  /** 新球的弧长位置（命中点）。 */
  readonly dist: number;
  readonly color: MarbleColor;
  readonly id: MarbleId;
  /**
   * 轨道可用的最大弧长（通常是 `track.length`）。省略则不检查越界。
   * 插入后尾球 `dist` 若跌破 0，说明生成口方向挤不动，改为把整条链往洞口方向推。
   */
  readonly minDist?: number;
}

/**
 * 插入一颗球并向后挤压：先给新球定位，再从插入点往后逐颗保证与前一球的间距 ≥ `spacing`。
 *
 * **新球不会嵌进前一颗**：命中层给出的 `dist` 可能落在已有球的球体里（弹球与链球
 * 的圆心距小于 `2r`），那种位置物理上不存在，所以这里把它钳到「紧贴前一颗的后面」。
 * 于是往挤满的链中间插一颗的效果是：新球贴住前一颗，后段整体向生成口挪一个 `spacing`
 * —— 这正是祖玛「挤进去」的手感来源。
 *
 * 生成口方向挤不动时（尾球会跌破 `minDist`）改成整条链往洞口方向平移溢出量，
 * 于是「快到头时塞一颗会把队伍往前拱进洞口」，这是原版的紧张感，也是惩罚。
 *
 * @throws RangeError `dist` 非有限数，或颜色非法
 */
export function insertMarble(chain: Chain, options: InsertOptions): Chain {
  const { color, id, minDist } = options;
  if (!isMarbleColor(color)) {
    throw new RangeError(`插入颜色不合法：${String(color)}`);
  }

  // 只钳**一次**：新球最多贴到「靠洞口侧那颗」的后面 spacing 处，落点下标始终由原始命中点决定。
  //
  // 千万别写成「钳完拿新值重新二分、再钳」的循环 —— 相邻两球的 dist 差在浮点下并不严格等于
  // spacing（`1521.8 - 34 = 1487.8000000000002` 而下一颗是 `1487.7999999999997`），于是重新二分
  // 会跳到后一颗之后，front 变成它、limit 又退一格 —— 一路向链尾走过去。实测最狠的一例：
  // 打在第 3 颗上，球却插到第 18 个球位（相隔 15 颗）。按链的不变量「相邻间距 ≥ spacing」，
  // marbles[index].dist ≤ front.dist − spacing 恒成立，所以钳一次就是最终落点，无需迭代。
  let placed = requireFiniteDist(options.dist);
  const index = findInsertIndex(chain, placed);
  const front = index > 0 ? chain.marbles[index - 1] : undefined;
  if (front) {
    const limit = front.dist - chain.spacing;
    if (placed > limit) placed = limit;
  }

  const marbles: Marble[] = chain.marbles.map((m) => ({ ...m }));
  marbles.splice(index, 0, { id, color, dist: placed });

  // 向后（生成口方向）挤压：后一颗最多只能贴在前一颗后面 spacing 处。
  for (let i = index + 1; i < marbles.length; i += 1) {
    const prev = marbles[i - 1]!;
    const cur = marbles[i]!;
    const limit = prev.dist - chain.spacing;
    if (cur.dist > limit) {
      marbles[i] = { id: cur.id, color: cur.color, dist: limit };
    }
  }

  if (minDist !== undefined) {
    const last = marbles[marbles.length - 1]!;
    if (last.dist < minDist) {
      // 生成口那边挤不动：整条链往洞口方向平移溢出量。
      const overflow = minDist - last.dist;
      for (let i = 0; i < marbles.length; i += 1) {
        const m = marbles[i]!;
        marbles[i] = { id: m.id, color: m.color, dist: m.dist + overflow };
      }
    }
  }

  return { spacing: chain.spacing, marbles };
}

/**
 * 让后段向洞口方向追近，最多各追 `maxDelta`，用于消合后闭合空隙。
 *
 * 从头部开始单向传播：头球不动，后面的球被前一颗「拉」过来，但不超过 `maxDelta`，
 * 所以一帧内空隙只会收拢有限距离（帧率无关的运动由状态机按 `speed × dt` 传进来）。
 * 传 `Infinity` 表示「瞬间完全闭合」，供离线结算与单测用。
 */
export function closeGaps(chain: Chain, maxDelta: number): Chain {
  if (Number.isNaN(maxDelta) || maxDelta < 0) {
    throw new RangeError(`maxDelta 必须是 ≥ 0 的数（可用 Infinity 表示一次闭合），收到 ${maxDelta}`);
  }
  // 已紧贴就不新建快照：状态机每帧都会调它，白抄一份数组会给 subscribe 制造无意义的新引用。
  if (maxDelta === 0 || chain.marbles.length < 2 || !hasGaps(chain)) return chain;

  const marbles: Marble[] = [{ ...chain.marbles[0]! }];
  for (let i = 1; i < chain.marbles.length; i += 1) {
    const prev = marbles[i - 1]!;
    const cur = chain.marbles[i]!;
    const target = prev.dist - chain.spacing;
    const dist = cur.dist < target ? Math.min(target, cur.dist + maxDelta) : cur.dist;
    marbles.push({ id: cur.id, color: cur.color, dist });
  }
  return { spacing: chain.spacing, marbles };
}

/** `index` 与后一颗之间的空隙（0 = 紧贴）。末颗之后返回 0。 */
export function gapAfter(chain: Chain, index: number): number {
  const cur = chain.marbles[index];
  const next = chain.marbles[index + 1];
  if (!cur || !next) return 0;
  return Math.max(0, cur.dist - next.dist - chain.spacing);
}

/** 链上是否存在空隙（消合后未闭合）。 */
export function hasGaps(chain: Chain): boolean {
  for (let i = 0; i < chain.marbles.length - 1; i += 1) {
    if (gapAfter(chain, i) > CONTACT_EPS) return true;
  }
  return false;
}

/** 按弧长在 `[from, to]` 区间内的球（含端点），结果保持降序。 */
export function marblesInWindow(chain: Chain, from: number, to: number): readonly Marble[] {
  const lo = Math.min(from, to);
  const hi = Math.max(from, to);
  return chain.marbles.filter((m) => m.dist >= lo && m.dist <= hi);
}
