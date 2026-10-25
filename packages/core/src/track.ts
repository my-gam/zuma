/**
 * 轨道曲线 —— 把设计期的控制点变成可查询的弧长参数化折线。
 *
 * 祖玛的轨道是一条平面曲线，彩球链沿它行进。引擎里所有「球在哪」的问题最后都归约成
 * 「沿轨道走了多远」，所以这里提供两件事：
 *
 * 1. `sampleTrack()`：控制点 → **向心 Catmull-Rom** 采样折线 + 弧长前缀和表。
 *    选向心参数化（alpha = 0.5）而不是均匀参数化，是因为关卡控制点间距天然不均匀，
 *    均匀参数化在疏密交界处会生尖点甚至自交，而自交轨道会让「插入哪一段」产生歧义。
 * 2. `poseAt()`：弧长 `dist` → 世界坐标 + 切线角，二分查前缀和表后段内线性插值。
 *
 * 本模块是纯函数 + 纯数据：无 DOM、无随机、无定时器，同输入必得同输出，可直接单测。
 * 单位是「世界单位」，与画布像素解耦；渲染层负责世界坐标 → 屏幕坐标的映射。
 */

/** 平面点（世界坐标系，y 轴向下，与 canvas 一致）。 */
export interface Vec2 {
  readonly x: number;
  readonly y: number;
}

/** 轨道上某个弧长位置的姿态：坐标 + 切线方向角（弧度，`atan2(dy, dx)`）。 */
export interface TrackPose {
  readonly x: number;
  readonly y: number;
  readonly angle: number;
}

/**
 * 已采样的轨道。`points` 与 `cum` 等长且 `cum[0] === 0`，
 * 因此 `cum[i]` 就是 `points[i]` 到轨道起点的弧长，`length === cum[n - 1]`。
 */
export interface Track {
  readonly points: readonly Vec2[];
  readonly cum: readonly number[];
  readonly length: number;
  /** 生成该轨道用的控制点（原样保留，便于序列化与调试）。 */
  readonly controlPoints: readonly Vec2[];
}

/** `sampleTrack()` 的可选项。 */
export interface TrackOptions {
  /**
   * 每段控制点区间插多少个采样步（必须 ≥ 1）。默认 24。
   * 值越大折线越贴近真曲线，代价是采样点数与二分深度线性增长；
   * 祖玛的球要贴轨道排布，24 步足够让相邻球的间距误差远小于球半径。
   */
  readonly samplesPerSegment?: number;
}

/** 默认采样步数；导出以便测试与关卡工具共用同一基准。 */
export const DEFAULT_SAMPLES_PER_SEGMENT = 24;

/** 向心参数化的指数。0 = 均匀、0.5 = 向心、1 = 弦长。 */
const CENTRIPETAL_ALPHA = 0.5;

/** 防止重合控制点造成除零。 */
const KNOT_EPSILON = 1e-6;

function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function lerp(a: Vec2, b: Vec2, t: number): Vec2 {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

/**
 * 参数比 `(t - from) / (to - from)`。
 *
 * 注意：**这里刻意不做 [0, 1] 钳制**。Barry–Goldman 递推里 A1 与 A3 在当前段上分别是
 * 「越过 P1 的外推」与「退回 P2 之前的外推」，比值本来就允许超出 [0,1]；一旦钳住，
 * 三次曲线会塌回控制点折线（直角轨道的样条不再切角，长度精确等于折线长）。
 * span 为 0 只在重合控制点时出现，已在 `dedupe()` 与镜像端点处理中排除，此处仅兜底。
 */
function ratio(t: number, from: number, to: number): number {
  const span = to - from;
  return span > 0 ? (t - from) / span : 0;
}

/** 去掉连续重合的控制点，避免向心参数化下段跨度为 0。 */
function dedupe(points: readonly Vec2[]): Vec2[] {
  const out: Vec2[] = [points[0]!];
  for (let i = 1; i < points.length; i += 1) {
    const prev = out[out.length - 1]!;
    const cur = points[i]!;
    if (cur.x !== prev.x || cur.y !== prev.y) out.push(cur);
  }
  return out;
}

function assertFinitePoint(point: Vec2, index: number): void {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    throw new RangeError(`控制点[${index}] 坐标必须是有限数，收到 (${point.x}, ${point.y})`);
  }
}

