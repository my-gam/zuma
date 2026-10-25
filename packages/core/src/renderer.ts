/**
 * 无框架 Canvas 渲染器 —— core 内置，只认 `CanvasRenderingContext2D`。
 *
 * 为什么不放进适配层：绘制代码在 Vue / React / Vanilla 三个宿主里必须**逐像素一致**，
 * 写三份迟早走样（2048 与 sudoku 的 DOM 版本就是这么分叉的）。所以绘制单点在 core，
 * 适配层只负责三件事：造 canvas、按 devicePixelRatio 设好变换、把指针事件换算成世界坐标。
 *
 * 本模块的纪律：
 *
 * - **不查 DOM、不做选择器、不加载图片**：所有输入都是显式传进来的数字与状态。
 *   单测因此可以用一个假 ctx 记录调用序列，无需真浏览器。
 * - **纯绘制**：不推进时间、不改状态、不建 `requestAnimationFrame`。
 * - **零外部素材**：球体用径向渐变 + 高光 + 描边程序化画出来。原版 `F:\game\zuma` 里的
 *   PNG/GIF 是 PopCap 的版权资产，一个字节都不能进这个仓库。
 * - `dist < 0` 的球**不上屏**：那是倒退段被吸回入口外的球（见 `game.ts`）。
 */
import type { ZumaState } from './game';
import type { Track, Vec2 } from './track';
import { poseAt } from './track';
import type { Bounds } from './track';
import type { MarbleColor } from './types';

/** 世界坐标 → 画布坐标的等比映射（letterbox 居中，不拉伸变形）。 */
export interface View {
  readonly scale: number;
  readonly offsetX: number;
  readonly offsetY: number;
  readonly width: number;
  readonly height: number;
}

/** 一种颜色的球怎么画：三色 + 高光，纯色相太单调，全渐变又糊。 */
export interface MarblePaint {
  readonly light: string;
  readonly mid: string;
  readonly dark: string;
  readonly rim: string;
}

/** 每种颜色的程序化配色。 */
export const MARBLE_PAINT: Readonly<Record<MarbleColor, MarblePaint>> = {
  red: { light: '#ff9a8a', mid: '#e0331f', dark: '#7a0f08', rim: '#ffd9d0' },
  yellow: { light: '#fff3b0', mid: '#f0b90b', dark: '#8a6200', rim: '#fff8d6' },
  green: { light: '#b6f5c0', mid: '#1fae4b', dark: '#0a5522', rim: '#d8ffe1' },
  blue: { light: '#b8ddff', mid: '#1f74d0', dark: '#0a3364', rim: '#dbeeff' },
  purple: { light: '#e6c2ff', mid: '#8b2fd0', dark: '#43106a', rim: '#f0dcff' },
  orange: { light: '#ffd7a8', mid: '#ef7a12', dark: '#8a3d00', rim: '#ffe7cb' }
};

/** 绘制样式覆盖项。 */
export interface DrawStyle {
  readonly background: string;
  readonly groove: string;
  readonly grooveEdge: string;
  readonly launcher: string;
  readonly launcherEdge: string;
  readonly aim: string;
  readonly hole: string;
  /** 瞄准指示线是否画（结算屏可以关掉）。 */
  readonly showAim: boolean;
  /** 轨道凹槽宽度相对球直径的倍率。 */
  readonly grooveRatio: number;
  /**
   * 爆点存活毫秒数，必须与 `Zuma` 构造里的 `burstMs` 一致：
   * 状态机会在那一刻把爆点摘掉，渲染层的淡出如果比它快就会「凭空消失」，比它慢则永远淡不完。
   */
  readonly burstMs: number;
}

/** 默认配色：深色底 + 石槽轨道，接近原版的观感但不照抄其素材。 */
export const DEFAULT_STYLE: DrawStyle = {
  background: '#101521',
  groove: '#1d2536',
  grooveEdge: '#2b3752',
  launcher: '#3c4a68',
  launcherEdge: '#8fa4cc',
  aim: 'rgba(255,255,255,0.55)',
  hole: '#05070c',
  showAim: true,
  grooveRatio: 1.35,
  burstMs: 420
};

