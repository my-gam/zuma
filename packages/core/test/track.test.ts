import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SAMPLES_PER_SEGMENT,
  clampTrackDist,
  poseAt,
  sampleTrack,
  type Vec2
} from '../src/track';

/** 两点直线轨道：起点 (0,0) → 终点 (100,0)。 */
const STRAIGHT: Vec2[] = [
  { x: 0, y: 0 },
  { x: 100, y: 0 }
];

/** 生成一段阿基米德螺线控制点（原版祖玛关卡的典型形状：由外向内收缩）。 */
function spiralControl(turns = 2.5, rOuter = 240, rInner = 40, count = 40): Vec2[] {
  const out: Vec2[] = [];
  for (let i = 0; i < count; i += 1) {
    const k = i / (count - 1);
    const angle = k * turns * Math.PI * 2;
    const r = rOuter + (rInner - rOuter) * k;
    out.push({ x: 300 + r * Math.cos(angle), y: 300 + r * Math.sin(angle) });
  }
  return out;
}

describe('sampleTrack 入参校验', () => {
  it('控制点少于 2 个直接抛错', () => {
    expect(() => sampleTrack([])).toThrow(RangeError);
    expect(() => sampleTrack([{ x: 1, y: 2 }])).toThrow(/至少需要 2 个控制点/);
  });

  it('坐标非有限数抛错，并指出是第几个点', () => {
    expect(() => sampleTrack([{ x: 0, y: 0 }, { x: Number.NaN, y: 1 }])).toThrow(/控制点\[1\]/);
    expect(() => sampleTrack([{ x: 0, y: 0 }, { x: 1, y: Number.POSITIVE_INFINITY }])).toThrow(
      /有限数/
    );
  });

  it('采样步数必须是 ≥ 1 的整数', () => {
    expect(() => sampleTrack(STRAIGHT, { samplesPerSegment: 0 })).toThrow(RangeError);
    expect(() => sampleTrack(STRAIGHT, { samplesPerSegment: 12.5 })).toThrow(RangeError);
    expect(() => sampleTrack(STRAIGHT, { samplesPerSegment: -3 })).toThrow(RangeError);
  });

  it('全部控制点重合时抛错，而不是产出一条退化轨道', () => {
    expect(() =>
      sampleTrack([
        { x: 5, y: 5 },
        { x: 5, y: 5 },
        { x: 5, y: 5 }
      ])
    ).toThrow(/去重后不足 2 个/);
  });
});

describe('sampleTrack 采样结果', () => {
  it('直线轨道长度等于两点距离，采样点数为 (段数 × 步数) + 1', () => {
    const track = sampleTrack(STRAIGHT);
    expect(track.length).toBeCloseTo(100, 6);
    expect(track.points.length).toBe((2 - 1) * DEFAULT_SAMPLES_PER_SEGMENT + 1);
  });

  it('自定义步数改变采样密度', () => {
    const coarse = sampleTrack(STRAIGHT, { samplesPerSegment: 1 });
    expect(coarse.points.length).toBe(2);
  });

  it('cum 与 points 等长、首项为 0、单调不减、末项即长度', () => {
    const track = sampleTrack(spiralControl());
    expect(track.cum.length).toBe(track.points.length);
    expect(track.cum[0]).toBe(0);
    for (let i = 1; i < track.cum.length; i += 1) {
      expect(track.cum[i]!).toBeGreaterThanOrEqual(track.cum[i - 1]!);
    }
    expect(track.cum[track.cum.length - 1]).toBeCloseTo(track.length, 9);
  });

  it('中间插入重合控制点不会造出 NaN（去重后照常成轨）', () => {
    const track = sampleTrack([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 0 },
      { x: 20, y: 0 }
    ]);
    expect(track.length).toBeCloseTo(20, 6);
    for (const p of track.points) {
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.y)).toBe(true);
    }
  });

  it('样条必定经过每个控制点（弧长表里对应的位置就是控制点）', () => {
    const control: Vec2[] = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 200, y: 100 }
    ];
    const steps = 8;
    const track = sampleTrack(control, { samplesPerSegment: steps });
    control.forEach((point, seg) => {
      const pose = poseAt(track, track.cum[seg * steps]!);
      expect(pose.x).toBeCloseTo(point.x, 9);
      expect(pose.y).toBeCloseTo(point.y, 9);
    });
  });

  it('直角处样条外扩：比控制点折线略长，但超出幅度受控', () => {
    // Catmull-Rom 是插值型样条，必定穿过直角顶点，靠顶点两侧会鼓到折线外侧，
    // 所以长度是「略大于折线」而不是切角后变短。渲染侧要按这个外扩量给轨道留边距。
    const control: Vec2[] = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 200, y: 100 }
    ];
    const polyline = 300;
    const track = sampleTrack(control);
    expect(track.length).toBeGreaterThan(Math.hypot(200, 100)); // 首尾直线
    expect(track.length).toBeGreaterThan(polyline); // 外扩
    expect(track.length).toBeLessThan(polyline * 1.05); // 但只外扩约 2.4%
  });

  it('密集控制点的平滑螺线：弧长表与真实曲线长度一致（参数化不伸缩）', () => {
    const control = spiralControl();
    let polyline = 0;
    for (let i = 1; i < control.length; i += 1) {
      polyline += Math.hypot(
        control[i]!.x - control[i - 1]!.x,
        control[i]!.y - control[i - 1]!.y
      );
    }
    const chord = Math.hypot(
      control[control.length - 1]!.x - control[0]!.x,
      control[control.length - 1]!.y - control[0]!.y
    );
    const track = sampleTrack(control);
    expect(track.length).toBeGreaterThan(chord);
    // 40 个控制点已经把螺线取得很密，样条长度与折线长度相对误差应在 1% 内。
    expect(Math.abs(track.length - polyline) / polyline).toBeLessThan(0.01);
  });

  it('同输入两次采样结果完全一致（纯函数、可安全快照）', () => {
    const control = spiralControl();
    const a = sampleTrack(control);
    const b = sampleTrack(control);
    expect(a.points).toEqual(b.points);
    expect(a.cum).toEqual(b.cum);
  });

  it('controlPoints 保留原样（含重合点），且与传入数组解耦', () => {
    const input: Vec2[] = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 0 }
    ];
    const track = sampleTrack(input);
    expect(track.controlPoints).toHaveLength(3);
    input[1] = { x: 999, y: 999 };
    expect(track.controlPoints[1]).toEqual({ x: 10, y: 0 });
  });
});

