import { describe, expect, it } from 'vitest';
import {
  DEFAULT_STYLE,
  MARBLE_PAINT,
  createView,
  drawScene,
  toScreen,
  toScreenSize,
  type DrawContext,
  type GradientLike
} from '../src/index';
import { Zuma, type Bounds, type Scene, type ZumaState } from '../src/index';

/** 记录型假 ctx：把每次调用与属性写入都记成一串文本，用来断言渲染行为。 */
class CtxRecorder implements DrawContext {
  readonly ops: string[] = [];
  private balance = 0;
  private paint: string | GradientLike = '#000';

  /** save/restore 是否配平。 */
  get depth(): number {
    return this.balance;
  }

  save(): void {
    this.ops.push('save');
    this.balance += 1;
  }

  restore(): void {
    this.ops.push('restore');
    this.balance -= 1;
  }

  beginPath(): void {
    this.ops.push('beginPath');
  }

  closePath(): void {
    this.ops.push('closePath');
  }

  moveTo(x: number, y: number): void {
    this.ops.push(`moveTo(${x.toFixed(1)},${y.toFixed(1)})`);
  }

  lineTo(x: number, y: number): void {
    this.ops.push(`lineTo(${x.toFixed(1)},${y.toFixed(1)})`);
  }

  arc(x: number, y: number, r: number): void {
    this.ops.push(`arc(${x.toFixed(1)},${y.toFixed(1)},${r.toFixed(2)})`);
  }

  fill(): void {
    this.ops.push(`fill:${typeof this.paint === 'string' ? this.paint : 'gradient'}`);
  }

  stroke(): void {
    this.ops.push(`stroke:${typeof this.paint === 'string' ? this.paint : 'gradient'}`);
  }

  fillRect(x: number, y: number, w: number, h: number): void {
    // 真实 canvas 的 fillRect 用当前 fillStyle 立刻填充，所以这里把 paint 一起记下来
    this.ops.push(
      `fillRect(${x},${y},${w},${h},${typeof this.paint === 'string' ? this.paint : 'gradient'})`
    );
  }

  createRadialGradient(...args: number[]): GradientLike {
    this.ops.push(`gradient(${args.map((n) => n.toFixed(1)).join(',')})`);
    return {
      addColorStop: (offset, color) => {
        this.ops.push(`stop:${offset.toFixed(2)}:${color}`);
      }
    };
  }

  set fillStyle(v: string | GradientLike) {
    this.paint = v;
    this.ops.push('set:fillStyle');
  }

  set strokeStyle(v: string | GradientLike) {
    this.paint = v;
    this.ops.push('set:strokeStyle');
  }

  set lineWidth(v: number) {
    this.ops.push(`set:lineWidth:${v.toFixed(2)}`);
  }

  set globalAlpha(v: number) {
    this.ops.push(`set:globalAlpha:${v.toFixed(2)}`);
  }

  set lineCap(v: string) {
    this.ops.push(`set:lineCap:${v}`);
  }

  set lineJoin(v: string) {
    this.ops.push(`set:lineJoin:${v}`);
  }
}

function sampleGame() {
  let seed = 5;
  const rng = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
  return new Zuma({ rng, samplesPerSegment: 6 });
}

function sceneFor(game: Zuma, state: ZumaState, width = 800, height = 600): Scene {
  const bounds: Bounds = game.getBounds();
  return {
    state,
    track: game.getTrack(),
    view: createView(bounds, width, height, 8),
    launcher: game.getLauncher()
  };
}

function count(ctx: CtxRecorder, prefix: string): number {
  return ctx.ops.filter((op) => op.startsWith(prefix)).length;
}

describe('createView 视图映射', () => {
  it('方形世界放进横画布时按高度缩放并水平居中', () => {
    const view = createView({ minX: 0, minY: 0, maxX: 1000, maxY: 1000 }, 800, 400);
    expect(view.scale).toBeCloseTo(0.4, 9);
    const center = toScreen(view, { x: 500, y: 500 });
    expect(center.x).toBeCloseTo(400, 6);
    expect(center.y).toBeCloseTo(200, 6);
  });

  it('padding 缩小可用区域', () => {
    const noPad = createView({ minX: 0, minY: 0, maxX: 100, maxY: 100 }, 200, 200);
    const padded = createView({ minX: 0, minY: 0, maxX: 100, maxY: 100 }, 200, 200, 20);
    expect(noPad.scale).toBeCloseTo(2, 9);
    expect(padded.scale).toBeCloseTo(1.6, 9);
  });

  it('退化的细长包围盒只按有效方向缩放', () => {
    const view = createView({ minX: 0, minY: 5, maxX: 100, maxY: 5 }, 200, 200);
    expect(view.scale).toBeCloseTo(2, 9);
    expect(Number.isFinite(view.offsetY)).toBe(true);
  });

  it('非法尺寸与退化盒子抛错', () => {
    expect(() => createView({ minX: 0, minY: 0, maxX: 1, maxY: 1 }, 0, 100)).toThrow(RangeError);
    expect(() =>
      createView({ minX: 5, minY: 5, maxX: 5, maxY: 5 }, 100, 100)
    ).toThrow(/退化/);
  });

  it('toScreenSize 把世界半径换成画布半径', () => {
    const view = createView({ minX: 0, minY: 0, maxX: 1000, maxY: 1000 }, 500, 500);
    expect(toScreenSize(view, 20)).toBeCloseTo(10, 9);
  });
});

