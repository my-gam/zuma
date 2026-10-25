import { describe, expect, it } from 'vitest';
import {
  archimedeanSpiral,
  decideAdvance,
  generateMarbleColors,
  INITIAL_REWIND_STATE,
  isProjectileLost,
  levelBounds,
  levelById,
  LEVELS,
  LEVEL_COUNT,
  rewindSchedule,
  serpentine,
  speedAt,
  spacingOf,
  buildTrack,
  WORLD_SIZE,
  type LevelSpec
} from '../src/index';
import { isMarbleColor, MARBLE_COLORS } from '../src/types';

/** 固定种子 mulberry32：让「随机序列」在测试里完全可复现。 */
function lcg(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 7), 1 | a);
    t = (t ^ (t >>> 14)) | 0;
    t = (t + Math.imul(t ^ (t >>> 4), 1 | t)) | 0;
    return ((t ^ (t >>> 15)) >>> 0) / 4294967296;
  };
}

describe('archimedeanSpiral', () => {
  it('半径由外向内单调收缩，点数正确', () => {
    const pts = archimedeanSpiral({ cx: 500, cy: 500, turns: 2, rStart: 400, rEnd: 120, count: 30 });
    expect(pts).toHaveLength(30);
    const radius = pts.map((p) => Math.hypot(p.x - 500, p.y - 500));
    expect(radius[0]).toBeCloseTo(400, 6);
    expect(radius[radius.length - 1]).toBeCloseTo(120, 6);
    for (let i = 1; i < radius.length; i += 1) {
      expect(radius[i]!).toBeLessThan(radius[i - 1]!);
    }
  });

  it('非法参数抛错', () => {
    const base = { cx: 0, cy: 0, turns: 1, rStart: 100, rEnd: 10, count: 10 };
    expect(() => archimedeanSpiral({ ...base, count: 1 })).toThrow(RangeError);
    expect(() => archimedeanSpiral({ ...base, turns: 0 })).toThrow(RangeError);
    expect(() => archimedeanSpiral({ ...base, rStart: 10, rEnd: 10 })).toThrow(RangeError);
    expect(() => archimedeanSpiral({ ...base, rEnd: 0 })).toThrow(RangeError);
  });

  it('起点角决定首个点的方位', () => {
    const a = archimedeanSpiral({ cx: 0, cy: 0, turns: 1, rStart: 100, rEnd: 50, count: 8 });
    const b = archimedeanSpiral({
      cx: 0,
      cy: 0,
      turns: 1,
      rStart: 100,
      rEnd: 50,
      count: 8,
      startAngle: Math.PI / 2
    });
    expect(a[0]!.x).toBeCloseTo(100, 6);
    expect(b[0]!.y).toBeCloseTo(100, 6);
  });
});

describe('serpentine', () => {
  it('在给定矩形带内折返，纵向单调下移', () => {
    const pts = serpentine({ cx: 500, cy: 500, width: 600, height: 600, folds: 3, count: 40 });
    expect(pts).toHaveLength(40);
    for (let i = 1; i < pts.length; i += 1) {
      expect(pts[i]!.y).toBeGreaterThanOrEqual(pts[i - 1]!.y);
    }
    for (const p of pts) {
      expect(p.x).toBeGreaterThanOrEqual(500 - 300 - 1e-9);
      expect(p.x).toBeLessThanOrEqual(500 + 300 + 1e-9);
    }
  });

  it('非法参数抛错', () => {
    const base = { cx: 0, cy: 0, width: 100, height: 100, folds: 2, count: 10 };
    expect(() => serpentine({ ...base, folds: 0 })).toThrow(RangeError);
    expect(() => serpentine({ ...base, width: 0 })).toThrow(RangeError);
    expect(() => serpentine({ ...base, count: 1.5 })).toThrow(RangeError);
  });
});

