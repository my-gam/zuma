import { describe, expect, it } from 'vitest';
import { createChain, type Chain, type Marble } from '../src/chain';
import { collapseChain, findRuns, hasRun, removeRuns } from '../src/match';
import { scoreMatch } from '../src/score';
import type { MarbleColor } from '../src/types';

const SPACING = 10;

/** 全紧贴的链：`colors[0]` 是头球。 */
function tight(...colors: MarbleColor[]): Chain {
  return createChain(colors, { spacing: SPACING });
}

/** 手工构造带空隙的链：传入 [颜色, dist] 对。 */
function at(pairs: readonly (readonly [MarbleColor, number])[]): Chain {
  const marbles: Marble[] = pairs.map(([color, dist], i) => ({ id: i, color, dist }));
  return { spacing: SPACING, marbles };
}

describe('findRuns', () => {
  it('不足 3 连什么都找不到', () => {
    expect(findRuns(tight('red', 'red'))).toEqual([]);
    expect(findRuns(tight('red', 'green', 'red'))).toEqual([]);
    expect(hasRun(tight('red', 'red'))).toBe(false);
  });

  it('恰好 3 连：定位到 from / to / length', () => {
    const runs = findRuns(tight('red', 'red', 'red', 'green'));
    expect(runs).toHaveLength(1);
    expect(runs[0]).toEqual({ from: 0, to: 2, color: 'red', length: 3 });
    expect(hasRun(tight('red', 'red', 'red', 'green'))).toBe(true);
  });

  it('更长的同色段是一个 run，不是多个重叠 run', () => {
    const runs = findRuns(tight('blue', 'blue', 'blue', 'blue', 'blue'));
    expect(runs).toEqual([{ from: 0, to: 4, color: 'blue', length: 5 }]);
  });

  it('多段分别报告，按下标升序', () => {
    // 下标：0红 1红 2红 | 3绿 | 4蓝 5蓝 6蓝 7蓝
    const runs = findRuns(
      tight('red', 'red', 'red', 'green', 'blue', 'blue', 'blue', 'blue')
    );
    expect(runs.map((r) => `${r.color}:${r.from}-${r.to}`)).toEqual(['red:0-2', 'blue:4-7']);
  });

  it('隔着空隙的同色不算一串（断开的两截不能白送消合）', () => {
    // 头球红@40 与红@20 之间间隙 10 > spacing，属断开；后面三颗紧贴才成 run。
    const gapped = at([
      ['red', 40],
      ['red', 20],
      ['red', 10],
      ['red', 0]
    ]);
    expect(findRuns(gapped).map((r) => `${r.color}:${r.from}-${r.to}:${r.length}`)).toEqual([
      'red:1-3:3'
    ]);
  });

  it('空隙把 2 + 1 拆开时谁也凑不满 3 连', () => {
    const gapped = at([
      ['red', 30],
      ['red', 10],
      ['blue', 0]
    ]);
    expect(findRuns(gapped)).toEqual([]);
  });

  it('minRun 可调，且非法值抛错', () => {
    expect(findRuns(tight('red', 'red'), 2)).toEqual([{ from: 0, to: 1, color: 'red', length: 2 }]);
    expect(() => findRuns(tight('red'), 1)).toThrow(RangeError);
    expect(() => findRuns(tight('red'), 2.5)).toThrow(RangeError);
  });

  it('空链与单球链安全', () => {
    expect(findRuns(tight())).toEqual([]);
    expect(findRuns(tight('red'))).toEqual([]);
  });
});

describe('removeRuns', () => {
  it('多个 run 一起摘不会让下标错位', () => {
    const chain = tight('red', 'red', 'red', 'green', 'blue', 'blue', 'blue', 'blue');
    const out = removeRuns(chain, findRuns(chain));
    expect(out.marbles.map((m) => m.color)).toEqual(['green']);
    // 剩余球的位置不被改动（移动由 closeGaps 负责）
    expect(out.marbles[0]!.dist).toBe(chain.marbles[3]!.dist);
  });

  it('重叠区间只摘一次', () => {
    const chain = tight('red', 'red', 'red');
    const out = removeRuns(chain, [
      { from: 0, to: 2, color: 'red', length: 3 },
      { from: 1, to: 2, color: 'red', length: 2 }
    ]);
    expect(out.marbles).toEqual([]);
  });

  it('原链不被改动', () => {
    const chain = tight('red', 'red', 'red');
    removeRuns(chain, findRuns(chain));
    expect(chain.marbles).toHaveLength(3);
  });

  it('空 run 列表返回同一引用（状态机每帧快筛不产生垃圾快照）', () => {
    const chain = tight('red', 'green');
    expect(removeRuns(chain, [])).toBe(chain);
  });
});

