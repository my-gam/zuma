/**
 * `useGame` —— Vue 3 组合式接入点：持有引擎实例 + 响应式快照 + 操作 API。
 *
 * 职责边界（与 sudoku 同款）：这里**只管引擎生命周期与状态**，不碰 canvas、不建
 * `requestAnimationFrame`、不绑指针 —— 那些属于组件（`GameZuma.vue`），因为它们的
 * 生命周期跟着 DOM 元素走，而 `useGame()` 也允许宿主自己画。
 *
 * 快照一律走 `shallowRef`：一帧一个 60+ 颗球的对象，深度响应化会让 Vue 递归遍历整棵树，
 * 白白吃掉 60fps 的预算；状态不可变性由 core 保证，浅层引用比较就足够。
 */
import { onScopeDispose, shallowRef, type ShallowRef } from 'vue';
import type { MarbleColor, RandomSource, StorageLike, ZumaState } from '@my-games/zuma-core';
import { LEVEL_COUNT, Zuma } from '@my-games/zuma-core';

/** `useGame` 的选项。 */
export interface UseGameOptions {
  /** 起始关卡 id（1..`LEVEL_COUNT`），默认 1。 */
  readonly level?: number;
  /** 是否用 `localStorage` 持久化（默认 `true`；SSR / 隐私模式下自动降级为不持久）。 */
  readonly persistent?: boolean;
  /** 有存档时接着玩而不是重开。 */
  readonly resumeSaved?: boolean;
  /** 注入随机源，用于可复现的回放或测试。 */
  readonly rng?: RandomSource;
  /** 自动存档节流毫秒，0 = 只在暂停/结算时存。 */
  readonly autosaveMs?: number;
}

/** `useGame` 的返回值。 */
export interface UseGameReturn {
  /** 当前快照；构造完成前为 `null`。 */
  readonly state: ShallowRef<ZumaState | null>;
  /** 取底层引擎（需要更细的控制时用，比如自绘或写测试）。 */
  getGame(): Zuma | null;
  start(level?: number): void;
  restart(): void;
  next(): void;
  pause(): void;
  resume(): void;
  togglePause(): void;
  shoot(): boolean;
  aim(angle: number): boolean;
  aimAtWorld(point: { x: number; y: number }): boolean;
  save(): boolean;
  load(): boolean;
  clearSave(): boolean;
  hasSave(): boolean;
  bestScore(level?: number): number;
  unlockedLevel(): number;
  queueColors(): readonly MarbleColor[];
  levelCount(): number;
}

/**
 * 拿一个可用的 `localStorage`。
 *
 * 隐私模式 / 被禁用的站点会**在属性访问时就抛**，所以整段包 try；拿不到就返回 `null`，
 * 游戏照常能玩，只是关掉页面不记进度。
 */
function tryLocalStorage(): StorageLike | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    // 摸一下才知道有没有权限（Safari 无痕下 getItem 直接抛）
    const probe = '__zuma_probe__';
    window.localStorage.setItem(probe, '1');
    window.localStorage.removeItem(probe);
    return window.localStorage;
  } catch {
    return null;
  }
}

/** 在组件（或任意 effect scope）里创建一个引擎绑定。 */
export function useGame(options: UseGameOptions = {}): UseGameReturn {
  const state = shallowRef<ZumaState | null>(null);
  const persistent = options.persistent ?? true;
  const storage = persistent ? tryLocalStorage() : null;

  const game = new Zuma({
    level: options.level ?? 1,
    storage,
    resumeSaved: options.resumeSaved,
    rng: options.rng,
    autosaveMs: options.autosaveMs
  });

  const unsubscribe = game.subscribe((snapshot) => {
    state.value = snapshot;
  });
  state.value = game.getState();

  onScopeDispose(() => {
    unsubscribe();
  });

  return {
    state,
    getGame: () => game,
    start: (level?: number) => game.start(level ?? game.getState().level),
    restart: () => game.restart(),
    next: () => game.next(),
    pause: () => game.pause(),
    resume: () => game.resume(),
    togglePause: () => game.togglePause(),
    shoot: () => game.shoot(),
    aim: (angle: number) => game.aim(angle),
    aimAtWorld: (point) => game.aimAt(point),
    save: () => game.save(),
    load: () => game.load(),
    clearSave: () => {
      game.clearSave();
      return !game.hasSave();
    },
    hasSave: () => game.hasSave(),
    bestScore: (level?: number) => game.getBestScore(level),
    unlockedLevel: () => game.getUnlockedLevel(),
    queueColors: () => game.getState().queue,
    levelCount: () => LEVEL_COUNT
  };
}
