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

/** 一种颜色的球怎么画：高光、主体、暗边、记号色。 */
export interface MarblePaint {
  /** 高光侧（渐变起点）。 */
  readonly light: string;
  /** **主体色**：球面绝大部分面积是它，颜色辨识全靠这一位。 */
  readonly mid: string;
  /** 外圈阴影（渐变终点 + 描边），只占边缘一小圈。 */
  readonly dark: string;
  /** 形状记号的颜色，取主体色的深调，压在 mid 上仍看得清。 */
  readonly mark: string;
}

/**
 * 每种颜色的程序化配色。
 *
 * 教训（2026-10-25 真机反馈「看不到球的颜色」）：原方案是 `light → mid → dark` 三段渐变，
 * 且 mid 落在 **55% 半径**处 —— 于是 0.55r 到 1r 之间那 **约 70% 的球面面积全在变暗坡上**，
 * 手机上几个球看过去就是一堆暗色疙瘩。现在 mid 从 0.42r 一路平铺到 0.82r，
 * 变暗只发生在最后 18% 的边沿，主体面积保持颜色纯度。
 */
export const MARBLE_PAINT: Readonly<Record<MarbleColor, MarblePaint>> = {
  red: { light: '#ff9a8a', mid: '#e0331f', dark: '#7a0f08', mark: '#5c0a05' },
  yellow: { light: '#fff3b0', mid: '#f0b90b', dark: '#8a6200', mark: '#6b4a00' },
  green: { light: '#b6f5c0', mid: '#1fae4b', dark: '#0a5522', mark: '#07401a' },
  blue: { light: '#b8ddff', mid: '#1f74d0', dark: '#0a3364', mark: '#052447' },
  purple: { light: '#e6c2ff', mid: '#8b2fd0', dark: '#43106a', mark: '#2d0b47' },
  orange: { light: '#ffd7a8', mid: '#ef7a12', dark: '#8a3d00', mark: '#5f2a00' }
};

/**
 * 颜色之外的**形状**记号：同色必同形状、异色形状互不相同。
 *
 * 给色盲用户，也给「屏幕反光下认不出色相」的场景兜底 —— 配对判断可以完全不看颜色。
 */
export type MarbleGlyph = 'dot' | 'ring' | 'triangle' | 'square' | 'diamond' | 'cross';

