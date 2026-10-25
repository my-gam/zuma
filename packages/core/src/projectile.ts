/**
 * 弹道与命中 —— 发射器射出的球沿直线飞，撞到链上某颗球就插入。
 *
 * 一个必须显式处理的物理问题：**隧穿**。弹球速度按 `世界单位/秒` 计，一帧的位移可能
 * 远大于球的直径（手机上 60fps 一帧 16.7ms，速度 900 就是一次 15 单位），如果只用
 * 「新位置与球心距离 < 2r」做判定，弹球会整颗穿过彩球飞过去，表现成「明明打中了却没消」。
 * 所以这里用**扫掠**：把这一帧走过的线段当成一条射线，解圆-线第一次相交，
 * 取所有候选球里最早的那一个。
 *
 * 命中点只是几何交点，链的插入位置要沿轨表达，因此再用 `projectDist` 把接触点投影回轨道，
 * 交给 `insertMarble` 处理（它还会钳制「新球不得嵌进已有球」）。
 *
 * 本模块纯函数、无 DOM、无框架；`poseAt` 只吃已建好的 `Track`。
 */
import type { Chain, MarbleId } from './chain';
import { poseAt, projectDist, type Track, type Vec2 } from './track';
import type { MarbleColor } from './types';

/** 飞行中的弹球。`vel` 单位是「世界单位 / 秒」。 */
export interface Projectile {
  readonly id: MarbleId;
  readonly color: MarbleColor;
  readonly pos: Vec2;
  readonly vel: Vec2;
}

/** `fire()` 的入参。 */
export interface FireOptions {
  readonly id: MarbleId;
  readonly color: MarbleColor;
  /** 发射器出口的世界坐标。 */
  readonly origin: Vec2;
  /** 发射角（弧度，`atan2` 约定，y 轴向下）。 */
  readonly angle: number;
  /** 初速（世界单位 / 秒），必须为正有限数。 */
  readonly speed: number;
}

/** 一次扫掠的命中结果。 */
export interface ProjectileHit {
  /** 被撞到的球在 `chain.marbles` 里的下标。 */
  readonly marbleIndex: number;
  /** 接触点（弹球停下的位置）。 */
  readonly contact: Vec2;
  /** 接触点投影到轨道上的弧长，即插入位置。 */
  readonly insertDist: number;
  /** 从发射点（本帧起点）到接触点的直线距离，用于远射奖励。 */
  readonly travelDistance: number;
}

/** `sweepProjectile()` 的结果：新弹道状态 + 可能的命中。 */
export interface SweepResult {
  readonly projectile: Projectile;
  readonly hit: ProjectileHit | null;
}

function requireFinite(value: number, label: string): number {
  if (!Number.isFinite(value)) {
    throw new RangeError(`${label} 必须是有限数，收到 ${value}`);
  }
  return value;
}

/** 由发射角与初速造一颗弹球。 */
export function fire(options: FireOptions): Projectile {
  const { id, color, origin, angle, speed } = options;
  requireFinite(origin.x, 'origin.x');
  requireFinite(origin.y, 'origin.y');
  requireFinite(angle, 'angle');
  if (!Number.isFinite(speed) || speed <= 0) {
    throw new RangeError(`speed 必须是正有限数，收到 ${speed}`);
  }
  return {
    id,
    color,
    pos: { x: origin.x, y: origin.y },
    vel: { x: Math.cos(angle) * speed, y: Math.sin(angle) * speed }
  };
}

/** 按 `dtMs` 平移弹球（不做碰撞）。`dtMs` 为 0 时返回同一引用。 */
export function stepProjectile(projectile: Projectile, dtMs: number): Projectile {
  requireFinite(dtMs, 'dtMs');
  if (dtMs < 0) {
    throw new RangeError(`dtMs 不能为负，收到 ${dtMs}`);
  }
  if (dtMs === 0) return projectile;
  const k = dtMs / 1000;
  return {
    ...projectile,
    pos: {
      x: projectile.pos.x + projectile.vel.x * k,
      y: projectile.pos.y + projectile.vel.y * k
    }
  };
}

