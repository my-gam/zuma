import { describe, expect, it } from 'vitest';
import { createChain, insertMarble, type Chain } from '../src/chain';
import {
  fire,
  isProjectileLost,
  projectileAngle,
  projectileSpeed,
  rayCircleT,
  stepProjectile,
  sweepProjectile
} from '../src/projectile';
import { boundsOf, sampleTrack, type Track, type Vec2 } from '../src/track';

/** 沿 x 轴的正向直线轨道，dist 恰好等于 x，便于手算断言。 */
const FLAT: Track = sampleTrack(
  [
    { x: 0, y: 0 },
    { x: 1000, y: 0 }
  ],
  { samplesPerSegment: 10 }
);

/** 两颗球：green@80（头）、red@50，半径 15、紧贴间距 30。 */
function twoBalls(): Chain {
  return createChain(['green', 'red'], { spacing: 30, headDist: 80 });
}

function shooter(color: 'blue' = 'blue', speed = 1000) {
  return fire({ id: 1, color, origin: { x: 0, y: 0 }, angle: 0, speed });
}

describe('fire', () => {
  it('把角度与初速换成速度向量', () => {
    const p = fire({ id: 1, color: 'red', origin: { x: 5, y: 7 }, angle: Math.PI / 2, speed: 200 });
    expect(p.pos).toEqual({ x: 5, y: 7 });
    expect(p.vel.x).toBeCloseTo(0, 9);
    expect(p.vel.y).toBeCloseTo(200, 9);
  });

  it('非法速度、角度、原点都抛错', () => {
    const base = { id: 1, color: 'red' as const, origin: { x: 0, y: 0 }, angle: 0 };
    expect(() => fire({ ...base, speed: 0 })).toThrow(RangeError);
    expect(() => fire({ ...base, speed: -5 })).toThrow(RangeError);
    expect(() => fire({ ...base, speed: Number.NaN })).toThrow(RangeError);
    expect(() => fire({ ...base, angle: Number.NaN, speed: 10 })).toThrow(/angle/);
    expect(() => fire({ ...base, speed: 10, origin: { x: Number.NaN, y: 0 } })).toThrow(
      /origin\.x/
    );
  });
});

describe('stepProjectile', () => {
  it('按秒速 × 毫秒推进', () => {
    const moved = stepProjectile(shooter(), 500);
    expect(moved.pos.x).toBeCloseTo(500, 6);
    expect(moved.pos.y).toBeCloseTo(0, 6);
  });

  it('dt 为 0 返回同一引用；负数与 NaN 抛错', () => {
    const p = shooter();
    expect(stepProjectile(p, 0)).toBe(p);
    expect(() => stepProjectile(p, -1)).toThrow(RangeError);
    expect(() => stepProjectile(p, Number.NaN)).toThrow(RangeError);
  });
});

describe('rayCircleT 线段与圆的首次相交', () => {
  const center: Vec2 = { x: 50, y: 0 };

  it('正穿：给出进入交点的参数', () => {
    const t = rayCircleT({ x: 0, y: 0 }, { x: 100, y: 0 }, center, 10);
    expect(t).not.toBeNull();
    expect(t).toBeCloseTo(0.4, 9); // 交点在 x = 40
  });

  it('擦边不中（无实根）返回 null', () => {
    expect(rayCircleT({ x: 0, y: 20 }, { x: 100, y: 20 }, center, 10)).toBeNull();
  });

  it('线段太短还没够到圆就结束：返回 null', () => {
    expect(rayCircleT({ x: 0, y: 0 }, { x: 20, y: 0 }, center, 10)).toBeNull();
  });

  it('圆在身后：不让「回头命中」骗过判定', () => {
    expect(rayCircleT({ x: 60, y: 0 }, { x: 100, y: 0 }, center, 5)).toBeNull();
  });

  it('起点已经在圆里 → t = 0 立即命中', () => {
    expect(rayCircleT({ x: 48, y: 0 }, { x: 100, y: 0 }, center, 10)).toBe(0);
  });

  it('零长线段（这一帧没动）只看是否已在圆内', () => {
    expect(rayCircleT({ x: 0, y: 0 }, { x: 0, y: 0 }, center, 10)).toBeNull();
    expect(rayCircleT({ x: 50, y: 0 }, { x: 50, y: 0 }, center, 10)).toBe(0);
  });

  it('非法半径抛错', () => {
    expect(() => rayCircleT({ x: 0, y: 0 }, { x: 1, y: 0 }, center, 0)).toThrow(RangeError);
    expect(() => rayCircleT({ x: 0, y: 0 }, { x: 1, y: 0 }, center, -1)).toThrow(RangeError);
  });
});

