/**
 * `Zuma` 状态机 —— 把曲线、链、弹道、消合、关卡与存档串成一局可玩的游戏。
 *
 * 三条最重要的设计决定：
 *
 * 1. **固定子步物理**。`tick(dtMs)` 由适配层的 `requestAnimationFrame` 驱动，帧间隔天不
 *    定（60/90/120Hz 手机都有，切后台回来更是几百毫秒）。若按「一帧一步」推进，同一局
 *    在不同设备上会跑出不同结果，而且高速弹球在大间隔下更容易穿球。所以内部按固定步长
 *    累积推进，并给单次 `tick` 的追进步数封顶：切后台回来只会「原地稍等」，不会一睁眼
 *    球已进洞。
 * 2. **连锁是涌现出来的，不是写死的**。插入后先只有断口两侧的球；后段随时间追近
 *    （`closeGaps`），追上贴合的那一刻 `findRuns` 才发现新一串 → `combo` 自然 +1。
 *    `combo` 只在「链上既无空隙又无可消串」时归零。
 * 3. **core 不放定时器、不查 DOM**。秒级展示（HUD 计时刷新）属适配层，本类只在 `tick`
 *    里累加 `elapsedMs`（沿用 sudoku 的分工结论）。
 *
 * 依赖全部可注入（`rng` / `storage` / `clock`），所以整局能在 Node 里零 DOM 跑完并重放。
 */
import {
  advanceChain,
  closeGaps,
  createChain,
  gapAfter,
  insertMarble,
  type Chain,
  type Marble,
  type MarbleId
} from './chain';
import {
  INITIAL_REWIND_STATE,
  LEVELS,
  buildTrack,
  decideAdvance,
  generateMarbleColors,
  levelById,
  rewindSchedule,
  spacingOf,
  speedAt,
  type LevelSpec,
  type RandomSource,
  type RewindState,
  type RewindStep
} from './levels';
import { findRuns, removeRuns, type MatchRun } from './match';
import { fire, projectileAngle, sweepProjectile, type Projectile } from './projectile';
import { clearBonus, farShotPoints, scoreMatch } from './score';
import {
  DEFAULT_BEST_KEY,
  DEFAULT_SAVE_KEY,
  SAVE_VERSION,
  emptyBest,
  loadBest,
  loadSave,
  recordBest,
  writeJson,
  type SerializedBest,
  type SerializedSave,
  type StorageLike
} from './storage';
import type { MarbleColor } from './types';
import { paletteFor } from './types';
import { boundsOf, poseAt, type Bounds, type Track, type Vec2 } from './track';

/** 游戏所处的阶段。 */
export type GamePhase = 'ready' | 'playing' | 'paused' | 'won' | 'lost';

/** 一次消合产生的爆点，交给渲染层画动画（会随时间老化并自动清理）。 */
export interface Burst {
  readonly id: number;
  readonly color: MarbleColor;
  /** 爆点在轨道上的弧长。 */
  readonly dist: number;
  /** 产生时本局已进行的毫秒数。 */
  readonly atMs: number;
  /** 第几波连锁（1 起）。 */
  readonly combo: number;
  /** 那一串的长度（渲染可以按它决定爆点大小）。 */
  readonly runLength: number;
}

/** 对外暴露的只读快照。 */
export interface ZumaState {
  readonly phase: GamePhase;
  readonly level: number;
  readonly chain: Chain;
  readonly projectile: Projectile | null;
  /** 装填中的球 + 后续预览（第 0 个是当前可发射的）。 */
  readonly queue: readonly MarbleColor[];
  readonly aimAngle: number;
  readonly score: number;
  /** 当前连锁层级（0 = 无连锁在进行）。 */
  readonly combo: number;
  readonly shotsFired: number;
  readonly hits: number;
  readonly elapsedMs: number;
  /** 链上剩余球数。 */
  readonly remaining: number;
  /** 链头弧长。 */
  readonly headDist: number;
  /** 链的运动方向（倒退段为 -1）。 */
  readonly direction: 1 | -1;
  readonly bursts: readonly Burst[];
  readonly radius: number;
  readonly trackLength: number;
  /** 过关结算分；未结算为 `null`。 */
  readonly settled: number | null;
}

