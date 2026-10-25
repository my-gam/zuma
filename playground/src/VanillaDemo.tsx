import { useEffect, useRef, useState } from 'react';
import {
  DEFAULT_STYLE,
  LEVELS,
  PHYSICS,
  Zuma,
  createView,
  drawScene,
  type View,
  type Vec2,
  type ZumaState
} from '@my-games/zuma-core';

/** 本演示自己指定的自动推进间隔，与传给 `Zuma` 的值保持一致。 */
const AUTO_NEXT_MS = 2600;

/** HUD 需要的字段，从快照里挑出来。 */
interface Hud {
  readonly phase: ZumaState['phase'];
  readonly level: number;
  readonly score: number;
  readonly remaining: number;
  readonly combo: number;
  readonly hits: number;
  readonly shotsFired: number;
  readonly elapsedMs: number;
  readonly overMs: number;
  readonly settled: number | null;
  readonly queue: readonly string[];
}

function hudOf(state: ZumaState): Hud {
  return {
    phase: state.phase,
    level: state.level,
    score: state.score,
    remaining: state.remaining,
    combo: state.combo,
    hits: state.hits,
    shotsFired: state.shotsFired,
    elapsedMs: state.elapsedMs,
    overMs: state.overMs,
    settled: state.settled,
    queue: state.queue
  };
}

/**
 * Vanilla 演示 —— 不用任何框架组件，直接吃 `@my-games/zuma-core`。
 *
 * 这一页存在的意义是**证明 core 的框架无关不是口号**：同一份 `drawScene`、同一个 `Zuma`，
 * 手写一点胶水就能跑起来，画面应与 Vue / React 两个 tab 逐像素一致。
 *
 * 但它也必须和另外两个 tab 一样有反馈：之前这里只有一块画布 + 三个按钮，
 * 没有 HUD、没有结算画面，玩家打完一关什么都不知道（2026-10-25 反馈）。
 * 现在补上同一套 `game-zuma-*` 结构的读数与遮罩。
 */
