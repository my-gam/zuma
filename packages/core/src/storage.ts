/**
 * 存档 —— 键名、版本、类型守卫与迁移，全部与合集约定对齐（2048 / sudoku 同款）。
 *
 * 三类数据各自独立，避免「一坏全坏」：
 *
 * - `game-zuma:save` —— **局中快照**，用来接着玩（关卡、分数、链上颜色、进度）。
 * - `game-zuma:best`  —— **荣誉榜**，每关最高分与解锁到第几关。
 *
 * 纪律：
 *
 * 1. 一切外部数据都当不可信处理。localStorage 可能被别的站点、旧版本、甚至手改污染，
 *    所以读出来先过类型守卫，不合法就**丢弃并回落到默认值**，绝不让引擎崩在存档上。
 * 2. `v` 字段是格式版本。将来结构变了要写 `migrate()`，把老版本抬上来，
 *    而不是改键名（改键名等于丢掉所有人的进度）。
 * 3. 存储本体由宿主注入（`StorageLike`），core 不假设 `window` 存在，
 *    Node/SSR/测试里换 `createMemoryStorage()` 即可用。
 */
import type { MarbleColor } from './types';
import { isMarbleColor } from './types';

/** 局中快照的存档键。 */
export const DEFAULT_SAVE_KEY = 'game-zuma:save';

/** 最佳成绩表的存档键。 */
export const DEFAULT_BEST_KEY = 'game-zuma:best';

/** 当前存档格式版本。 */
export const SAVE_VERSION = 1;

/** 宿主提供的最小存储面（`localStorage` 天然满足）。 */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

/** 局中快照。链只存颜色序列 —— 位置可由 `headDist + spacing` 完整重建。 */
export interface SerializedSave {
  readonly v: number;
  /** 所在关卡 id（1 起）。 */
  readonly level: number;
  readonly score: number;
  /** 链上颜色，**从链头到链尾**。 */
  readonly marbles: readonly MarbleColor[];
  /** 链头弧长位置。 */
  readonly headDist: number;
  /** 本关已用时（毫秒）。 */
  readonly elapsedMs: number;
  readonly shotsFired: number;
  readonly hits: number;
}

/** 荣誉榜。 */
export interface SerializedBest {
  readonly v: number;
  /** 解锁到第几关（1 起，表示「可以玩到这一关」）。 */
  readonly unlocked: number;
  /** 关卡 id → 该关最高分。 */
  readonly scores: Readonly<Record<string, number>>;
}

/** 空快照（读不到或读坏时的回落值）。 */
export function emptySave(level: number): SerializedSave {
  return {
    v: SAVE_VERSION,
    level,
    score: 0,
    marbles: [],
    headDist: 0,
    elapsedMs: 0,
    shotsFired: 0,
    hits: 0
  };
}

/** 空荣誉榜。 */
export function emptyBest(): SerializedBest {
  return { v: SAVE_VERSION, unlocked: 1, scores: {} };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPositiveInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1;
}

function isNonNegativeFinite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

/** 局中快照的类型守卫（含颜色逐颗校验）。 */
export function isSerializedSave(value: unknown): value is SerializedSave {
  if (!isRecord(value)) return false;
  if (value.v !== SAVE_VERSION) return false;
  if (!isPositiveInt(value.level)) return false;
  if (!isNonNegativeFinite(value.score)) return false;
  if (!isNonNegativeFinite(value.headDist)) return false;
  if (!isNonNegativeFinite(value.elapsedMs)) return false;
  if (!isNonNegativeFinite(value.shotsFired)) return false;
  if (!isNonNegativeFinite(value.hits)) return false;
  if (!Array.isArray(value.marbles)) return false;
  return value.marbles.every(isMarbleColor);
}

/** 荣誉榜的类型守卫。 */
export function isSerializedBest(value: unknown): value is SerializedBest {
  if (!isRecord(value)) return false;
  if (value.v !== SAVE_VERSION) return false;
  if (!isPositiveInt(value.unlocked)) return false;
  if (!isRecord(value.scores)) return false;
  return Object.values(value.scores).every(isNonNegativeFinite);
}

/**
 * 版本迁移入口：把任意原始对象抬到当前版本，抬不动返回 `null`（调用方回落默认值）。
 *
 * 现在只有 v1；将来加 v2 时在这里逐级 `if (v === 1) { …; v = 2 }` 往上抬，
 * 保持「老存档只丢字段、不丢进度」。
 */
export function migrate(raw: unknown): unknown | null {
  if (!isRecord(raw)) return null;
  if (raw.v === SAVE_VERSION) return raw;
  return null; // 未来版本的存档：认不出来就当没有，好过用错格式写出脏数据
}

function readText(storage: StorageLike, key: string): string | null {
  // 隐私模式 / 被冻结的 localStorage 会在 getItem 时就抛，这里一并兜住：
  // 读不到就当没有存档，绝不让引擎崩在存档上。
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

function parse(text: string | null): unknown | null {
  if (text === null || text === '') return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null; // 手改过的非法 JSON 很常见，静默当没有
  }
}

/** 读局中快照；任何不合法（缺键 / 坏 JSON / 旧版本 / 字段脏 / 宿主抛错）都返回 `null`。 */
export function loadSave(storage: StorageLike, key: string = DEFAULT_SAVE_KEY): SerializedSave | null {
  const migrated = migrate(parse(readText(storage, key)));
  return isSerializedSave(migrated) ? migrated : null;
}

/** 读荣誉榜，同上。 */
export function loadBest(
  storage: StorageLike,
  key: string = DEFAULT_BEST_KEY
): SerializedBest | null {
  const migrated = migrate(parse(readText(storage, key)));
  return isSerializedBest(migrated) ? migrated : null;
}

/**
 * 写入。存储可能因为隐私模式、配额、被宿主冻结而抛错 —— 一律吞掉：
 * 存档失败绝不该打断一局游戏。
 */
export function writeJson(storage: StorageLike, key: string, value: unknown): boolean {
  try {
    storage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

/** 删键（无 `removeItem` 的宿主退化成写入空串）。 */
export function clearKey(storage: StorageLike, key: string): void {
  try {
    if (storage.removeItem) {
      storage.removeItem(key);
    } else {
      storage.setItem(key, '');
    }
  } catch {
    // 删不掉就算了，下次读到时守卫会挡
  }
}

/** 把最高分表里某关的分数抬到 `max(旧值, 新值)`，返回新对象（不改入参）。 */
export function recordBest(best: SerializedBest, level: number, score: number): SerializedBest {
  const previous = best.scores[String(level)] ?? 0;
  return {
    v: SAVE_VERSION,
    unlocked: Math.max(best.unlocked, level),
    scores: { ...best.scores, [String(level)]: Math.max(previous, score) }
  };
}

/**
 * 内存存储：测试、SSR、以及「宿主没开 localStorage」时的兜底。
 * 语义与 Web Storage 一致（读不到的键返回 `null`，值一律字符串）。
 */
export function createMemoryStorage(initial: Readonly<Record<string, string>> = {}): StorageLike {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key) => (map.has(key) ? (map.get(key) as string) : null),
    setItem: (key, value) => {
      map.set(key, String(value));
    },
    removeItem: (key) => {
      map.delete(key);
    }
  };
}