/** 构造选项。 */
export interface ZumaOptions {
  /** 起始关卡 id，默认 1。 */
  readonly level?: number;
  readonly rng?: RandomSource;
  /** 不传或传 `null` 表示完全不碰存储（适合单测与 SSR）。 */
  readonly storage?: StorageLike | null;
  readonly saveKey?: string;
  readonly bestKey?: string;
  /** 毫秒时钟，默认 `Date.now`（用于节流自动存档）。 */
  readonly clock?: () => number;
  /** 轨道采样密度，默认沿用 `sampleTrack` 的 24。 */
  readonly samplesPerSegment?: number;
  /** 开局时若有存档就接着玩，默认 `false`。 */
  readonly resumeSaved?: boolean;
  /** 自动存档节流毫秒，0 = 只在暂停/结算时存。默认 2000。 */
  readonly autosaveMs?: number;
  /** 爆点在屏幕上停留的毫秒数，默认 420。 */
  readonly burstMs?: number;
}

/** 固定物理步长（毫秒）= 120Hz，比最高刷新率还细，保证跨设备一致。 */
const PHYSICS_STEP_MS = 1000 / 120;

/** 单次 `tick` 最多追进这么多步：切后台回来不会瞬移（≈ 0.2 秒游戏时间）。 */
const MAX_STEPS_PER_TICK = 24;

/** 判定「紧贴」的容差。 */
const GAP_EPS = 1e-9;

/** 弹球飞出世界时的销毁边距（世界单位）。 */
const LOST_MARGIN = 40;

function defaultRandom(): number {
  return Math.random();
}

/** 链上是否还有空隙（有空隙说明连锁还在进行中，不能清零 combo）。 */
function hasAnyGap(chain: Chain): boolean {
  for (let i = 0; i < chain.marbles.length - 1; i += 1) {
    if (gapAfter(chain, i) > GAP_EPS) return true;
  }
  return false;
}

/** 把 run 列表展平成逐颗球的爆点。 */
function burstsFromRuns(
  runs: readonly MatchRun[],
  chain: Chain,
  atMs: number,
  combo: number,
  startId: number
): { list: Burst[]; nextId: number } {
  const list: Burst[] = [];
  let id = startId;
  for (const run of runs) {
    for (let i = run.from; i <= run.to; i += 1) {
      const marble = chain.marbles[i];
      if (!marble) continue;
      list.push({ id, color: marble.color, dist: marble.dist, atMs, combo, runLength: run.length });
      id += 1;
    }
  }
  return { list, nextId: id };
}

/** 一局祖玛。 */
export class Zuma {
  private readonly rng: RandomSource;
  private readonly storage: StorageLike | null;
  private readonly saveKey: string;
  private readonly bestKey: string;
  private readonly clock: () => number;
  private readonly samplesPerSegment: number | undefined;
  private readonly autosaveMs: number;
  private readonly burstMs: number;

  private spec: LevelSpec;
  private track: Track;
  private steps: readonly RewindStep[] = [];
  private spacing: number;
  /** 弹球出界判定用的包围盒，随关卡建一次，别每帧重算。 */
  private outBounds: Bounds;

  private state: ZumaState;
  private nextId: MarbleId = 0;
  private burstSeq = 0;
  private rewind: RewindState = INITIAL_REWIND_STATE;
  private accumulator = 0;
  private lastAutosaveAt = 0;
  private best: SerializedBest = emptyBest();
  private readonly listeners = new Set<(state: ZumaState) => void>();

