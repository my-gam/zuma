import { useEffect, useRef } from 'react';
import {
  DEFAULT_STYLE,
  LEVELS,
  PHYSICS,
  Zuma,
  createView,
  drawScene,
  type View,
  type Vec2
} from '@my-games/zuma-core';

/**
 * Vanilla 演示 —— 不用任何框架，直接吃 `@my-games/zuma-core`。
 *
 * 这一页存在的意义是**证明 core 的框架无关不是口号**：同一份 `drawScene`、同一个 `Zuma`，
 * 手写十几行胶水就能跑起来，和 Vue / React 两个 tab 的画面应当逐像素一致。
 * 它同时也是渲染器改动的最小复现现场（不启动任何构建插件，只 `import` 引擎）。
 */
export interface VanillaDemoProps {
  /** 起始关卡 id。 */
  readonly level?: number;
  /** 状态变化时回调（用来驱动演示面板上的数字）。 */
  readonly onTick?: (info: { score: number; remaining: number; phase: string }) => void;
}

export function VanillaDemo({ level = 1, onTick }: VanillaDemoProps) {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const gameRef = useRef<Zuma | null>(null);
  const viewRef = useRef<View | null>(null);
  const sizeRef = useRef({ width: 0, height: 0 });
  const draggingRef = useRef(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    const stage = stageRef.current;
    if (!canvas || !stage) return;

    const game = new Zuma({ level, storage: null, samplesPerSegment: 12 });
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
        { state: game.getState(), track: game.getTrack(), view: viewRef.current, launcher: game.getLauncher() },
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

    const onPointerDown = (event: PointerEvent) => {
      const world = toWorld(event.clientX, event.clientY);
      if (!world) return;
      draggingRef.current = true;
      canvas.setPointerCapture(event.pointerId);
      game.aimAt(world);
      draw();
    };
    const onPointerMove = (event: PointerEvent) => {
      if (!draggingRef.current) return;
      const world = toWorld(event.clientX, event.clientY);
      if (world) {
        game.aimAt(world);
        draw();
      }
    };
    const onPointerUp = (event: PointerEvent) => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      canvas.releasePointerCapture(event.pointerId);
      const world = toWorld(event.clientX, event.clientY);
      if (world) game.aimAt(world);
      game.shoot();
      draw();
    };

    resize();
    draw();
    window.addEventListener('resize', resize);
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerUp);

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
      const dt = lastTs === 0 ? 0 : Math.min(250, ts - lastTs);
      lastTs = ts;
      game.tick(dt);
      draw();
      // 演示面板的数字 4Hz 更新就够，别跟着 120Hz 一起刷。
      if (ts - notice > 250) {
        notice = ts;
        const s = game.getState();
        onTick?.({ score: s.score, remaining: s.remaining, phase: s.phase });
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
      observer?.disconnect();
      game.pause();
      gameRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [level]);

  const act = (fn: (game: Zuma) => void) => () => {
    const game = gameRef.current;
    if (game) fn(game);
  };

  return (
    <section className="pg-demo">
      <p className="pg-note">
        这份演示不加载 Vue 也不加载 React，只用 <code>@my-games/zuma-core</code> 的{' '}
        <code>Zuma</code> + <code>drawScene</code>，物理步长 {PHYSICS.STEP_MS.toFixed(2)}ms。
      </p>
      <div ref={stageRef} className="pg-vanilla-stage">
        <canvas ref={canvasRef} className="game-zuma-canvas" />
      </div>
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
            const target = Number(event.target.value);
            gameRef.current?.start(target);
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
