/**
 * 关卡 —— 曲线生成器、关卡表、初始球序列与倒退段。
 *
 * 三条贯穿本模块的设计约束：
 *
 * 1. **只用不自交的曲线**。祖玛的球位全靠「沿轨弧长」表达，命中判定要把空间点投影回
 *    轨道（`projectDist`）；曲线一旦自交，同一个空间点就有两个合法弧长，插入位置会跳变。
 *    原版的 loop 类关卡因此换成「多圈螺线 + 蛇形折返」，观感相近而拓扑安全。
 * 2. **控制点一律由参数化生成器产出**，不手抄坐标。螺线的圈数、半径、起止角是可调参数，
 *    关卡表因此短到能一眼看完，且能被单测遍历校验（包围盒不出世界、链放得下）。
 * 3. **倒退段用进度比例而不是绝对弧长描述**。每条曲线长度不同，写绝对数字既难维护也容易
 *    超出轨道；用 `0..1` 的进度表达，解析成绝对弧长的活儿交给 `rewindSchedule()`。
 *
 * 世界坐标固定 `1000 × 1000`，渲染层负责等比映射到画布，所以这里的数值与屏幕像素无关。
 */
import type { MarbleColor } from './types';
import { paletteFor } from './types';
import { boundsOf, sampleTrack, type Bounds, type Track, type TrackOptions, type Vec2 } from './track';

/** 世界尺寸（正方形，边长 1000 世界单位）。 */
export const WORLD_SIZE = 1000;

/** 随机源：返回 `[0, 1)`，由外部注入以便复现（沿用合集的注入式约定）。 */
export type RandomSource = () => number;

/** 一段「先冲后缩」的倒退触发，按链头进度表达。 */
export interface RewindTrigger {
  /** 链头进度到达此比例时开始倒退，`(0, 1)`。 */
  readonly atProgress: number;
  /** 倒退回到的进度，必须小于 `atProgress`。 */
  readonly backProgress: number;
}

/** 一个关卡的完整定义。 */
export interface LevelSpec {
  /** 关卡序号，从 1 连续递增。 */
  readonly id: number;
  readonly name: string;
  /** 轨道控制点（由本模块的生成器产出）。 */
  readonly controlPoints: readonly Vec2[];
  /** 发射器在世界坐标里的位置。 */
  readonly launcher: Vec2;
  /** 用调色板前几种颜色，2..6。 */
  readonly colors: number;
  /** 开局链上的球数。 */
  readonly marbles: number;
  /** 彩球半径（世界单位）；紧贴间距 = 2r。 */
  readonly radius: number;
  /** 初始推进速度（世界单位 / 秒）。 */
  readonly speed: number;
  /** 每秒增加的加速度，0 表示匀速。 */
  readonly accelerate: number;
  /** 速度上限，防止长线关卡后期失控。 */
  readonly maxSpeed: number;
  /** 倒退段（可为空数组）。 */
  readonly rewind: readonly RewindTrigger[];
  /** 玩家手里的弹球预览队列长度（≥ 1）。 */
  readonly nextQueue: number;
}

/** 螺线生成参数。 */
export interface SpiralOptions {
  readonly cx: number;
  readonly cy: number;
  readonly turns: number;
  readonly rStart: number;
  readonly rEnd: number;
  readonly count: number;
  readonly startAngle?: number;
}

/**
 * 阿基米德螺线控制点：由外向内收缩，祖玛的经典形状。
 *
 * 半径沿角度线性内收，因此**必然不自交**；圈数 `turns` 决定长度与紧凑程度。
 */
export function archimedeanSpiral(options: SpiralOptions): Vec2[] {
  const { cx, cy, turns, rStart, rEnd, count } = options;
  if (!Number.isInteger(count) || count < 2) {
    throw new RangeError(`count 必须是 ≥ 2 的整数，收到 ${count}`);
  }
  if (!(turns > 0) || !Number.isFinite(turns)) {
    throw new RangeError(`turns 必须是正有限数，收到 ${turns}`);
  }
  if (!(rStart > rEnd) || rEnd <= 0) {
    throw new RangeError(`必须满足 rStart > rEnd > 0，收到 ${rStart} → ${rEnd}`);
  }
  const start = options.startAngle ?? 0;
  const points: Vec2[] = [];
  for (let i = 0; i < count; i += 1) {
    const k = i / (count - 1);
    const angle = start + k * turns * Math.PI * 2;
    const r = rStart + (rEnd - rStart) * k;
    points.push({ x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) });
  }
  return points;
}

/** 蛇形折返生成参数。 */
export interface SerpentineOptions {
  readonly cx: number;
  readonly cy: number;
  readonly width: number;
  readonly height: number;
  /** 折返次数（1 = 一个 S）。 */
  readonly folds: number;
  readonly count: number;
}