/**
 * 线段 `from → to` 与圆 `(cx, cy, radius)` 第一次相交的参数 `t ∈ [0, 1]`，无交点返回 `null`。
 *
 * 起点已在圆内（罕见但必须定义）时返回 0，表示「此刻就贴着」。
 */
export function rayCircleT(
  from: Vec2,
  to: Vec2,
  center: Vec2,
  radius: number
): number | null {
  if (!Number.isFinite(radius) || radius <= 0) {
    throw new RangeError(`radius 必须是正有限数，收到 ${radius}`);
  }
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const fx = from.x - center.x;
  const fy = from.y - center.y;

  const a = dx * dx + dy * dy;
  const b = 2 * (fx * dx + fy * dy);
  const c = fx * fx + fy * fy - radius * radius;

  if (c <= 0) return 0; // 起点已在圆内
  if (a === 0) return null; // 没移动，且起点在圆外

  const disc = b * b - 4 * a * c;
  if (disc < 0) return null;

  const t = (-b - Math.sqrt(disc)) / (2 * a);
  return t >= 0 && t <= 1 ? t : null;
}

/**
 * 推进弹球一帧并检测与链的第一次接触。
 *
 * 命中时弹球**停在接触点**（不穿透），`hit.insertDist` 供 `insertMarble` 用；
 * 未命中时弹球走到该帧的理论终点。`radius` 是单颗球半径，默认取 `chain.spacing / 2`
 * （`spacing` 定义为紧贴时的中心距 = 2r）。
 */
export function sweepProjectile(
  projectile: Projectile,
  dtMs: number,
  chain: Chain,
  track: Track,
  radius?: number
): SweepResult {
  requireFinite(dtMs, 'dtMs');
  if (dtMs < 0) {
    throw new RangeError(`dtMs 不能为负，收到 ${dtMs}`);
  }
  const r = radius ?? chain.spacing / 2;
  if (!Number.isFinite(r) || r <= 0) {
    throw new RangeError(`radius 必须是正有限数，收到 ${r}`);
  }

  const next = stepProjectile(projectile, dtMs);
  const end = next.pos;

  let bestT: number | null = null;
  let bestIndex = -1;
  for (let i = 0; i < chain.marbles.length; i += 1) {
    const center = poseAt(track, chain.marbles[i]!.dist);
    const t = rayCircleT(projectile.pos, end, center, r * 2);
    if (t !== null && (bestT === null || t < bestT)) {
      bestT = t;
      bestIndex = i;
    }
  }

  if (bestT === null || bestIndex < 0) {
    return { projectile: next, hit: null };
  }

  const contact: Vec2 = {
    x: projectile.pos.x + (end.x - projectile.pos.x) * bestT,
    y: projectile.pos.y + (end.y - projectile.pos.y) * bestT
  };
  const stopped: Projectile = { ...projectile, pos: contact };

  return {
    projectile: stopped,
    hit: {
      marbleIndex: bestIndex,
      contact,
      insertDist: projectDist(track, contact),
      travelDistance: Math.hypot(contact.x - projectile.pos.x, contact.y - projectile.pos.y)
    }
  };
}

/** 弹球是否已飞出给定包围盒（配合 `boundsOf(track, padding)` 做销毁判定）。 */
export function isProjectileLost(
  projectile: Projectile,
  bounds: { minX: number; minY: number; maxX: number; maxY: number }
): boolean {
  const { x, y } = projectile.pos;
  return x < bounds.minX || x > bounds.maxX || y < bounds.minY || y > bounds.maxY;
}

/** 弹球的速度标量（世界单位 / 秒），HUD 与手感调试用。 */
export function projectileSpeed(projectile: Projectile): number {
  return Math.hypot(projectile.vel.x, projectile.vel.y);
}

/** 弹球的飞行方向角（弧度），渲染层画拖尾时要用。 */
export function projectileAngle(projectile: Projectile): number {
  return Math.atan2(projectile.vel.y, projectile.vel.x);
}