export const MARBLE_GLYPH: Readonly<Record<MarbleColor, MarbleGlyph>> = {
  red: 'dot',
  yellow: 'triangle',
  green: 'square',
  blue: 'diamond',
  purple: 'cross',
  orange: 'ring'
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
  /** 装填球外的「待发」环；上一发还在飞时会自动压暗表示冷却。 */
  readonly ready: string;
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
  ready: 'rgba(255,255,255,0.85)',
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

/**
 * 能被赋给 `fillStyle` / `strokeStyle` 的东西。
 *
 * 除了字符串与渐变，真实 canvas 还接受 `CanvasPattern`。这里必须给它留位置：否则
 * `CanvasRenderingContext2D` 反而**不能赋值**给本模块的 `DrawContext`（属性类型要求双向兼容），
 * 适配层就得被迫写 `as unknown as DrawContext` 这种脏转换。用可选的 `setTransform` 做结构占位，
 * 正好只放过 pattern 而不放过任意对象。
 */
export type PaintLike = string | GradientLike | { readonly setTransform?: unknown };

/** 带 `ctx` 最小能力面的接口（假实现只需覆盖这些方法就能被单测驱动）。 */
export interface DrawContext {
  save(): void;
  restore(): void;
  beginPath(): void;
  closePath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  arc(x: number, y: number, r: number, start: number, end: number): void;
  rect(x: number, y: number, w: number, h: number): void;
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
  set fillStyle(v: PaintLike);
  set strokeStyle(v: PaintLike);
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

/** 画一颗球：主体保色的渐变 + 深色描边 + 形状记号。 */
function drawMarble(
  ctx: DrawContext,
  center: Vec2,
  radius: number,
  paint: MarblePaint,
  glyph: MarbleGlyph,
  alpha = 1
): void {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.beginPath();
  ctx.arc(center.x, center.y, radius, 0, Math.PI * 2);
  const gradient = ctx.createRadialGradient(
    center.x - radius * 0.28,
    center.y - radius * 0.32,
    radius * 0.1,
    center.x,
    center.y,
    radius
  );
  // mid 从 0.42r 平铺到 0.82r：球面主体保持颜色纯度，变暗只发生在最外 18% 的边沿。
  gradient.addColorStop(0, paint.light);
  gradient.addColorStop(0.42, paint.mid);
  gradient.addColorStop(0.82, paint.mid);
  gradient.addColorStop(1, paint.dark);
  ctx.fillStyle = gradient;
  ctx.fill();
  // 深色描边而不是浅色：暗底上用浅色描边会让相邻球糊成一圈光边，深色才能把同色球彼此分开。
  ctx.lineWidth = Math.max(0.6, radius * 0.16);
  ctx.strokeStyle = paint.dark;
  ctx.stroke();
  drawGlyph(ctx, glyph, center, radius, paint.mark, alpha);
  ctx.restore();
}

/**
 * 球心的形状记号（色盲与反光场景的兜底）。
 *
 * 只用 `fill` / `stroke` 与直线段，不依赖字体，也不引入图片。
 */
function drawGlyph(
  ctx: DrawContext,
  kind: MarbleGlyph,
  center: Vec2,
  radius: number,
  color: string,
  alpha: number
): void {
  const s = radius * 0.42;
  const { x, y } = center;
  ctx.save();
  ctx.globalAlpha = alpha * 0.9;
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(0.6, radius * 0.16);
  ctx.beginPath();
  switch (kind) {
    case 'dot': {
      ctx.arc(x, y, s * 0.5, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'ring': {
      ctx.arc(x, y, s * 0.62, 0, Math.PI * 2);
      ctx.stroke();
      break;
    }
    case 'triangle': {
      ctx.moveTo(x, y - s * 0.74);
      ctx.lineTo(x + s * 0.68, y + s * 0.54);
      ctx.lineTo(x - s * 0.68, y + s * 0.54);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'square': {
      ctx.rect(x - s * 0.56, y - s * 0.56, s * 1.12, s * 1.12);
      ctx.fill();
      break;
    }
    case 'diamond': {
      ctx.moveTo(x, y - s * 0.82);
      ctx.lineTo(x + s * 0.7, y);
      ctx.lineTo(x, y + s * 0.82);
      ctx.lineTo(x - s * 0.7, y);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'cross': {
      ctx.moveTo(x - s * 0.72, y);
      ctx.lineTo(x + s * 0.72, y);
      ctx.moveTo(x, y - s * 0.72);
      ctx.lineTo(x, y + s * 0.72);
      ctx.stroke();
      break;
    }
  }
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
 * 顺序即层级：背景 → 轨道边 → 轨道槽 → 洞口 → 彩球 → 爆点 → 发射器与瞄准线 →
 * 装填球（含待发环）→ 下一发预览 → 飞行弹球。装填与预览画在弹球之前，保证飞行中的球永远在最上层。
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
    drawMarble(
      ctx,
      toScreen(view, pose),
      radius,
      MARBLE_PAINT[marble.color],
      MARBLE_GLYPH[marble.color]
    );
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
    ctx.strokeStyle = MARBLE_PAINT[burst.color].light;
    ctx.stroke();
    ctx.restore();
  }

  // 发射器底座 + 瞄准线
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

  // 装填球（**当前要打的这颗必须看得见**）：画在发射器口上，外圈一套待发环。
  // 真机反馈的第一条「不知道打出的球是什么颜色」就是这里漏了 —— 之前只画底座。
  const loaded = state.queue[0];
  if (loaded) {
    drawMarble(
      ctx,
      launcher,
      radius * 1.12,
      MARBLE_PAINT[loaded],
      MARBLE_GLYPH[loaded]
    );
    ctx.save();
    ctx.globalAlpha = state.projectile ? 0.35 : 1; // 上一发还在飞的时候压暗，表示冷却中
    ctx.beginPath();
    ctx.arc(launcher.x, launcher.y, radius * 1.62, 0, Math.PI * 2);
    ctx.lineWidth = Math.max(1, radius * 0.18);
    ctx.strokeStyle = style.ready;
    ctx.stroke();
    ctx.restore();
  }

  // 下一发预览放在画布右上角（螺旋是圆的，四角最空，不会压到轨道）
  const upcoming = state.queue[1];
  if (upcoming) {
    drawMarble(
      ctx,
      { x: view.width - radius * 2.2, y: radius * 2.2 },
      radius * 0.78,
      MARBLE_PAINT[upcoming],
      MARBLE_GLYPH[upcoming],
      0.92
    );
  }

  // 飞行中的弹球画在最上层，免得被发射器与装填球盖住
  if (state.projectile) {
    drawMarble(
      ctx,
      toScreen(view, state.projectile.pos),
      radius,
      MARBLE_PAINT[state.projectile.color],
      MARBLE_GLYPH[state.projectile.color]
    );
  }

  ctx.restore();
}
