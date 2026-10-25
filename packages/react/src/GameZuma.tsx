/**
 * `GameZuma` —— React 组件形态的祖玛。
 *
 * 与 Vue 版同一套分工：引擎与状态在 `useGame`，本文件负责建 canvas、按 devicePixelRatio
 * 贴合容器、跑 `requestAnimationFrame`、把指针位置换算成世界坐标。**绘制一行都不在这里**，
 * 全部交给 core 的 `drawScene`，所以两个框架的观感逐像素一致。
 *
 * 循环里读的是 `game.getState()`（每帧最新），不是节流过的 React state —— HUD 慢一拍无所谓，
 * 画面慢一拍就是掉帧。
 *
 * 触控方案与 Vue 版相同：按下 / 拖动定角，松手才发射。键盘补上桌面端操作。
 */
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent
} from 'react';
import {
  DEFAULT_STYLE,
  LEVELS,
  LEVEL_COUNT,
  createView,
  drawScene,
  type Vec2,
  type View
} from '@my-games/zuma-core';
import '@my-games/zuma-core/style.css';
import { useGame } from './useGame';

/** 通过 `ref` 暴露给宿主的操作句柄。 */
export interface GameZumaHandle {
  getState(): ReturnType<typeof useGame>['state'];
  aim(angle: number): boolean;
  aimAt(point: { x: number; y: number }): boolean;
  shoot(): boolean;
  start(level?: number): void;
  restart(): void;
  next(): void;
  pause(): void;
  resume(): void;
  togglePause(): void;
  save(): boolean;
  load(): boolean;
  bestScore(level?: number): number;
  unlockedLevel(): number;
  queue(): readonly string[];
  resize(): void;
}

export interface GameZumaProps {
  /** HUD 的无障碍标签。 */
  readonly title?: string;
  /** 起始关卡（1..12）。 */
  readonly level?: number;
  /** 用 localStorage 记进度与最高分。 */
  readonly persistent?: boolean;
  /** 有存档时接着玩。 */
  readonly resumeSaved?: boolean;
  /** 显示装填预览。 */
  readonly showQueue?: boolean;
  /** 显示关卡选择条。 */
  readonly showLevelPicker?: boolean;
  readonly className?: string;
  readonly style?: CSSProperties;
  /** 根元素的 `ref`（与命令式句柄分开，方便宿主测量容器）。 */
  readonly onRootRef?: (el: HTMLDivElement | null) => void;
  readonly onWon?: (score: number, level: number) => void;
  readonly onLost?: (score: number, level: number) => void;
  readonly onLevelChange?: (level: number) => void;
}