/**
 * 蛇形折返控制点：在矩形带内左右扫、逐层下移，半径单调不重叠因此不自交。
 *
 * 用来给关卡表换口味（螺线看腻了的第 3、7、11 关）。
 */
export function serpentine(options: SerpentineOptions): Vec2[] {
  const { cx, cy, width, height, folds, count } = options;
  if (!Number.isInteger(count) || count < 2) {
    throw new RangeError(`count 必须是 ≥ 2 的整数，收到 ${count}`);
  }
  if (!Number.isInteger(folds) || folds < 1) {
    throw new RangeError(`folds 必须是 ≥ 1 的整数，收到 ${folds}`);
  }
  if (!(width > 0) || !(height > 0)) {
    throw new RangeError(`width / height 必须为正，收到 ${width} × ${height}`);
  }
  const points: Vec2[] = [];
  const steps = count - 1;
  for (let i = 0; i <= steps; i += 1) {
    const u = i / steps; // 总进度 0..1
    const sweep = u * (folds + 1); // 走完几个半程
    const phase = sweep % 2; // 0..2，当前半程内的位置
    const dir = Math.floor(sweep) % 2 === 0 ? 1 : -1;
    const x = cx + dir * (phase <= 1 ? phase : 2 - phase) * (width / 2);
    const y = cy - height / 2 + u * height;
    points.push({ x, y });
  }
  return points;
}

/** 关卡的紧贴间距 = 2 × 半径。 */
export function spacingOf(spec: LevelSpec): number {
  return spec.radius * 2;
}

/** 由关卡定义建轨道（含弧长表）。 */
export function buildTrack(spec: LevelSpec, options: TrackOptions = {}): Track {
  return sampleTrack(spec.controlPoints, options);
}

/** 关卡轨道的包围盒（含外扩余量与球半径）。 */
export function levelBounds(spec: LevelSpec, padding = 0): Bounds {
  // 刻意在这里校验而不是依赖 boundsOf：它会再加一个 radius，负 padding 会被半径吃掉。
  if (!Number.isFinite(padding) || padding < 0) {
    throw new RangeError(`padding 必须是 ≥ 0 的有限数，收到 ${padding}`);
  }
  return boundsOf(buildTrack(spec), padding + spec.radius);
}

/**
 * 生成开局球序列。
 *
 * 唯一的硬约束是**不许开局就带三连**——开局就自消等于白送分，还会让玩家以为消合机制坏了。
 * 做法是撞上「与前两颗同色」就重投（有限次），重投仍失败就从调色板里挑一个与前一颗不同的
 * 颜色兜底。单色调色板 + ≥3 颗球在数学上不可能避开三连，直接抛错而不是偷偷放行。
 *
 * 序列顺序 = **从链尾到链头**（先进场的在前），交给 `createChain` 时按需要倒序。
 */
export function generateMarbleColors(
  spec: Pick<LevelSpec, 'colors' | 'marbles'>,
  rng: RandomSource
): MarbleColor[] {
  const palette = paletteFor(spec.colors);
  if (!Number.isInteger(spec.marbles) || spec.marbles < 0) {
    throw new RangeError(`marbles 必须是 ≥ 0 的整数，收到 ${spec.marbles}`);
  }
  if (palette.length < 2 && spec.marbles >= 3) {
    throw new RangeError(`单色调色板无法避免开局三连（marbles=${spec.marbles}），至少要 2 色`);
  }

  const out: MarbleColor[] = [];
  for (let i = 0; i < spec.marbles; i += 1) {
    const prev = out[i - 1];
    const prev2 = out[i - 2];
    let picked: MarbleColor | null = null;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const index = Math.min(palette.length - 1, Math.floor(rng() * palette.length));
      const candidate = palette[index]!;
      if (prev !== undefined && prev2 !== undefined && candidate === prev && candidate === prev2) {
        continue;
      }
      picked = candidate;
      break;
    }
    if (picked === null) {
      // 兜底：只要与前一颗不同，就绝无可能凑成三连。
      picked = palette.find((c) => c !== prev) ?? palette[0]!;
    }
    out.push(picked);
  }
  return out;
}

/** 解析后的倒退段（绝对弧长）。 */
export interface RewindStep {
  /** 链头到这个弧长时开始倒退。 */
  readonly atDist: number;
  /** 倒退回这个弧长后转为前进。 */
  readonly backTo: number;
}

/**
 * 把进度比例的倒退段解析成绝对弧长，并校验合法性。
 *
 * 要求：比例递增、每段 `backProgress < atProgress`、且段与段不重叠
 * （前一段的 `backProgress` 必须小于后一段的 `atProgress`，否则会出现「刚转前进就又要倒退」）。
 */