describe('关卡表完整性（遍历 12 关）', () => {
  it('id 从 1 连续、名称唯一', () => {
    expect(LEVEL_COUNT).toBe(LEVELS.length);
    expect(LEVELS.map((l) => l.id)).toEqual(LEVELS.map((_, i) => i + 1));
    const names = LEVELS.map((l) => l.name);
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) expect(name.length).toBeGreaterThan(0);
  });

  it('每关轨道都建得出来，长度 > 0 且链放得下', () => {
    for (const spec of LEVELS) {
      const track = buildTrack(spec);
      expect(track.length).toBeGreaterThan(0);
      // 开局链最多占轨道的 85%，否则玩家一上来就没有腾挪空间。
      expect(spec.marbles * spacingOf(spec)).toBeLessThanOrEqual(track.length * 0.85);
    }
  });

  it('轨道（含样条外扩与球半径）不出世界边界', () => {
    for (const spec of LEVELS) {
      const b = levelBounds(spec);
      expect(b.minX, `level ${spec.id} minX`).toBeGreaterThanOrEqual(0);
      expect(b.minY, `level ${spec.id} minY`).toBeGreaterThanOrEqual(0);
      expect(b.maxX, `level ${spec.id} maxX`).toBeLessThanOrEqual(WORLD_SIZE);
      expect(b.maxY, `level ${spec.id} maxY`).toBeLessThanOrEqual(WORLD_SIZE);
    }
  });

  it('发射器在世界内且不压在轨道起点上', () => {
    for (const spec of LEVELS) {
      const { x, y } = spec.launcher;
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(WORLD_SIZE);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(WORLD_SIZE);
      const start = spec.controlPoints[0]!;
      expect(Math.hypot(x - start.x, y - start.y)).toBeGreaterThan(spec.radius * 2);
    }
  });

  it('难度单调：色数、球数、速度都不回退', () => {
    for (let i = 1; i < LEVELS.length; i += 1) {
      expect(LEVELS[i]!.colors).toBeGreaterThanOrEqual(LEVELS[i - 1]!.colors);
      expect(LEVELS[i]!.marbles).toBeGreaterThan(LEVELS[i - 1]!.marbles);
      expect(LEVELS[i]!.speed).toBeGreaterThanOrEqual(LEVELS[i - 1]!.speed);
      expect(LEVELS[i]!.radius).toBeLessThanOrEqual(LEVELS[i - 1]!.radius);
    }
  });

  it('参数取值域合法', () => {
    for (const spec of LEVELS) {
      expect(spec.colors).toBeGreaterThanOrEqual(2);
      expect(spec.colors).toBeLessThanOrEqual(MARBLE_COLORS.length);
      expect(spec.marbles).toBeGreaterThanOrEqual(3);
      expect(spec.radius).toBeGreaterThan(0);
      expect(spec.nextQueue).toBeGreaterThanOrEqual(1);
      expect(spec.maxSpeed).toBeGreaterThanOrEqual(spec.speed);
    }
  });

  it('倒退段解析合法且按进度递增不重叠', () => {
    for (const spec of LEVELS) {
      const track = buildTrack(spec);
      const steps = rewindSchedule(spec.rewind, track.length);
      expect(steps).toHaveLength(spec.rewind.length);
      let previousBack = 0;
      for (const step of steps) {
        expect(step.backTo).toBeGreaterThan(previousBack);
        expect(step.atDist).toBeGreaterThan(step.backTo);
        expect(step.atDist).toBeLessThan(track.length);
        previousBack = step.backTo;
      }
    }
  });

  it('第 4 关起才出现倒退段（前期先教会玩家瞄准）', () => {
    for (const spec of LEVELS) {
      if (spec.id < 4) expect(spec.rewind, `level ${spec.id}`).toHaveLength(0);
      else expect(spec.rewind.length, `level ${spec.id}`).toBeGreaterThan(0);
    }
  });

  it('levelById 命中与越界', () => {
    expect(levelById(1).name).toBe(LEVELS[0]!.name);
    expect(() => levelById(0)).toThrow(/不存在/);
    expect(() => levelById(LEVEL_COUNT + 1)).toThrow(RangeError);
  });
});