/**
 * Barry–Goldman 递归插值求向心 Catmull-Rom 在参数 `t` 处的点。
 * `t0..t3` 是四个控制点的累积参数，`t` 必须落在 `[t1, t2]` 内（即 P1→P2 段）。
 */
function catmullRomAt(
  p0: Vec2,
  p1: Vec2,
  p2: Vec2,
  p3: Vec2,
  t0: number,
  t1: number,
  t2: number,
  t3: number,
  t: number
): Vec2 {
  const a1 = lerp(p0, p1, ratio(t, t0, t1));
  const a2 = lerp(p1, p2, ratio(t, t1, t2));
  const a3 = lerp(p2, p3, ratio(t, t2, t3));
  const b1 = lerp(a1, a2, ratio(t, t0, t2));
  const b2 = lerp(a2, a3, ratio(t, t1, t3));
  return lerp(b1, b2, ratio(t, t1, t2));
}

/**
 * 控制点 → 采样折线 + 弧长前缀和。
 *
 * 曲线**必定**从 `controlPoints[0]` 起、到最后一个控制点止：实现上给首尾各补一个
 * **镜像虚拟点**（P₋₁ = 2P₀ − P₁），让端点切线与真实的第一/最后一段方向一致。
 *
 * @throws RangeError 控制点少于 2 个、去重后不足 2 个、坐标非有限数、或采样步数 < 1
 */
export function sampleTrack(
  controlPoints: readonly Vec2[],
  options: TrackOptions = {}
): Track {
  const samplesPerSegment = options.samplesPerSegment ?? DEFAULT_SAMPLES_PER_SEGMENT;
  if (!Number.isInteger(samplesPerSegment) || samplesPerSegment < 1) {
    throw new RangeError(`samplesPerSegment 必须是 ≥ 1 的整数，收到 ${samplesPerSegment}`);
  }
  if (controlPoints.length < 2) {
    throw new RangeError('轨道至少需要 2 个控制点');
  }

  controlPoints.forEach(assertFinitePoint);

  // 先去掉连续重合点，否则向心参数化下该段的节点跨度为 0，插值会退化。
  const control = dedupe(controlPoints);
  if (control.length < 2) {
    throw new RangeError('控制点去重后不足 2 个（全部重合），无法构成轨道');
  }

  // 首尾补**镜像**虚拟点（不是复制）：P₋₁ = 2P₀ − P₁、Pₙ = 2Pₙ₋₁ − Pₙ₋₂。
  // 这样首段切线方向就等于真实的出射方向、末段同理，且相邻点距离恒为正，
  // 节点跨度不会为 0（复制端点会造出 0 跨度，逼着外层去钳参数比，反而把曲线压成折线）。
  const head = control[0]!;
  const nextToHead = control[1]!;
  const tail = control[control.length - 1]!;
  const prevToTail = control[control.length - 2]!;
  const extended: Vec2[] = [
    { x: 2 * head.x - nextToHead.x, y: 2 * head.y - nextToHead.y },
    ...control,
    { x: 2 * tail.x - prevToTail.x, y: 2 * tail.y - prevToTail.y }
  ];

  const points: Vec2[] = [];
  for (let seg = 0; seg < control.length - 1; seg += 1) {
    const p0 = extended[seg]!;
    const p1 = extended[seg + 1]!;
    const p2 = extended[seg + 2]!;
    const p3 = extended[seg + 3]!;

    const t0 = 0;
    const t1 = t0 + Math.max(KNOT_EPSILON, Math.pow(distance(p0, p1), CENTRIPETAL_ALPHA));
    const t2 = t1 + Math.max(KNOT_EPSILON, Math.pow(distance(p1, p2), CENTRIPETAL_ALPHA));
    const t3 = t2 + Math.max(KNOT_EPSILON, Math.pow(distance(p2, p3), CENTRIPETAL_ALPHA));

    // 每段贡献 [t1, t2) 共 samplesPerSegment 个点；段末点由下一段（或收尾）补，避免重复点。
    for (let i = 0; i < samplesPerSegment; i += 1) {
      const t = t1 + ((t2 - t1) * i) / samplesPerSegment;
      points.push(catmullRomAt(p0, p1, p2, p3, t0, t1, t2, t3, t));
    }
  }
  points.push(control[control.length - 1]!);

  const cum: number[] = [0];
  for (let i = 1; i < points.length; i += 1) {
    cum.push(cum[i - 1]! + distance(points[i - 1]!, points[i]!));
  }

  return {
    points,
    cum,
    length: cum[cum.length - 1]!,
    controlPoints: [...controlPoints]
  };
}