export function rewindSchedule(
  triggers: readonly RewindTrigger[],
  trackLength: number
): readonly RewindStep[] {
  if (!(trackLength > 0) || !Number.isFinite(trackLength)) {
    throw new RangeError(`trackLength 必须是正有限数，收到 ${trackLength}`);
  }
  const steps: RewindStep[] = [];
  let previousBack = 0;
  for (const trigger of triggers) {
    const { atProgress, backProgress } = trigger;
    if (!(backProgress > 0) || !(atProgress > backProgress) || atProgress >= 1) {
      throw new RangeError(
        `倒退段必须满足 0 < backProgress < atProgress < 1，收到 ${backProgress} → ${atProgress}`
      );
    }
    const atDist = atProgress * trackLength;
    const backTo = backProgress * trackLength;
    if (backTo <= previousBack) {
      throw new RangeError(`倒退段重叠：前一段回到 ${previousBack}，本一段却要从 ${backTo} 起步`);
    }
    steps.push({ atDist, backTo });
    previousBack = backTo;
  }
  return steps;
}

/** 倒退进度游标：`step` 是当前正在执行的倒退段下标（-1 = 正常前进）。 */
export interface RewindState {
  readonly step: number;
  /** 已触发到第几段（下一段候选的下标）。 */
  readonly fired: number;
}

/** 初始游标。 */
export const INITIAL_REWIND_STATE: RewindState = { step: -1, fired: 0 };

/** 某时刻链头的运动方向与状态。 */
export interface AdvanceDecision {
  /** +1 前进（向洞口），-1 倒退（回吐）。 */
  readonly direction: 1 | -1;
  readonly state: RewindState;
}

/**
 * 按链头弧长决定这一帧是前进还是倒退，并推进游标。
 *
 * 纯函数：状态显式进出，方便单测「冲 → 缩 → 再冲」的完整节拍，也让状态机能把它存进快照。
 */
export function decideAdvance(
  steps: readonly RewindStep[],
  headDist: number,
  state: RewindState
): AdvanceDecision {
  if (state.step >= 0) {
    const active = steps[state.step];
    if (!active) return { direction: 1, state: { step: -1, fired: state.fired } };
    if (headDist <= active.backTo) {
      // 本段倒退走完：交回前进，并把「已触发」推进到下一段。
      return {
        direction: 1,
        state: { step: -1, fired: Math.max(state.fired, state.step + 1) }
      };
    }
    return { direction: -1, state };
  }

  const next = steps[state.fired];
  if (next && headDist >= next.atDist) {
    return { direction: -1, state: { step: state.fired, fired: state.fired + 1 } };
  }
  return { direction: 1, state };
}

/** 关卡推进速度：从 `speed` 起按 `accelerate` 线性增长，封顶 `maxSpeed`。 */
export function speedAt(spec: LevelSpec, elapsedSeconds: number): number {
  if (!Number.isFinite(elapsedSeconds) || elapsedSeconds < 0) {
    throw new RangeError(`elapsedSeconds 必须是 ≥ 0 的有限数，收到 ${elapsedSeconds}`);
  }
  return Math.min(spec.maxSpeed, spec.speed + spec.accelerate * elapsedSeconds);
}

/** 中心坐标（世界的一半）。 */
const CENTER = WORLD_SIZE / 2;

/** 关卡共用的发射器位置：世界正中，螺线的内圈尽头就是它旁边。 */
const LAUNCHER: Vec2 = { x: CENTER, y: CENTER };

/** 造一个螺线关。 */
function spiralLevel(
  base: Omit<LevelSpec, 'controlPoints' | 'launcher'>,
  turns: number,
  rStart: number,
  rEnd: number,
  count: number,
  startAngle = 0
): LevelSpec {
  return {
    ...base,
    launcher: LAUNCHER,
    controlPoints: archimedeanSpiral({ cx: CENTER, cy: CENTER, turns, rStart, rEnd, count, startAngle })
  };
}

/** 造一个蛇形关。 */
function snakeLevel(
  base: Omit<LevelSpec, 'controlPoints' | 'launcher'>,
  folds: number,
  width: number,
  height: number,
  count: number
): LevelSpec {
  return {
    ...base,
    launcher: LAUNCHER,
    controlPoints: serpentine({ cx: CENTER, cy: CENTER, width, height, folds, count })
  };
}

/**
 * 关卡表（12 关，难度曲线：色数 3→6、球数 24→64、速度 26→62、第 4 关起出现倒退段）。
 *
 * 半径从 22 收到 17：球越小，同一条轨道塞得下更多球，也越考验瞄准精度。
 */