describe('generateMarbleColors', () => {
  const spec = { colors: 4, marbles: 40 };

  it('长度正确、颜色都在调色板内', () => {
    const seq = generateMarbleColors(spec, lcg(1));
    expect(seq).toHaveLength(40);
    for (const c of seq) expect(isMarbleColor(c)).toBe(true);
    const allowed = new Set(MARBLE_COLORS.slice(0, 4));
    for (const c of seq) expect(allowed.has(c)).toBe(true);
  });

  it('绝不出场开局三连（否则等于白送消合）', () => {
    for (const seed of [1, 7, 42, 1337, 90210]) {
      const seq = generateMarbleColors({ colors: 6, marbles: 120 }, lcg(seed));
      for (let i = 2; i < seq.length; i += 1) {
        expect(seq[i] === seq[i - 1] && seq[i] === seq[i - 2], `seed ${seed} @${i}`).toBe(false);
      }
    }
  });

  it('同种子同结果（可复现，用于回归与回放）', () => {
    expect(generateMarbleColors(spec, lcg(99))).toEqual(generateMarbleColors(spec, lcg(99)));
    expect(generateMarbleColors(spec, lcg(1))).not.toEqual(generateMarbleColors(spec, lcg(2)));
  });

  it('两种颜色也要能排长龙而不三连', () => {
    const seq = generateMarbleColors({ colors: 2, marbles: 200 }, lcg(5));
    for (let i = 2; i < seq.length; i += 1) {
      expect(seq[i] === seq[i - 1] && seq[i] === seq[i - 2]).toBe(false);
    }
  });

  it('边界：0 颗与 1 颗', () => {
    expect(generateMarbleColors({ colors: 3, marbles: 0 }, lcg(1))).toEqual([]);
    expect(generateMarbleColors({ colors: 3, marbles: 1 }, lcg(1))).toHaveLength(1);
  });

  it('单色调色板 + ≥3 颗数学上不可能避开三连，直接抛错', () => {
    expect(() => generateMarbleColors({ colors: 1, marbles: 3 }, lcg(1))).toThrow(/单色调色板/);
    expect(generateMarbleColors({ colors: 1, marbles: 2 }, lcg(1))).toHaveLength(2);
  });

  it('非法球数抛错', () => {
    expect(() => generateMarbleColors({ colors: 3, marbles: -1 }, lcg(1))).toThrow(RangeError);
    expect(() => generateMarbleColors({ colors: 3, marbles: 2.5 }, lcg(1))).toThrow(RangeError);
  });
});

describe('rewindSchedule 校验', () => {
  it('解析成绝对弧长', () => {
    expect(rewindSchedule([{ atProgress: 0.5, backProgress: 0.25 }], 200)).toEqual([
      { atDist: 100, backTo: 50 }
    ]);
  });

  it('空触发表达为空数组', () => {
    expect(rewindSchedule([], 100)).toEqual([]);
  });

  it('比例非法抛错', () => {
    expect(() => rewindSchedule([{ atProgress: 0.2, backProgress: 0.4 }], 100)).toThrow(RangeError);
    expect(() => rewindSchedule([{ atProgress: 1, backProgress: 0.5 }], 100)).toThrow(RangeError);
    expect(() => rewindSchedule([{ atProgress: 0.5, backProgress: 0 }], 100)).toThrow(RangeError);
  });

  it('段与段重叠抛错（刚转前进又要倒退没有意义）', () => {
    expect(() =>
      rewindSchedule(
        [
          { atProgress: 0.6, backProgress: 0.4 },
          { atProgress: 0.5, backProgress: 0.3 }
        ],
        100
      )
    ).toThrow(/重叠/);
  });

  it('轨道长度非法抛错', () => {
    expect(() => rewindSchedule([], 0)).toThrow(RangeError);
    expect(() => rewindSchedule([], Number.NaN)).toThrow(RangeError);
  });
});