/** 一次绘制要的全部输入。 */
export interface Scene {
  readonly state: ZumaState;
  readonly track: Track;
  readonly view: View;
  readonly launcher: Vec2;
}

/** `CanvasRenderingContext2D.createRadialGradient` 的返回值里本模块用到的部分。 */
export interface GradientLike {
  addColorStop(offset: number, color: string): void;
}

/** 带 `ctx` 最小能力面的接口（假实现只需覆盖这些方法就能被单测驱动）。 */
export interface DrawContext {
  save(): void;
  restore(): void;
  beginPath(): void;
  closePath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  arc(x: number, y: number, r: number, start: number, end: number): void;
  fill(): void;
  stroke(): void;
  fillRect(x: number, y: number, w: number, h: number): void;
  createRadialGradient(
    x0: number,
    y0: number,
    r0: number,
    x1: number,
    y1: number,
    r1: number
  ): GradientLike;
  set fillStyle(v: string | GradientLike);
  set strokeStyle(v: string | GradientLike);
  set lineWidth(v: number);
  set globalAlpha(v: number);
  set lineCap(v: string);
  set lineJoin(v: string);
}

/**
 * 依据轨道包围盒算出等比映射。
 *
 * 取 `min(宽比, 高比)` 保证不裁切；`padding` 用画布像素计，留出 HUD 与描边余量。
 */
export function createView(
  bounds: Bounds,
  width: number,
  height: number,
  padding = 0
): View {
  if (!(width > 0) || !(height > 0)) {
    throw new RangeError(`画布尺寸必须为正，收到 ${width}×${height}`);
  }
  const boxW = bounds.maxX - bounds.minX;
  const boxH = bounds.maxY - bounds.minY;
  if (!(boxW > 0) && !(boxH > 0)) {
    throw new RangeError('轨道包围盒退化为一个点，无法建立视图映射');
  }
  const usableW = Math.max(1, width - padding * 2);
  const usableH = Math.max(1, height - padding * 2);
  const scale = Math.min(
    boxW > 0 ? usableW / boxW : Number.POSITIVE_INFINITY,
    boxH > 0 ? usableH / boxH : Number.POSITIVE_INFINITY
  );
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerY = (bounds.minY + bounds.maxY) / 2;
  return {
    scale,
    offsetX: width / 2 - centerX * scale,
    offsetY: height / 2 - centerY * scale,
    width,
    height
  };
}

/** 世界点 → 画布点。 */
export function toScreen(view: View, point: Vec2): Vec2 {
  return { x: point.x * view.scale + view.offsetX, y: point.y * view.scale + view.offsetY };
}

/** 世界长度 → 画布长度（半径、线宽都走它）。 */
export function toScreenSize(view: View, size: number): number {
  return size * view.scale;
}