describe('poseAt 弧长查询', () => {
  it('起点与终点精确落在首末控制点上', () => {
    const track = sampleTrack(spiralControl());
    const first = poseAt(track, 0);
    const last = poseAt(track, track.length);
    expect(first.x).toBeCloseTo(track.controlPoints[0]!.x, 6);
    expect(first.y).toBeCloseTo(track.controlPoints[0]!.y, 6);
    const end = track.controlPoints[track.controlPoints.length - 1]!;
    expect(last.x).toBeCloseTo(end.x, 6);
    expect(last.y).toBeCloseTo(end.y, 6);
  });

  it('越界夹到端点：负数取起点，超出取洞口（球进洞不崩）', () => {
    const track = sampleTrack(STRAIGHT);
    expect(poseAt(track, -50)).toEqual(poseAt(track, 0));
    expect(poseAt(track, track.length + 500)).toEqual(poseAt(track, track.length));
  });

  it('直线上的姿态：中点坐标与切线角', () => {
    const track = sampleTrack(STRAIGHT);
    const mid = poseAt(track, 50);
    expect(mid.x).toBeCloseTo(50, 3);
    expect(mid.y).toBeCloseTo(0, 3);
    expect(mid.angle).toBeCloseTo(0, 3);
  });

  it('竖直向下轨道的切线角为 +PI/2（y 轴向下的 canvas 约定）', () => {
    const track = sampleTrack([
      { x: 10, y: 0 },
      { x: 10, y: 100 }
    ]);
    expect(poseAt(track, 50).angle).toBeCloseTo(Math.PI / 2, 3);
  });

  it('等弧长步进得到等距点（弧长参数化生效）', () => {
    const track = sampleTrack(spiralControl());
    const step = 10;
    const n = Math.floor(track.length / step);
    let worst = 0;
    let prev = poseAt(track, 0);
    for (let i = 1; i <= n; i += 1) {
      const cur = poseAt(track, i * step);
      worst = Math.max(worst, Math.abs(Math.hypot(cur.x - prev.x, cur.y - prev.y) - step));
      prev = cur;
    }
    expect(worst).toBeLessThan(0.5);
  });

  it('整条轨道逐点查询都不产生 NaN，且角度有限', () => {
    const track = sampleTrack(spiralControl(3, 260, 30, 60));
    for (let d = 0; d <= track.length; d += 5) {
      const pose = poseAt(track, d);
      expect(Number.isFinite(pose.x)).toBe(true);
      expect(Number.isFinite(pose.y)).toBe(true);
      expect(Number.isFinite(pose.angle)).toBe(true);
    }
  });

  it('dist 非有限数视为编程错误直接抛错', () => {
    const track = sampleTrack(STRAIGHT);
    expect(() => poseAt(track, Number.NaN)).toThrow(RangeError);
    expect(() => poseAt(track, Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});

describe('clampTrackDist', () => {
  it('把任意实数夹进 [0, length]', () => {
    const track = sampleTrack(STRAIGHT);
    expect(clampTrackDist(track, -1)).toBe(0);
    expect(clampTrackDist(track, 42)).toBe(42);
    expect(clampTrackDist(track, 1e9)).toBe(track.length);
  });
});