  constructor(options: ZumaOptions = {}) {
    this.rng = options.rng ?? defaultRandom;
    this.storage = options.storage ?? null;
    this.saveKey = options.saveKey ?? DEFAULT_SAVE_KEY;
    this.bestKey = options.bestKey ?? DEFAULT_BEST_KEY;
    this.clock = options.clock ?? Date.now;
    this.samplesPerSegment = options.samplesPerSegment;
    this.autosaveMs = options.autosaveMs ?? 2000;
    this.burstMs = options.burstMs ?? 420;

    if (this.storage) {
      this.best = loadBest(this.storage, this.bestKey) ?? emptyBest();
    }

    const saved = this.storage ? loadSave(this.storage, this.saveKey) : null;
    const requested = options.resumeSaved && saved ? saved.level : (options.level ?? 1);

    // 占位初始化：beginLevel() 会立刻覆盖，构造期不允许有半个状态可用。
    this.spec = levelById(requested);
    this.track = buildTrack(this.spec);
    this.spacing = spacingOf(this.spec);
    this.outBounds = boundsOf(this.track, LOST_MARGIN + this.spec.radius);
    this.state = blankState(this.spec, this.track, this.spacing);
    this.beginLevelInternal(requested, options.resumeSaved ? saved : null);
  }

  // ------------------------------------------------------------------ 查询

  /** 当前状态快照（引用不变直到下一次变化；`subscribe` 推的就是它）。 */
  getState(): ZumaState {
    return this.state;
  }

  getSpec(): LevelSpec {
    return this.spec;
  }

  getTrack(): Track {
    return this.track;
  }

  /** 轨道包围盒（额外含球半径余量），渲染做世界→画布映射要用。 */
  getBounds(padding = 0): Bounds {
    return boundsOf(this.track, padding + this.spec.radius);
  }

  getLauncher(): Vec2 {
    return this.spec.launcher;
  }

  /** 某关最高分（没有则 0）。 */
  getBestScore(level: number = this.state.level): number {
    return this.best.scores[String(level)] ?? 0;
  }

  /** 已解锁到第几关（封顶在关卡总数）。 */
  getUnlockedLevel(): number {
    return Math.min(this.best.unlocked, LEVELS.length);
  }

  getBest(): SerializedBest {
    return this.best;
  }

  hasSave(): boolean {
    return this.storage ? loadSave(this.storage, this.saveKey) !== null : false;
  }