export const LEVELS: readonly LevelSpec[] = [
  spiralLevel(
    { id: 1, name: '入门单圈', colors: 3, marbles: 24, radius: 22, speed: 26, accelerate: 0.6, maxSpeed: 40, rewind: [], nextQueue: 3 },
    1.25, 400, 150, 26
  ),
  spiralLevel(
    { id: 2, name: '双环', colors: 3, marbles: 30, radius: 22, speed: 30, accelerate: 0.8, maxSpeed: 46, rewind: [], nextQueue: 3 },
    1.75, 410, 145, 34
  ),
  snakeLevel(
    { id: 3, name: '蛇形折返', colors: 4, marbles: 34, radius: 21, speed: 32, accelerate: 0.9, maxSpeed: 50, rewind: [], nextQueue: 3 },
    2, 700, 640, 30
  ),
  spiralLevel(
    { id: 4, name: '第一次回吐', colors: 4, marbles: 36, radius: 21, speed: 34, accelerate: 1.0, maxSpeed: 52, rewind: [{ atProgress: 0.42, backProgress: 0.28 }], nextQueue: 3 },
    2, 415, 140, 38, Math.PI / 3
  ),
  spiralLevel(
    { id: 5, name: '三圈收紧', colors: 4, marbles: 40, radius: 20, speed: 36, accelerate: 1.1, maxSpeed: 56, rewind: [{ atProgress: 0.5, backProgress: 0.32 }], nextQueue: 3 },
    2.4, 420, 132, 44, Math.PI / 2
  ),
  snakeLevel(
    { id: 6, name: '四折长廊', colors: 5, marbles: 42, radius: 20, speed: 38, accelerate: 1.2, maxSpeed: 58, rewind: [{ atProgress: 0.46, backProgress: 0.3 }], nextQueue: 3 },
    3, 720, 700, 38
  ),
  spiralLevel(
    { id: 7, name: '反向双环', colors: 5, marbles: 46, radius: 19, speed: 40, accelerate: 1.3, maxSpeed: 60, rewind: [{ atProgress: 0.38, backProgress: 0.22 }, { atProgress: 0.7, backProgress: 0.52 }], nextQueue: 3 },
    2.6, 425, 128, 48, -Math.PI / 4
  ),
  spiralLevel(
    { id: 8, name: '五圈密铺', colors: 5, marbles: 50, radius: 19, speed: 42, accelerate: 1.4, maxSpeed: 62, rewind: [{ atProgress: 0.44, backProgress: 0.26 }], nextQueue: 3 },
    3, 430, 124, 54
  ),
  snakeLevel(
    { id: 9, name: '回旋六折', colors: 6, marbles: 52, radius: 18, speed: 44, accelerate: 1.5, maxSpeed: 64, rewind: [{ atProgress: 0.4, backProgress: 0.24 }, { atProgress: 0.72, backProgress: 0.54 }], nextQueue: 3 },
    5, 740, 720, 46
  ),
  spiralLevel(
    { id: 10, name: '深渊三圈半', colors: 6, marbles: 56, radius: 18, speed: 48, accelerate: 1.6, maxSpeed: 68, rewind: [{ atProgress: 0.36, backProgress: 0.2 }, { atProgress: 0.66, backProgress: 0.48 }], nextQueue: 3 },
    3.3, 435, 120, 60, Math.PI
  ),
  spiralLevel(
    { id: 11, name: '细球紧卷', colors: 6, marbles: 60, radius: 17, speed: 52, accelerate: 1.8, maxSpeed: 72, rewind: [{ atProgress: 0.34, backProgress: 0.18 }, { atProgress: 0.62, backProgress: 0.44 }, { atProgress: 0.86, backProgress: 0.72 }], nextQueue: 3 },
    3.6, 440, 116, 66, Math.PI / 6
  ),
  spiralLevel(
    { id: 12, name: '终局·四圈', colors: 6, marbles: 64, radius: 17, speed: 56, accelerate: 2, maxSpeed: 76, rewind: [{ atProgress: 0.3, backProgress: 0.14 }, { atProgress: 0.58, backProgress: 0.4 }, { atProgress: 0.84, backProgress: 0.7 }], nextQueue: 3 },
    4, 445, 112, 72, -Math.PI / 2
  )
];

/** 按 id 取关卡（1 起）。 */
export function levelById(id: number): LevelSpec {
  const spec = LEVELS.find((l) => l.id === id);
  if (!spec) {
    throw new RangeError(`关卡 ${id} 不存在（共 ${LEVELS.length} 关）`);
  }
  return spec;
}

/** 关卡总数。 */
export const LEVEL_COUNT = LEVELS.length;