describe('collapseChain 连锁', () => {
  it('没有可消的链：零事件、零分、原样返回', () => {
    const chain = tight('red', 'green', 'blue');
    const res = collapseChain(chain);
    expect(res.events).toEqual([]);
    expect(res.points).toBe(0);
    expect(res.removed).toBe(0);
    expect(res.maxCombo).toBe(0);
    expect(res.chain.marbles.map((m) => m.color)).toEqual(['red', 'green', 'blue']);
  });

  it('单波消合：3 连得 300 分，链剩一个头球', () => {
    const res = collapseChain(tight('green', 'red', 'red', 'red'));
    expect(res.maxCombo).toBe(1);
    expect(res.points).toBe(scoreMatch(3, 1));
    expect(res.removed).toBe(3);
    expect(res.chain.marbles.map((m) => m.color)).toEqual(['green']);
  });

  it('消掉中间段后两侧同色合拢 → 自动打出第二波连锁（倍率 1.5）', () => {
    // 头 → 尾：green green | red red red | green green
    const chain = tight('green', 'green', 'red', 'red', 'red', 'green', 'green');
    const res = collapseChain(chain);

    expect(res.events.map((e) => e.combo)).toEqual([1, 2]);
    expect(res.events[0]!.runs.map((r) => r.color)).toEqual(['red']);
    expect(res.events[1]!.runs.map((r) => r.length)).toEqual([4]);
    expect(res.points).toBe(scoreMatch(3, 1) + scoreMatch(4, 2));
    expect(res.removed).toBe(7);
    expect(res.chain.marbles).toEqual([]);
  });

  it('三波连珠：嵌套结构逐层引爆，每波倍率递增一档', () => {
    // 头 → 尾：红红 [绿绿 [蓝蓝蓝] 绿绿] 红红
    // 第 1 波消蓝，绿绿 + 绿绿 合拢成 4 绿；第 2 波消绿，两侧红合拢成 4 红；第 3 波清空。
    const chain = tight(
      'red',
      'red',
      'green',
      'green',
      'blue',
      'blue',
      'blue',
      'green',
      'green',
      'red',
      'red'
    );
    const res = collapseChain(chain);
    expect(res.events.map((e) => e.combo)).toEqual([1, 2, 3]);
    expect(res.maxCombo).toBe(3);
    expect(res.events.map((e) => e.runs.map((r) => `${r.color}×${r.length}`).join('+'))).toEqual([
      'blue×3',
      'green×4',
      'red×4'
    ]);
    expect(res.removed).toBe(11);
    expect(res.chain.marbles).toEqual([]);
    expect(res.points).toBe(scoreMatch(3, 1) + scoreMatch(4, 2) + scoreMatch(4, 3));
  });

  it('同一波里的多处消合共享该波倍率', () => {
    // 蓝蓝蓝 + 黄黄黄 互不相邻 → 同一波两个 run，都按 combo 1 计分
    const chain = tight('blue', 'blue', 'blue', 'red', 'yellow', 'yellow', 'yellow');
    const res = collapseChain(chain);
    expect(res.events).toHaveLength(1);
    expect(res.events[0]!.runs.map((r) => r.color)).toEqual(['blue', 'yellow']);
    expect(res.events[0]!.points).toBe(scoreMatch(3, 1) * 2);
    expect(res.maxCombo).toBe(1);
  });

  it('分数恒等于逐波 scoreMatch 之和（防止结算与展示分叉）', () => {
    const chain = tight('green', 'green', 'red', 'red', 'red', 'green', 'green', 'blue');
    const res = collapseChain(chain);
    const manual = res.events.reduce(
      (sum, e) => sum + e.runs.reduce((s, r) => s + scoreMatch(r.length, e.combo), 0),
      0
    );
    expect(res.points).toBe(manual);
    expect(res.points).toBeGreaterThan(0);
  });

  it('结算后的链不再有任何可消 run（幂等）', () => {
    const chain = tight('green', 'green', 'red', 'red', 'red', 'green', 'green');
    const once = collapseChain(chain);
    const twice = collapseChain(once.chain);
    expect(twice.events).toEqual([]);
  });
});