  /** 订阅状态变化，返回退订函数。 */
  subscribe(listener: (state: ZumaState) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  // ------------------------------------------------------------------ 输入

  /** 设置瞄准角（弧度）。非局中或数值非法返回 `false`，不改状态。 */
  aim(angle: number): boolean {
    if (!Number.isFinite(angle)) return false;
    if (this.state.phase !== 'playing') return false;
    if (this.state.aimAngle === angle) return false;
    this.publish({ aimAngle: angle });
    return true;
  }

  /** 瞄准一个世界坐标点（触控层把手指位置换算成角度）。 */
  aimAt(point: Vec2): boolean {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return false;
    const origin = this.spec.launcher;
    return this.aim(Math.atan2(point.y - origin.y, point.x - origin.x));
  }

  /**
   * 发射当前装填的球。
   *
   * 一切拒绝情况都返回 `false` 而不抛错：连点、结算屏上点、上一发还在飞——都是 UI 的正常
   * 输入。命中与消合在后续 `tick` 里结算。
   */
  shoot(): boolean {
    if (this.state.phase !== 'playing') return false;
    if (this.state.projectile) return false;
    const color = this.state.queue[0];
    if (color === undefined) return false;

    const projectile = fire({
      id: this.nextId++,
      color,
      origin: this.spec.launcher,
      angle: this.state.aimAngle,
      speed: this.shooterSpeed()
    });
    this.publish({
      projectile,
      queue: this.refillQueue(this.state.queue.slice(1)),
      shotsFired: this.state.shotsFired + 1
    });
    return true;
  }

  /**
   * 推进 `dtMs` 毫秒的游戏时间。
   *
   * `dtMs` 必须是 ≥ 0 的有限数（NaN 会永久毒化状态，属于调用方 bug，直接抛）。
   */
  tick(dtMs: number): void {
    if (!Number.isFinite(dtMs) || dtMs < 0) {
      throw new RangeError(`dtMs 必须是 ≥ 0 的有限数，收到 ${dtMs}`);
    }
    if (this.state.phase !== 'playing' || dtMs === 0) return;

    this.accumulator += dtMs;
    let budget = MAX_STEPS_PER_TICK;
    while (this.accumulator >= PHYSICS_STEP_MS && budget > 0) {
      this.accumulator -= PHYSICS_STEP_MS;
      budget -= 1;
      this.step(PHYSICS_STEP_MS);
      if (this.state.phase !== 'playing') {
        this.accumulator = 0;
        break;
      }
    }
    // 步数预算用完仍有余量：丢掉多余时间。宁可慢一点，也不要一帧瞬移到洞口。
    if (budget === 0) {
      this.accumulator = this.accumulator % PHYSICS_STEP_MS;
    }
    this.maybeAutosave();
  }

  // ------------------------------------------------------------------ 生命周期

  /** 开始指定关卡（丢掉当前局）。 */
  start(level: number = this.state.level): void {
    this.beginLevelInternal(level, null);
  }

  /** 重玩本关。 */
  restart(): void {
    this.beginLevelInternal(this.state.level, null);
  }

  /** 进入下一关；已是最后一关则重开最后一关。 */
  next(): void {
    this.beginLevelInternal(Math.min(this.state.level + 1, LEVELS.length), null);
  }

  pause(): void {
    if (this.state.phase !== 'playing') return;
    this.publish({ phase: 'paused' });
    this.save();
  }

  resume(): void {
    if (this.state.phase !== 'paused') return;
    this.accumulator = 0;
    this.lastAutosaveAt = this.clock();
    this.publish({ phase: 'playing' });
  }

  /** 暂停 / 恢复切换（触控 HUD 单按钮语义），返回新阶段。 */
  togglePause(): GamePhase {
    if (this.state.phase === 'playing') this.pause();
    else if (this.state.phase === 'paused') this.resume();
    return this.state.phase;
  }

  /** 写入局中快照；没注入存储时返回 `false`。 */
  save(): boolean {
    if (!this.storage) return false;
    const payload: SerializedSave = {
      v: SAVE_VERSION,
      level: this.state.level,
      score: this.state.score,
      // 只存颜色序列；重建时按紧贴排布（残留空隙不保留，换取格式简单稳定）。
      marbles: [...this.state.chain.marbles].reverse().map((m) => m.color),
      headDist: this.state.headDist,
      elapsedMs: this.state.elapsedMs,
      shotsFired: this.state.shotsFired,
      hits: this.state.hits
    };
    return writeJson(this.storage, this.saveKey, payload);
  }

  /** 读回存档并接管本局；没有可恢复内容返回 `false` 且保持现状。 */
  load(): boolean {
    if (!this.storage) return false;
    const saved = loadSave(this.storage, this.saveKey);
    if (!saved) return false;
    this.beginLevelInternal(saved.level, saved);
    return true;
  }

  /** 抹掉局中快照（荣誉榜不动）。 */
  clearSave(): void {
    if (!this.storage) return;
    try {
      this.storage.removeItem?.(this.saveKey);
    } catch {
      // 删不掉就算了，下次读到也由守卫挡下来
    }
  }

  // ------------------------------------------------------------------ 内部

  /** 弹球飞行速度：远快于链，且随关卡略微递增（后期链更快，弹速要跟上）。 */
  private shooterSpeed(): number {
    return 900 + this.spec.id * 25;
  }

  private beginLevelInternal(level: number, saved: SerializedSave | null): void {
    this.spec = levelById(level);
    this.track = buildTrack(
      this.spec,
      this.samplesPerSegment === undefined ? {} : { samplesPerSegment: this.samplesPerSegment }
    );
    this.spacing = spacingOf(this.spec);
    this.steps = rewindSchedule(this.spec.rewind, this.track.length);
    this.outBounds = boundsOf(this.track, LOST_MARGIN + this.spec.radius);
    this.rewind = INITIAL_REWIND_STATE;
    this.accumulator = 0;
    this.nextId = 0;
    this.burstSeq = 0;
    this.lastAutosaveAt = this.clock();

    const useSave = saved && saved.level === this.spec.id ? saved : null;
    const colors = useSave
      ? [...useSave.marbles]
      : generateMarbleColors(this.spec, this.rng);
    const headDist = useSave
      ? useSave.headDist
      : (this.spec.marbles - 1) * this.spacing;

    const chain = createChain([...colors].reverse(), {
      spacing: this.spacing,
      headDist,
      startId: this.nextId
    });
    this.nextId += chain.marbles.length;

    this.state = {
      phase: 'playing',
      level: this.spec.id,
      chain,
      projectile: null,
      queue: this.freshQueue(),
      aimAngle: -Math.PI / 2,
      score: useSave?.score ?? 0,
      combo: 0,
      shotsFired: useSave?.shotsFired ?? 0,
      hits: useSave?.hits ?? 0,
      elapsedMs: useSave?.elapsedMs ?? 0,
      remaining: chain.marbles.length,
      headDist: chain.marbles.length ? headDist : 0,
      direction: 1,
      bursts: [],
      radius: this.spec.radius,
      trackLength: this.track.length,
      settled: null
    };
    this.emit();
  }

  /** 造一条新的装填队列。 */
  private freshQueue(): MarbleColor[] {
    const out: MarbleColor[] = [];
    for (let i = 0; i < this.spec.nextQueue; i += 1) {
      out.push(this.pickColor());
    }
    return out;
  }

  /** 从当前关卡调色板等概率取一色。 */
  private pickColor(): MarbleColor {
    const palette = paletteFor(this.spec.colors);
    const index = Math.min(palette.length - 1, Math.floor(this.rng() * palette.length));
    return palette[index]!;
  }

  private refillQueue(queue: readonly MarbleColor[]): MarbleColor[] {
    const out = [...queue];
    while (out.length < this.spec.nextQueue) {
      out.push(this.pickColor());
    }
    return out;
  }

  /** 一个固定步长的世界推进。 */
  private step(dtMs: number): void {
    const seconds = dtMs / 1000;
    const base = this.state;
    const speed = speedAt(this.spec, (base.elapsedMs + dtMs) / 1000);
    const deltaScale = speed * seconds;

    // 1. 链前进 / 倒退。
    //    倒退不做「尾球不得越过生成口」的钳制：原版祖玛里彩球是从入口进出的一条长龙，
    //    倒退段就是把后段吸回入口外（`dist < 0`），渲染层按「不上屏」处理即可。
    //    一旦在这里钳死，倒退段就永远走不完，整关卡在 -1 方向上出不来。
    const decision = decideAdvance(this.steps, base.headDist, this.rewind);
    this.rewind = decision.state;
    const delta = speed * seconds * decision.direction;
    let chain = advanceChain(base.chain, delta);
    let headDist = base.headDist + delta;

    // 2. 后段以链速追近，收拢消合留下的空隙
    chain = closeGaps(chain, deltaScale);

    // 3. 弹球扫掠与插入
    let projectile = base.projectile;
    let hits = base.hits;
    let score = base.score;
    let combo = base.combo;
    let bursts = base.bursts;

    if (projectile) {
      const swept = sweepProjectile(projectile, dtMs, chain, this.track, this.spec.radius);
      if (swept.hit) {
        score += farShotPoints(swept.hit.travelDistance);
        chain = insertMarble(chain, {
          dist: swept.hit.insertDist,
          color: projectile.color,
          id: this.nextId++
          // 刻意不传 minDist：入口方向始终有空间（尾球可以被顶回入口外），
          // 因此不需要「挤不动就把整条链往洞口拱」的补偿规则。
        });
        projectile = null;
        hits += 1;
      } else if (this.isOutOfBounds(swept.projectile.pos)) {
        projectile = null; // 飞出世界，这一发就消耗掉了
      } else {
        projectile = swept.projectile;
      }
    }

    // 4. 消合检测（含空隙闭合后涌现的连锁）
    const runs = findRuns(chain);
    if (runs.length > 0) {
      combo += 1;
      for (const run of runs) {
        score += scoreMatch(run.length, combo);
      }
      const made = burstsFromRuns(runs, chain, base.elapsedMs + dtMs, combo, this.burstSeq);
      this.burstSeq = made.nextId;
      bursts = [...bursts, ...made.list];
      chain = removeRuns(chain, runs);
    } else if (!hasAnyGap(chain)) {
      combo = 0;
    }

    // 5. 爆点老化
    const elapsedMs = base.elapsedMs + dtMs;
    if (bursts.length > 0) {
      const alive = bursts.filter((b) => elapsedMs - b.atMs < this.burstMs);
      if (alive.length !== bursts.length) bursts = alive;
    }

    // 6. 胜负判定
    let phase: GamePhase = 'playing';
    let settled: number | null = null;
    if (chain.marbles.length === 0) {
      phase = 'won';
      settled = clearBonus(0, base.shotsFired, hits);
      score += settled;
    } else if (headDist >= this.track.length) {
      phase = 'lost';
      settled = 0;
    }

    this.state = {
      ...base,
      phase,
      chain,
      projectile,
      score,
      combo,
      hits,
      elapsedMs,
      remaining: chain.marbles.length,
      headDist,
      direction: decision.direction,
      bursts,
      settled
    };
    this.emit();

    if (phase !== 'playing') this.finishGame(phase, score);
  }

  /** 弹球是否已飞出本关包围盒。 */
  private isOutOfBounds(point: Vec2): boolean {
    const b = this.outBounds;
    return point.x < b.minX || point.x > b.maxX || point.y < b.minY || point.y > b.maxY;
  }

  /** 局末：过关记最高分并清掉局中快照；失败留快照便于「接着玩」。 */
  private finishGame(phase: GamePhase, score: number): void {
    if (!this.storage) return;
    if (phase === 'won') {
      this.best = recordBest(this.best, this.spec.id, score);
      writeJson(this.storage, this.bestKey, this.best);
      this.clearSave();
    } else {
      this.save();
    }
  }

  private maybeAutosave(): void {
    if (!this.storage || this.autosaveMs <= 0) return;
    const now = this.clock();
    if (now - this.lastAutosaveAt < this.autosaveMs) return;
    this.lastAutosaveAt = now;
    this.save();
  }

  private publish(patch: Partial<ZumaState>): void {
    this.state = { ...this.state, ...patch };
    this.emit();
  }

  private emit(): void {
    // 冻结快照本身（浅层）：适配层拿到的是同一引用，误改要立刻炸而不是悄悄污染状态。
    const snapshot = Object.isFrozen(this.state) ? this.state : Object.freeze(this.state);
    this.state = snapshot;
    for (const listener of this.listeners) listener(snapshot);
  }
}

/** 构造期与「空局」共用的零状态。 */
function blankState(spec: LevelSpec, track: Track, spacing: number): ZumaState {
  return {
    phase: 'ready',
    level: spec.id,
    chain: { spacing, marbles: [] },
    projectile: null,
    queue: [],
    aimAngle: -Math.PI / 2,
    score: 0,
    combo: 0,
    shotsFired: 0,
    hits: 0,
    elapsedMs: 0,
    remaining: 0,
    headDist: 0,
    direction: 1,
    bursts: [],
    radius: spec.radius,
    trackLength: track.length,
    settled: null
  };
}

/** 便捷：把某颗球换算成世界姿态（渲染层逐个调用）。 */
export function marblePose(track: Track, marble: Marble): { x: number; y: number; angle: number } {
  return poseAt(track, marble.dist);
}

/** 便捷：弹球飞行方向角（画拖尾用）。 */
export function flightAngle(projectile: Projectile): number {
  return projectileAngle(projectile);
}

/** 便捷：不依赖真实时间，把游戏推进 N 个固定步（测试与回放用）。 */
export function advanceBy(game: Zuma, steps: number): void {
  if (!Number.isInteger(steps) || steps < 0) {
    throw new RangeError(`steps 必须是 ≥ 0 的整数，收到 ${steps}`);
  }
  for (let i = 0; i < steps; i += 1) {
    game.tick(PHYSICS_STEP_MS);
  }
}

/** 物理常量导出，别处不要自行硬编码。 */
export const PHYSICS = {
  STEP_MS: PHYSICS_STEP_MS,
  MAX_STEPS_PER_TICK
} as const;