describe('decideAdvance 冲-缩-再冲节拍', () => {
  const steps = rewindSchedule(
    [
      { atProgress: 0.4, backProgress: 0.2 },
      { atProgress: 0.8, backProgress: 0.6 }
    ],
    100
  );

  it('未到触发点时一直前进', () => {
    const d = decideAdvance(steps, 30, INITIAL_REWIND_STATE);
    expect(d.direction).toBe(1);
    expect(d.state).toEqual(INITIAL_REWIND_STATE);
  });

  it('够到触发点转为倒退', () => {
    const d = decideAdvance(steps, 41, INITIAL_REWIND_STATE);
    expect(d.direction).toBe(-1);
    expect(d.state.step).toBe(0);
  });

  it('退回到位后转回前进，且不会重复触发同一段', () => {
    let state = decideAdvance(steps, 41, INITIAL_REWIND_STATE).state;
    expect(decideAdvance(steps, 30, state).direction).toBe(-1);
    const flipped = decideAdvance(steps, 20, state);
    expect(flipped.direction).toBe(1);
    // 已经 fired 到下一段，链头再退回 41 以下也不会触发
    expect(decideAdvance(steps, 30, flipped.state).direction).toBe(1);
    expect(decideAdvance(steps, 30, flipped.state).state.fired).toBe(1);
  });

  it('两段依次触发，走完永远前进', () => {
    let state = INITIAL_REWIND_STATE;
    const log: string[] = [];
    for (const dist of [10, 39, 41, 25, 19, 50, 79, 81, 65, 59, 70, 99]) {
      const d = decideAdvance(steps, dist, state);
      log.push(`${dist}:${d.direction > 0 ? 'F' : 'B'}`);
      state = d.state;
    }
    expect(log.join(' ')).toBe(
      '10:F 39:F 41:B 25:B 19:F 50:F 79:F 81:B 65:B 59:F 70:F 99:F'
    );
    expect(state.fired).toBe(2);
  });

  it('段数为 0 时永远前进', () => {
    expect(decideAdvance([], 1e6, INITIAL_REWIND_STATE).direction).toBe(1);
  });

  it('游标越界（旧快照）不会卡死，交回前进', () => {
    expect(decideAdvance(steps, 50, { step: 9, fired: 9 }).direction).toBe(1);
  });
});

describe('speedAt', () => {
  const spec = { speed: 30, accelerate: 2, maxSpeed: 50 } as LevelSpec;

  it('线性加速并封顶', () => {
    expect(speedAt(spec, 0)).toBe(30);
    expect(speedAt(spec, 5)).toBe(40);
    expect(speedAt(spec, 10)).toBe(50);
    expect(speedAt(spec, 999)).toBe(50);
  });

  it('非法时长抛错', () => {
    expect(() => speedAt(spec, -1)).toThrow(RangeError);
    expect(() => speedAt(spec, Number.NaN)).toThrow(RangeError);
  });
});

describe('小工具', () => {
  it('spacingOf 就是直径', () => {
    expect(spacingOf({ radius: 21 } as LevelSpec)).toBe(42);
  });

  it('levelBounds 至少包含球半径的余量', () => {
    const spec = LEVELS[0]!;
    const tight = levelBounds(spec);
    const padded = levelBounds(spec, 100);
    expect(padded.minX).toBeLessThan(tight.minX);
    expect(padded.maxX).toBeGreaterThan(tight.maxX);
  });

  it('非法 padding 抛错', () => {
    expect(() => levelBounds(LEVELS[0]!, -1)).toThrow(RangeError);
  });

  it('世界常数与索引导出对齐（防止 barrel 漏导出）', () => {
    expect(WORLD_SIZE).toBe(1000);
    expect(typeof isProjectileLost).toBe('function');
  });
});