export function VanillaDemo({ level }: VanillaDemoProps) {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const gameRef = useRef<Zuma | null>(null);
  const viewRef = useRef<View | null>(null);
  const sizeRef = useRef({ width: 0, height: 0 });
  const draggingRef = useRef(false);
  const [hud, setHud] = useState<Hud | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const stage = stageRef.current;
    if (!canvas || !stage) return;

    const game = new Zuma({ level, storage: null, samplesPerSegment: 12, autoNextMs: AUTO_NEXT_MS });
    gameRef.current = game;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const resize = () => {
      const rect = stage.getBoundingClientRect();
      const width = Math.max(1, Math.round(rect.width));
      const height = Math.max(1, Math.round(rect.height));
      const dpr = Math.min(3, Math.max(1, window.devicePixelRatio || 1));
      sizeRef.current = { width, height };
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      viewRef.current = null;
    };

    const draw = () => {
      if (!viewRef.current) {
        viewRef.current = createView(
          game.getBounds(16),
          sizeRef.current.width,
          sizeRef.current.height
        );
      }
      drawScene(
        ctx,
        {
          state: game.getState(),
          track: game.getTrack(),
          view: viewRef.current,
          launcher: game.getLauncher()
        },
        DEFAULT_STYLE
      );
    };

    const toWorld = (clientX: number, clientY: number): Vec2 | null => {
      const view = viewRef.current;
      if (!view) return null;
      const rect = canvas.getBoundingClientRect();
      return {
        x: (clientX - rect.left - view.offsetX) / view.scale,
        y: (clientY - rect.top - view.offsetY) / view.scale
      };
    };

    /**
     * 指针悬停即跟随瞄准（桌面端）。
     *
     * 之前只在按下之后才跟随，鼠标党觉得炮口「死了」—— 触摸端没有 hover，
     * 仍然是按下拖动定角、松手发射，两者不冲突。
     */
    const aimAt = (event: PointerEvent) => {
      const world = toWorld(event.clientX, event.clientY);
      if (!world) return;
      game.aimAt(world);
    };

    const onPointerDown = (event: PointerEvent) => {
      draggingRef.current = true;
      canvas.setPointerCapture(event.pointerId);
      aimAt(event);
      draw();
    };
    const onPointerMove = (event: PointerEvent) => {
      aimAt(event); // 不要求 dragging：悬停也跟随
      if (draggingRef.current) draw();
    };
    const onPointerUp = (event: PointerEvent) => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      canvas.releasePointerCapture(event.pointerId);
      aimAt(event);
      game.shoot();
      draw();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === ' ' || event.key === 'Enter') {
        game.shoot();
        event.preventDefault();
      }
    };

    resize();
    draw();
    window.addEventListener('resize', resize);
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerUp);
    canvas.addEventListener('keydown', onKeyDown);

    const observer =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(() => {
            resize();
            draw();
          });
    observer?.observe(stage);

    let raf = 0;
    let lastTs = 0;
    let notice = 0;
    const frame = (ts: number) => {
      const dt = lastTs === 0 ? 0 : Math.max(0, ts - lastTs);
      lastTs = ts;
      game.tick(dt);
      draw();
      // HUD 与倒计时 8Hz 足够，别跟着 120Hz 的物化步数一起 setState。
      if (ts - notice > 125) {
        notice = ts;
        setHud(hudOf(game.getState()));
      }
      raf = window.requestAnimationFrame(frame);
    };
    raf = window.requestAnimationFrame(frame);

    return () => {
      window.cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerUp);
      canvas.removeEventListener('keydown', onKeyDown);
      observer?.disconnect();
      game.pause();
      gameRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [level]);

  const act = (fn: (game: Zuma) => void) => () => {
    const game = gameRef.current;
    if (game) {
      fn(game);
      setHud(hudOf(game.getState()));
    }
  };

  const spec = LEVELS.find((item) => item.id === (hud?.level ?? level));
  const ended = !!hud && hud.phase !== 'playing';
  const countdown = hud ? Math.max(0, AUTO_NEXT_MS - hud.overMs) : 0;

  return (
    <section className="pg-demo">
      <p className="pg-note">
        这份演示不加载 Vue 也不加载 React，只用 <code>@my-games/zuma-core</code> 的{' '}
        <code>Zuma</code> + <code>drawScene</code>，物理步长 {PHYSICS.STEP_MS.toFixed(2)}ms。
      </p>

      <div className="game-zuma-hud">
        <span className="game-zuma-hud-item">
          <span className="game-zuma-hud-label">分数</span>
          <span className="game-zuma-hud-value">{hud?.score ?? 0}</span>
        </span>
        <span className="game-zuma-hud-item">
          <span className="game-zuma-hud-label">关卡</span>
          <span className="game-zuma-hud-value">{hud?.level ?? level}</span>
          <span className="game-zuma-hud-label">{spec?.name}</span>
        </span>
        <span className="game-zuma-hud-item">
          <span className="game-zuma-hud-label">剩余</span>
          <span className="game-zuma-hud-value">{hud?.remaining ?? 0}</span>
        </span>
        <span className="game-zuma-hud-item">
          <span className="game-zuma-hud-label">命中</span>
          <span className="game-zuma-hud-value">
            {hud?.hits ?? 0}/{hud?.shotsFired ?? 0}
          </span>
        </span>
        <span
          className={`game-zuma-hud-item game-zuma-hud-combo${(hud?.combo ?? 0) > 1 ? ' is-active' : ''}`}
        >
          <span className="game-zuma-hud-label">连锁</span>
          <span className="game-zuma-hud-value">×{hud?.combo ?? 0}</span>
        </span>
      </div>

      <div ref={stageRef} className="pg-vanilla-stage">
        <canvas ref={canvasRef} className="game-zuma-canvas" tabIndex={0} aria-label="祖玛 Vanilla 演示画面" />
        {ended && hud ? (
          <div
            className={`game-zuma-overlay is-visible${hud.phase === 'won' ? ' is-won' : hud.phase === 'lost' ? ' is-lost' : ' is-paused'}`}
          >
            <p className="game-zuma-overlay-title">
              {hud.phase === 'won' ? '过关！' : hud.phase === 'lost' ? '进洞了' : '已暂停'}
            </p>
            <p className="game-zuma-overlay-score">
              本关得分 {hud.score}
              {hud.settled ? `（含结算 ${hud.settled}）` : ''}
              {hud.phase === 'won' && hud.level < LEVELS.length
                ? ` · ${Math.ceil(countdown / 1000)} 秒后自动进入下一关`
                : ''}
            </p>
            <div className="game-zuma-overlay-actions">
              <button
                type="button"
                className="game-zuma-button"
                onClick={act((g) => void g.restart())}
              >
                重玩本关
              </button>
              {hud.phase === 'won' && hud.level < LEVELS.length ? (
                <button
                  type="button"
                  className="game-zuma-button game-zuma-button-primary"
                  onClick={act((g) => void g.next())}
                >
                  立刻下一关
                </button>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>

      {hud ? (
        <div className="game-zuma-queue" aria-label="装填预览">
          {hud.queue.map((color, index) => (
            <span
              key={`${color}-${index}`}
              className={`game-zuma-queue-ball game-zuma-ball-${color}`}
            />
          ))}
        </div>
      ) : null}

      <div className="pg-controls">
        <button type="button" className="pg-button" onClick={act((g) => void g.shoot())}>
          发射
        </button>
        <button type="button" className="pg-button" onClick={act((g) => void g.togglePause())}>
          暂停 / 继续
        </button>
        <button type="button" className="pg-button" onClick={act((g) => void g.restart())}>
          重开
        </button>
        <select
          className="pg-select"
          value={level}
          onChange={(event) => {
            gameRef.current?.start(Number(event.target.value));
          }}
          aria-label="选择关卡"
        >
          {LEVELS.map((item) => (
            <option key={item.id} value={item.id}>
              {item.id} · {item.name}
            </option>
          ))}
        </select>
      </div>
    </section>
  );
}

export interface VanillaDemoProps {
  /** 起始关卡 id。 */
  readonly level?: number;
}