describe('sweepProjectile 扫掠命中', () => {
  it('命中最近的那颗球并停在接触点上', () => {
    const res = sweepProjectile(shooter(), 1000, twoBalls(), FLAT);
    expect(res.hit).not.toBeNull();
    // 红球在 x=50、碰撞半径 2r=30 → 接触点 x=20
    expect(res.hit!.marbleIndex).toBe(1);
    expect(res.hit!.contact.x).toBeCloseTo(20, 6);
    expect(res.projectile.pos.x).toBeCloseTo(20, 6);
    expect(res.hit!.insertDist).toBeCloseTo(20, 6); // 直线轨道上 dist == x
    expect(res.hit!.travelDistance).toBeCloseTo(20, 6);
  });

  it('高速一帧跨过两颗球也不会隧穿（不会打穿到后面那颗）', () => {
    // 速度 5000 × 16.7ms ≈ 83.5 单位位移：末位置 x=83.5 已在绿球（x=80）旁边，
    // 朴素「末位置距离判定」会漏掉红球甚至误判命中绿球。
    const fast = shooter('blue', 5000);
    const res = sweepProjectile(fast, 16.7, twoBalls(), FLAT);
    expect(res.hit!.marbleIndex).toBe(1);
    expect(res.hit!.contact.x).toBeCloseTo(20, 6);
  });

  it('没打中则正常推进到该帧终点', () => {
    const up = fire({ id: 2, color: 'red', origin: { x: 0, y: 0 }, angle: -Math.PI / 2, speed: 1000 });
    const res = sweepProjectile(up, 1000, twoBalls(), FLAT);
    expect(res.hit).toBeNull();
    expect(res.projectile.pos.y).toBeCloseTo(-1000, 6);
  });

  it('空链永远不命中', () => {
    const res = sweepProjectile(shooter(), 1000, createChain([], { spacing: 30 }), FLAT);
    expect(res.hit).toBeNull();
  });

  it('命中点可以交给 insertMarble，且不产生重叠', () => {
    const chain = twoBalls();
    const res = sweepProjectile(shooter(), 1000, chain, FLAT);
    const hit = res.hit!;
    const out = insertMarble(chain, { dist: hit.insertDist, color: 'blue', id: 9, minDist: 0 });
    // 不变量：任意相邻间距 ≥ spacing（插入不得嵌进已有球）
    for (let i = 1; i < out.marbles.length; i += 1) {
      expect(out.marbles[i - 1]!.dist - out.marbles[i]!.dist).toBeGreaterThanOrEqual(30 - 1e-9);
    }
    expect(out.marbles.map((m) => m.color)).toEqual(['green', 'red', 'blue']);
  });

  it('非法 dt 或半径抛错', () => {
    expect(() => sweepProjectile(shooter(), -1, twoBalls(), FLAT)).toThrow(RangeError);
    expect(() => sweepProjectile(shooter(), 16, twoBalls(), FLAT, 0)).toThrow(/radius/);
  });
});

describe('弹球辅助查询', () => {
  it('速度标量与方向角', () => {
    const p = fire({ id: 1, color: 'red', origin: { x: 0, y: 0 }, angle: Math.PI / 4, speed: 300 });
    expect(projectileSpeed(p)).toBeCloseTo(300, 6);
    expect(projectileAngle(p)).toBeCloseTo(Math.PI / 4, 6);
  });

  it('飞出包围盒即判定销毁', () => {
    const bounds = boundsOf(FLAT, 50);
    const inside = fire({ id: 1, color: 'red', origin: { x: 100, y: 0 }, angle: 0, speed: 1 });
    const outside = fire({ id: 2, color: 'red', origin: { x: 0, y: -9999 }, angle: 0, speed: 1 });
    expect(isProjectileLost(inside, bounds)).toBe(false);
    expect(isProjectileLost(outside, bounds)).toBe(true);
  });
});