/**
 * 二分找 `dist` 落在哪一段：返回最大的 `i` 使 `cum[i] <= dist`。
 * 段内线性插值即可，因为采样已经足够密。
 */
function segmentIndexFor(track: Track, dist: number): number {
  let lo = 0;
  let hi = track.cum.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (track.cum[mid]! <= dist) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }
  return lo;
}

/**
 * 弧长 `dist` → 轨道姿态。
 *
 * 越界按「夹到端点」处理而不是抛错：彩球链的 `dist` 会随时间推进越过轨道末端（球进洞），
 * 引擎需要能安全地取到洞口姿态而不是崩在查询上。`dist` 非有限数则抛错（属于编程错误）。
 */
export function poseAt(track: Track, dist: number): TrackPose {
  if (!Number.isFinite(dist)) {
    throw new RangeError(`dist 必须是有限数，收到 ${dist}`);
  }

  const clamped = Math.min(Math.max(dist, 0), track.length);
  const i = segmentIndexFor(track, clamped);
  const a = track.points[i]!;

  // 末点（或零长轨道）：没有后一段可插值，切线角沿用上一段方向，兜底为 0。
  if (i >= track.points.length - 1) {
    const prev = i > 0 ? track.points[i - 1]! : a;
    return { x: a.x, y: a.y, angle: Math.atan2(a.y - prev.y, a.x - prev.x) };
  }

  const b = track.points[i + 1]!;
  const segLen = track.cum[i + 1]! - track.cum[i]!;
  const t = segLen > 0 ? (clamped - track.cum[i]!) / segLen : 0;

  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    angle: Math.atan2(b.y - a.y, b.x - a.x)
  };
}

/** 轴对齐包围盒。 */
export interface Bounds {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

/**
 * 轨道（含控制点）的包围盒，向外扩 `padding`。
 *
 * 两处要用它：渲染层据此把世界坐标等比映射进画布（含样条在直角处的外扩余量），
 * 玩法层据此判定弹球飞出世界即销毁。
 */
export function boundsOf(track: Track, padding = 0): Bounds {
  if (!Number.isFinite(padding) || padding < 0) {
    throw new RangeError(`padding 必须是 ≥ 0 的有限数，收到 ${padding}`);
  }
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  const visit = (p: Vec2): void => {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  };
  for (const p of track.points) visit(p);
  for (const p of track.controlPoints) visit(p);
  return {
    minX: minX - padding,
    minY: minY - padding,
    maxX: maxX + padding,
    maxY: maxY + padding
  };
}

/** 点是否落在包围盒外（含边界上算在内）。 */
export function isOutsideBounds(point: Vec2, bounds: Bounds): boolean {
  return (
    point.x < bounds.minX || point.x > bounds.maxX || point.y < bounds.minY || point.y > bounds.maxY
  );
}

/**
 * 把任意点投影到轨道上，返回最近的弧长位置。
 *
 * 逐段算「点到线段」的垂足距离取最小，O(采样数)。命中层用它把「弹球碰到球的位置」
 * 换成链能用的 `dist`。轨道采样密（每段默认 24 步），投影误差在半个采样间距内。
 */
export function projectDist(track: Track, point: Vec2): number {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    throw new RangeError(`投影点坐标必须是有限数，收到 (${point.x}, ${point.y})`);
  }
  let bestDist = 0;
  let bestSqr = Number.POSITIVE_INFINITY;
  const pts = track.points;
  for (let i = 0; i < pts.length - 1; i += 1) {
    const a = pts[i]!;
    const b = pts[i + 1]!;
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const len2 = abx * abx + aby * aby;
    const t = len2 > 0 ? Math.min(1, Math.max(0, ((point.x - a.x) * abx + (point.y - a.y) * aby) / len2)) : 0;
    const cx = a.x + abx * t;
    const cy = a.y + aby * t;
    const sqr = (point.x - cx) * (point.x - cx) + (point.y - cy) * (point.y - cy);
    if (sqr < bestSqr) {
      bestSqr = sqr;
      bestDist = track.cum[i]! + Math.sqrt(len2) * t;
    }
  }
  return bestDist;
}

/** 把 `dist` 夹到 `[0, length]`，供链推进与命中判定复用同一套边界语义。 */
export function clampTrackDist(track: Track, dist: number): number {
  return Math.min(Math.max(dist, 0), track.length);
}
