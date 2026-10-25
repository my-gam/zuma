/**
 * `useGame` —— React 18/19 接入点：持有引擎 + 一份**节流过**的 HUD 快照 + 操作 API。
 *
 * 为什么 React 版要节流而 Vue 版不用：引擎每步（120Hz）都发一个新快照。Canvas 是命令式
 * 绘制，直接在 rAF 里读 `game.getState()` 就行，根本不需要经过 React；但如果把每份快照都
 * `setState`，就是每秒 120 次整树重渲染，手机上白热化还掉帧。所以这里把 DOM 侧的更新限到
 * ~10Hz，**只在阶段变化时立刻更新**（暂停/过关/失败必须马上看到）。
 * Vue 版靠细粒度响应式 + 小模板能扛住逐帧更新，两套适配层的观感因此保持一致。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MarbleColor, RandomSource, ZumaState } from '@my-games/zuma-core';
import { LEVEL_COUNT, Zuma } from '@my-games/zuma-core';

/** `useGame` 的选项。 */
export interface UseGameOptions {
  readonly level?: number;
  /** 用 localStorage 记进度与最高分（SSR / 隐私模式自动降级）。 */
  readonly persistent?: boolean;
  readonly resumeSaved?: boolean;
  readonly rng?: RandomSource;
  readonly autosaveMs?: number;
  /** HUD 刷新间隔毫秒，默认 100（10Hz）。 */
  readonly hudThrottleMs?: number;
}

/** `useGame` 的返回值。 */
export interface UseGameReturn {
  /** 节流后的快照，给 JSX 用（canvas 不要用它的值来绘制）。 */
  readonly state: ZumaState | null;
  /** 底层引擎；rAF 循环应当每帧从它读最新状态。 */
  readonly game: Zuma;
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
  clearSave(): void;
  hasSave(): boolean;
  bestScore(level?: number): number;
  unlockedLevel(): number;
  queueColors(): readonly MarbleColor[];
  levelCount(): number;
}

/** 探一下 `localStorage` 能不能用（Safari 无痕下访问就抛）。 */
function tryLocalStorage(): Storage | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    const probe = '__zuma_probe__';
    window.localStorage.setItem(probe, '1');
    window.localStorage.removeItem(probe);
    return window.localStorage;
  } catch {
    return null;
  }
}

/** 创建一个与组件同生命周期的引擎绑定。 */
export function useGame(options: UseGameOptions = {}): UseGameReturn {
  const {
    level = 1,
    persistent = true,
    resumeSaved = false,
    rng,
    autosaveMs,
    hudThrottleMs = 100
  } = options;

  // 引擎只在首次挂载时建一次；参数变化通过下面的显式方法驱动，不做「重建」——
  // 重建会把进度、随机序列与存档节流状态一起丢掉。
  const game = useMemo(
    () =>
      new Zuma({
        level,
        storage: persistent ? tryLocalStorage() : null,
        resumeSaved,
        rng,
        autosaveMs
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const [state, setState] = useState<ZumaState | null>(() => game.getState());
  const lastPublish = useRef(0);
  const lastPhase = useRef(state?.phase);

  useEffect(() => {
    const unsubscribe = game.subscribe((snapshot) => {
      const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
      const phaseChanged = snapshot.phase !== lastPhase.current;
      if (!phaseChanged && now - lastPublish.current < hudThrottleMs) return;
      lastPublish.current = now;
      lastPhase.current = snapshot.phase;
      setState(snapshot);
    });
    // 订阅前先推一次，保证节流窗口内也不会出现空白 HUD。
    setState(game.getState());
    return unsubscribe;
  }, [game, hudThrottleMs]);

  useEffect(() => {
    return () => game.pause();
  }, [game]);

  const start = useCallback((target?: number) => game.start(target), [game]);
  const restart = useCallback(() => game.restart(), [game]);
  const next = useCallback(() => game.next(), [game]);
  const pause = useCallback(() => game.pause(), [game]);
  const resume = useCallback(() => game.resume(), [game]);
  const togglePause = useCallback(() => game.togglePause(), [game]);
  const shoot = useCallback(() => game.shoot(), [game]);
  const aim = useCallback((angle: number) => game.aim(angle), [game]);
  const aimAtWorld = useCallback((point: { x: number; y: number }) => game.aimAt(point), [game]);
  const save = useCallback(() => game.save(), [game]);
  const load = useCallback(() => game.load(), [game]);
  const clearSave = useCallback(() => game.clearSave(), [game]);
  const hasSave = useCallback(() => game.hasSave(), [game]);
  const bestScore = useCallback((target?: number) => game.getBestScore(target), [game]);
  const unlockedLevel = useCallback(() => game.getUnlockedLevel(), [game]);
  const queueColors = useCallback(() => game.getState().queue, [game]);

  return {
    state,
    game,
    start,
    restart,
    next,
    pause,
    resume,
    togglePause,
    shoot,
    aim,
    aimAtWorld,
    save,
    load,
    clearSave,
    hasSave,
    bestScore,
    unlockedLevel,
    queueColors,
    levelCount: () => LEVEL_COUNT
  };
}