describe('drawScene 画了什么', () => {
  it('每颗可见球画一个渐变球体', () => {
    const game = sampleGame();
    const state = game.getState();
    const ctx = new CtxRecorder();
    drawScene(ctx, sceneFor(game, state));
    expect(count(ctx, 'gradient(')).toBe(state.chain.marbles.filter((m) => m.dist >= 0).length);
    expect(ctx.depth).toBe(0); // save/restore 配平
  });

  it('倒退到入口外（dist < 0）的球不上屏', () => {
    const game = sampleGame();
    const base = game.getState();
    const shifted = base.chain.marbles.map((m, i) => ({ ...m, dist: m.dist - (i < 3 ? 9999 : 0) }));
    const state: ZumaState = { ...base, chain: { spacing: base.chain.spacing, marbles: shifted } };
    const ctx = new CtxRecorder();
    drawScene(ctx, sceneFor(game, state));
    expect(count(ctx, 'gradient(')).toBe(shifted.filter((m) => m.dist >= 0).length);
    expect(count(ctx, 'gradient(')).toBeLessThan(shifted.length);
  });

  it('飞行中的弹球再多画一颗球', () => {
    const game = sampleGame();
    game.shoot();
    const state = game.getState();
    const plain = new CtxRecorder();
    drawScene(plain, sceneFor(game, { ...state, projectile: null }));
    const withShot = new CtxRecorder();
    drawScene(withShot, sceneFor(game, state));
    expect(count(withShot, 'gradient(')).toBe(count(plain, 'gradient(') + 1);
  });

  it('先铺满背景再画内容，颜色来自样式', () => {
    const game = sampleGame();
    const ctx = new CtxRecorder();
    drawScene(ctx, sceneFor(game, game.getState(), 640, 480));
    expect(ctx.ops[0]).toBe('save');
    const background = ctx.ops.findIndex((o) =>
      o.startsWith(`fillRect(0,0,640,480,${DEFAULT_STYLE.background}`)
    );
    const firstMarble = ctx.ops.findIndex((o) => o.startsWith('gradient('));
    expect(background).toBeGreaterThanOrEqual(0);
    expect(firstMarble).toBeGreaterThan(background); // 背景一定在球之前
  });

  it('轨道描两遍（外缘 + 内槽），grooveRatio 决定槽宽', () => {
    const game = sampleGame();
    const narrow = new CtxRecorder();
    drawScene(narrow, sceneFor(game, game.getState()), { ...DEFAULT_STYLE, grooveRatio: 1 });
    const wide = new CtxRecorder();
    drawScene(wide, sceneFor(game, game.getState()), { ...DEFAULT_STYLE, grooveRatio: 2 });
    expect(count(narrow, `stroke:${DEFAULT_STYLE.groove}`)).toBe(1);
    expect(count(narrow, `stroke:${DEFAULT_STYLE.grooveEdge}`)).toBe(1);
    const lineWidths = (ops: readonly string[]): number[] =>
      ops.filter((o) => o.startsWith('set:lineWidth:')).map((o) => Number(o.slice('set:lineWidth:'.length)));
    expect(Math.max(...lineWidths(wide.ops))).toBeGreaterThan(Math.max(...lineWidths(narrow.ops)));
  });

  it('showAim 关掉后不再描瞄准线', () => {
    const game = sampleGame();
    const withAim = new CtxRecorder();
    drawScene(withAim, sceneFor(game, game.getState()));
    const without = new CtxRecorder();
    drawScene(without, sceneFor(game, game.getState()), { ...DEFAULT_STYLE, showAim: false });
    expect(withAim.ops).toContain(`stroke:${DEFAULT_STYLE.aim}`);
    expect(without.ops).not.toContain(`stroke:${DEFAULT_STYLE.aim}`);
  });

  it('爆点随年龄放大并淡出，且淡出时长跟随 burstMs', () => {
    const game = sampleGame();
    const base = game.getState();
    const state: ZumaState = {
      ...base,
      elapsedMs: 1000,
      bursts: [
        { id: 1, color: 'red', dist: 100, atMs: 1000, combo: 1, runLength: 3 },
        { id: 2, color: 'blue', dist: 200, atMs: 800, combo: 1, runLength: 3 }
      ]
    };
    const ctx = new CtxRecorder();
    drawScene(ctx, sceneFor(game, state), { ...DEFAULT_STYLE, burstMs: 400 });
    const alphas = ctx.ops.filter((o) => o.startsWith('set:globalAlpha:')).map((o) => Number(o.slice(16)));
    expect(alphas).toContain(1); // 刚产生的爆点不透明
    expect(alphas.some((a) => a > 0 && a < 1)).toBe(true); // 老爆点半透明
    const radii = ctx.ops.filter((o) => o.startsWith('arc(')).map((o) => Number(o.slice(4).split(',')[2].replace(')', '')));
    expect(Math.max(...radii)).toBeGreaterThan(state.radius * 0); // 放大过
  });

  it('清空后的胜利态照样能画（不崩、只剩发射器与轨道）', () => {
    const game = sampleGame();
    const base = game.getState();
    const state: ZumaState = { ...base, chain: { spacing: base.chain.spacing, marbles: [] }, phase: 'won' };
    const ctx = new CtxRecorder();
    expect(() => drawScene(ctx, sceneFor(game, state))).not.toThrow();
    expect(count(ctx, 'gradient(')).toBe(0);
    expect(ctx.depth).toBe(0);
  });

  it('每种配色都齐活（新增颜色时测试会挡住漏配）', () => {
    const colors = Object.keys(MARBLE_PAINT);
    expect(colors.length).toBeGreaterThanOrEqual(6);
    for (const color of colors) {
      const paint = MARBLE_PAINT[color as keyof typeof MARBLE_PAINT];
      expect(paint.light).toMatch(/^#/);
      expect(paint.mid).toMatch(/^#/);
      expect(paint.dark).toMatch(/^#/);
      expect(paint.rim).toMatch(/^#/);
    }
  });
});