/** 画一颗球：底色圆 + 偏心径向渐变 + 顶部高光 + 外圈描边。 */
function drawMarble(
  ctx: DrawContext,
  center: Vec2,
  radius: number,
  paint: MarblePaint,
  alpha = 1
): void {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.beginPath();
  ctx.arc(center.x, center.y, radius, 0, Math.PI * 2);
  const gradient = ctx.createRadialGradient(
    center.x - radius * 0.35,
    center.y - radius * 0.4,
    radius * 0.12,
    center.x,
    center.y,
    radius
  );
  gradient.addColorStop(0, paint.light);
  gradient.addColorStop(0.55, paint.mid);
  gradient.addColorStop(1, paint.dark);
  ctx.fillStyle = gradient;
  ctx.fill();
  ctx.lineWidth = Math.max(0.5, radius * 0.14);
  ctx.strokeStyle = paint.rim;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(center.x - radius * 0.32, center.y - radius * 0.36, radius * 0.24, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.fill();
  ctx.restore();
}

/** 描一条轨道折线（凹槽与边缘各描一次）。 */
function strokeTrack(ctx: DrawContext, scene: Scene, color: string, widthRatio: number): void {
  const { view, track } = scene;
  ctx.beginPath();
  const first = track.points[0];
  if (!first) return;
  const p0 = toScreen(view, first);
  ctx.moveTo(p0.x, p0.y);
  for (let i = 1; i < track.points.length; i += 1) {
    const p = toScreen(view, track.points[i]!);
    ctx.lineTo(p.x, p.y);
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = toScreenSize(view, scene.state.radius * 2 * widthRatio);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.stroke();
}

/**
 * 画一整帧。
 *
 * 顺序即层级：背景 → 轨道边 → 轨道槽 → 洞口 → 彩球 → 爆点 → 弹球 → 发射器 → 瞄准线。
 * 调用前宿主必须已按 devicePixelRatio 设好变换矩阵，本函数只用 CSS 像素坐标。
 */
export function drawScene(ctx: DrawContext, scene: Scene, style: DrawStyle = DEFAULT_STYLE): void {
  const { view, state } = scene;
  const radius = toScreenSize(view, state.radius);

  ctx.save();
  ctx.fillStyle = style.background;
  ctx.fillRect(0, 0, view.width, view.height);

  strokeTrack(ctx, scene, style.grooveEdge, style.grooveRatio + 0.28);
  strokeTrack(ctx, scene, style.groove, style.grooveRatio);

  // 洞口：轨道末端一个深色坑
  const end = poseAt(scene.track, scene.track.length);
  const endScreen = toScreen(view, end);
  ctx.beginPath();
  ctx.arc(endScreen.x, endScreen.y, radius * 1.45, 0, Math.PI * 2);
  ctx.fillStyle = style.hole;
  ctx.fill();

  // 彩球（倒退段被吸回入口外的不画）
  for (const marble of state.chain.marbles) {
    if (marble.dist < 0) continue;
    const pose = poseAt(scene.track, marble.dist);
    drawMarble(ctx, toScreen(view, pose), radius, MARBLE_PAINT[marble.color]);
  }

  // 爆点：按存活时间放大并淡出（淡出时长与状态机摘掉它的时长必须一致，见 DrawStyle.burstMs）
  for (const burst of state.bursts) {
    if (burst.dist < 0) continue;
    const age = state.elapsedMs - burst.atMs;
    const life = Math.max(0, Math.min(1, age / style.burstMs));
    const pose = poseAt(scene.track, burst.dist);
    const at = toScreen(view, pose);
    ctx.save();
    ctx.globalAlpha = 1 - life;
    ctx.beginPath();
    ctx.arc(at.x, at.y, radius * (1 + life * 1.6), 0, Math.PI * 2);
    ctx.lineWidth = Math.max(0.5, radius * 0.2 * (1 - life));
    ctx.strokeStyle = MARBLE_PAINT[burst.color].rim;
    ctx.stroke();
    ctx.restore();
  }

  // 飞行中的弹球
  if (state.projectile) {
    drawMarble(
      ctx,
      toScreen(view, state.projectile.pos),
      radius,
      MARBLE_PAINT[state.projectile.color]
    );
  }

  // 发射器：底座 + 朝向
  const launcher = toScreen(view, scene.launcher);
  ctx.beginPath();
  ctx.arc(launcher.x, launcher.y, radius * 1.7, 0, Math.PI * 2);
  ctx.fillStyle = style.launcher;
  ctx.fill();
  ctx.lineWidth = Math.max(0.5, radius * 0.22);
  ctx.strokeStyle = style.launcherEdge;
  ctx.stroke();

  if (style.showAim) {
    const reach = radius * 6;
    ctx.beginPath();
    ctx.moveTo(launcher.x, launcher.y);
    ctx.lineTo(
      launcher.x + Math.cos(state.aimAngle) * reach,
      launcher.y + Math.sin(state.aimAngle) * reach
    );
    ctx.lineWidth = Math.max(0.5, radius * 0.3);
    ctx.strokeStyle = style.aim;
    ctx.stroke();
  }

  ctx.restore();
}