function formatTime(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** 组件本体。 */
export const GameZuma = forwardRef<GameZumaHandle, GameZumaProps>(function GameZuma(props, ref) {
  const {
    title = 'Zuma',
    level = 1,
    persistent = true,
    resumeSaved = false,
    showQueue = true,
    showLevelPicker = true,
    className,
    style,
    onRootRef,
    onWon,
    onLost,
    onLevelChange
  } = props;

  const engine = useGame({ level, persistent, resumeSaved });
  const { state, game } = engine;

  const stageRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const viewRef = useRef<View | null>(null);
  const sizeRef = useRef({ width: 0, height: 0 });
  const rafRef = useRef(0);
  const lastTsRef = useRef(0);
  const draggingRef = useRef(false);
  const [unlocked, setUnlocked] = useState(() => engine.unlockedLevel());

  /** 贴合容器：位图按 dpr 放大，绘制只用 CSS 像素。 */
  const resize = useCallback(() => {
    const canvas = canvasRef.current;
    const stage = stageRef.current;
    if (!canvas || !stage) return;
    const rect = stage.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    const dpr = Math.min(3, Math.max(1, window.devicePixelRatio || 1));
    sizeRef.current = { width, height };
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.getContext('2d')?.setTransform(dpr, 0, 0, dpr, 0, 0);
    viewRef.current = null;
  }, []);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const snapshot = game.getState();
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    if (!viewRef.current) {
      viewRef.current = createView(game.getBounds(16), sizeRef.current.width, sizeRef.current.height);
    }
    drawScene(
      ctx,
      { state: snapshot, track: game.getTrack(), view: viewRef.current, launcher: game.getLauncher() },
      DEFAULT_STYLE
    );
  }, [game]);

  // 渲染循环：跟着 canvas 元素的生命周期，与 React 的渲染节奏解耦。
  useEffect(() => {
    resize();
    draw();
    lastTsRef.current = 0;
    const frame = (ts: number) => {
      const dt = lastTsRef.current === 0 ? 0 : Math.max(0, ts - lastTsRef.current);
      lastTsRef.current = ts;
      game.tick(dt);
      draw();
      rafRef.current = window.requestAnimationFrame(frame);
    };
    rafRef.current = window.requestAnimationFrame(frame);

    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined' && stageRef.current) {
      observer = new ResizeObserver(() => {
        resize();
        draw();
      });
      observer.observe(stageRef.current);
    } else {
      window.addEventListener('resize', resize);
    }
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') game.pause();
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      if (rafRef.current) window.cancelAnimationFrame(rafRef.current);
      observer?.disconnect();
      window.removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [game, resize, draw]);

  // 阶段变化推给宿主（节流后的 state 足够用来判断阶段）。
  useEffect(() => {
    if (!state) return;
    if (state.phase === 'won') onWon?.(state.score, state.level);
    if (state.phase === 'lost') onLost?.(state.score, state.level);
  }, [state?.phase, state?.score, state?.level, onWon, onLost]);

  const toWorld = useCallback((clientX: number, clientY: number): Vec2 | null => {
    const canvas = canvasRef.current;
    const view = viewRef.current;
    if (!canvas || !view) return null;
    const rect = canvas.getBoundingClientRect();
    return {
      x: (clientX - rect.left - view.offsetX) / view.scale,
      y: (clientY - rect.top - view.offsetY) / view.scale
    };
  }, []);

  const handlePointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const world = toWorld(event.clientX, event.clientY);
    if (!world) return;
    draggingRef.current = true;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    game.aimAt(world);
    draw();
  };

  /**
   * 悬停即跟随瞄准（桌面端）。
   *
   * 之前只在按下后才跟随，鼠标党会觉得炮口不动、以为坏了（2026-10-25 反馈）。
   * 触屏没有 hover，依旧是「按下拖动定角、松手发射」，两种输入互不干扰。
   */
  const handlePointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const world = toWorld(event.clientX, event.clientY);
    if (!world) return;
    game.aimAt(world);
    if (draggingRef.current) draw();
  };

  const handlePointerUp = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    const world = toWorld(event.clientX, event.clientY);
    if (world) game.aimAt(world);
    game.shoot();
    draw();
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLCanvasElement>) => {
    const step = event.shiftKey ? 0.02 : 0.08;
    switch (event.key) {
      case 'ArrowLeft':
        game.aim(game.getState().aimAngle - step);
        break;
      case 'ArrowRight':
        game.aim(game.getState().aimAngle + step);
        break;
      case ' ':
      case 'Enter':
        game.shoot();
        break;
      case 'p':
      case 'P':
        game.togglePause();
        break;
      case 'r':
      case 'R':
        game.restart();
        break;
      default:
        return;
    }
    event.preventDefault();
    draw();
  };

  const selectLevel = useCallback(
    (target: number) => {
      if (target > game.getUnlockedLevel()) return;
      game.start(target);
      setUnlocked(game.getUnlockedLevel());
      onLevelChange?.(target);
      draw();
    },
    [game, onLevelChange, draw]
  );

  useImperativeHandle(
    ref,
    () => ({
      getState: () => game.getState(),
      aim: (angle) => game.aim(angle),
      aimAt: (point) => game.aimAt(point),
      shoot: () => game.shoot(),
      start: (target?: number) => game.start(target),
      restart: () => game.restart(),
      next: () => game.next(),
      pause: () => game.pause(),
      resume: () => game.resume(),
      togglePause: () => game.togglePause(),
      save: () => game.save(),
      load: () => game.load(),
      bestScore: (target?: number) => game.getBestScore(target),
      unlockedLevel: () => game.getUnlockedLevel(),
      queue: () => game.getState().queue,
      resize: () => {
        resize();
        draw();
      }
    }),
    [game, resize, draw]
  );

  const spec = LEVELS.find((item) => item.id === (state?.level ?? level));
  const overlayVisible = !!state && state.phase !== 'playing';

  return (
    <div
      ref={onRootRef}
      className={['game-zuma', className].filter(Boolean).join(' ')}
      style={style}
      data-test="zuma-root"
      aria-label={title}
    >
      <div className="game-zuma-hud">
        <span className="game-zuma-hud-item">
          <span className="game-zuma-hud-label">分数</span>
          <span className="game-zuma-hud-value" data-test="zuma-score">
            {state?.score ?? 0}
          </span>
        </span>
        <span className="game-zuma-hud-item">
          <span className="game-zuma-hud-label">关卡</span>
          <span className="game-zuma-hud-value">{state?.level ?? 0}</span>
          <span className="game-zuma-hud-label">{spec?.name}</span>
        </span>
        <span className="game-zuma-hud-item">
          <span className="game-zuma-hud-label">剩余</span>
          <span className="game-zuma-hud-value" data-test="zuma-remaining">
            {state?.remaining ?? 0}
          </span>
        </span>
        <span className="game-zuma-hud-item">
          <span className="game-zuma-hud-label">用时</span>
          <span className="game-zuma-hud-value">{formatTime(state?.elapsedMs ?? 0)}</span>
        </span>
        <span className="game-zuma-hud-item">
          <span className="game-zuma-hud-label">最佳</span>
          <span className="game-zuma-hud-value">{engine.bestScore()}</span>
        </span>
        <span
          className={`game-zuma-hud-item game-zuma-hud-combo${(state?.combo ?? 0) > 1 ? ' is-active' : ''}`}
          data-test="zuma-combo"
        >
          <span className="game-zuma-hud-label">连锁</span>
          <span className="game-zuma-hud-value">×{state?.combo ?? 0}</span>
        </span>
      </div>

      <div ref={stageRef} className="game-zuma-stage">
        <canvas
          ref={canvasRef}
          className="game-zuma-canvas"
          tabIndex={0}
          role="application"
          aria-label={`${title} 游戏画面：拖动瞄准，松手发射`}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onKeyDown={handleKeyDown}
        />
        {state && overlayVisible ? (
          <div
            className={`game-zuma-overlay is-visible${
              state.phase === 'won' ? ' is-won' : state.phase === 'lost' ? ' is-lost' : ' is-paused'
            }`}
            data-test="zuma-overlay"
          >
            <p className="game-zuma-overlay-title">
              {state.phase === 'won' ? '过关！' : state.phase === 'lost' ? '进洞了' : '已暂停'}
            </p>
            <p className="game-zuma-overlay-score">
              本关得分 {state.score}
              {state.settled ? `（含结算 ${state.settled}）` : ''}
              {state.phase === 'won' && state.level < LEVEL_COUNT && state.autoNextMs > 0
                ? ` · ${Math.max(1, Math.ceil((state.autoNextMs - state.overMs) / 1000))} 秒后自动进入下一关`
                : ''}
            </p>
            <div className="game-zuma-overlay-actions">
              {state.phase === 'paused' ? (
                <button
                  type="button"
                  className="game-zuma-button game-zuma-button-primary"
                  onClick={() => engine.resume()}
                >
                  继续
                </button>
              ) : null}
              <button type="button" className="game-zuma-button" onClick={() => engine.restart()}>
                重玩本关
              </button>
              {state.phase === 'won' && state.level < LEVEL_COUNT ? (
                <button
                  type="button"
                  className="game-zuma-button game-zuma-button-primary"
                  onClick={() => selectLevel(state.level + 1)}
                >
                  立刻下一关
                </button>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>

      {showQueue && state ? (
        <div className="game-zuma-queue" aria-label="装填预览">
          {state.queue.map((color, index) => (
            <span
              key={`${color}-${index}`}
              className={`game-zuma-queue-ball game-zuma-ball-${color}`}
              data-test={`zuma-queue-${index}`}
            />
          ))}
        </div>
      ) : null}

      <div className="game-zuma-controls">
        <button
          type="button"
          className="game-zuma-button"
          data-test="zuma-pause"
          onClick={() => engine.togglePause()}
        >
          {state?.phase === 'paused' ? '继续' : '暂停'}
        </button>
        <button
          type="button"
          className="game-zuma-button"
          data-test="zuma-restart"
          onClick={() => engine.restart()}
        >
          重新开始
        </button>
        <button
          type="button"
          className="game-zuma-button"
          data-test="zuma-shoot"
          onClick={() => engine.shoot()}
        >
          发射
        </button>
        {showLevelPicker ? (
          <div className="game-zuma-levels" aria-label="关卡选择">
            {LEVELS.map((item) => (
              <button
                key={item.id}
                type="button"
                className="game-zuma-level-chip"
                disabled={item.id > unlocked}
                aria-current={item.id === state?.level}
                onClick={() => selectLevel(item.id)}
              >
                {item.id}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
});
