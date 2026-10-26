import { describe, expect, it } from 'vitest';
import {
  advanceChain,
  closeGaps,
  createChain,
  findInsertIndex,
  gapAfter,
  hasGaps,
  headOf,
  insertMarble,
  isEmptyChain,
  marblesInWindow,
  pushChain,
  tailOf,
  type Chain
} from '../src/chain';
import { isMarbleColor, MARBLE_COLORS, MAX_MARBLE_COLORS, paletteFor } from '../src/types';

const SPACING = 10;

/** red@20（头）→ green@10 → blue@0（尾）。 */
function sampleChain(): Chain {
  return createChain(['red', 'green', 'blue'], { spacing: SPACING });
}

function dists(chain: Chain): number[] {
  return chain.marbles.map((m) => m.dist);
}

function colors(chain: Chain): string[] {
  return chain.marbles.map((m) => m.color);
}

describe('createChain', () => {
  it('按 dist 降序排布，默认尾球正好落在生成口 0', () => {
    const chain = sampleChain();
    expect(dists(chain)).toEqual([20, 10, 0]);
    expect(colors(chain)).toEqual(['red', 'green', 'blue']);
    expect(chain.spacing).toBe(SPACING);
  });

  it('支持自定义 headDist 与 startId', () => {
    const chain = createChain(['red', 'green'], { spacing: 8, headDist: 100, startId: 7 });
    expect(dists(chain)).toEqual([100, 92]);
    expect(chain.marbles.map((m) => m.id)).toEqual([7, 8]);
  });

  it('空颜色序列得到空链', () => {
    const chain = createChain([], { spacing: 10 });
    expect(chain.marbles).toEqual([]);
    expect(isEmptyChain(chain)).toBe(true);
    expect(headOf(chain)).toBeNull();
    expect(tailOf(chain)).toBeNull();
  });

  it('非法间距与非法颜色都挡在门口', () => {
    expect(() => createChain(['red'], { spacing: 0 })).toThrow(RangeError);
    expect(() => createChain(['red'], { spacing: Number.NaN })).toThrow(RangeError);
    expect(() => createChain(['red'], { spacing: -5 })).toThrow(RangeError);
    expect(() => createChain(['mauve'] as never, { spacing: 10 })).toThrow(/不是合法彩球颜色/);
    expect(() => createChain(['red'], { spacing: 10, headDist: Number.POSITIVE_INFINITY })).toThrow(
      /headDist/
    );
  });
});

describe('advanceChain', () => {
  it('整条链平移，间距与顺序不变', () => {
    const moved = advanceChain(sampleChain(), 3.5);
    expect(dists(moved)).toEqual([23.5, 13.5, 3.5]);
    expect(colors(moved)).toEqual(['red', 'green', 'blue']);
  });

  it('delta 为 0 时原样返回（不多分配一次快照）', () => {
    const chain = sampleChain();
    expect(advanceChain(chain, 0)).toBe(chain);
  });

  it('原链不被改动（不可变）', () => {
    const chain = sampleChain();
    advanceChain(chain, 100);
    expect(dists(chain)).toEqual([20, 10, 0]);
  });

  it('非有限 delta 抛错', () => {
    expect(() => advanceChain(sampleChain(), Number.NaN)).toThrow(RangeError);
  });
});

describe('pushChain 接触传播', () => {
  /** 手写一条断开链：red@100 与 green@0 之间空 90（= 9 颗球位），green 与 blue 紧贴。 */
  function brokenChain(): Chain {
    return {
      spacing: SPACING,
      marbles: [
        { id: 0, color: 'red', dist: 100 },
        { id: 1, color: 'green', dist: 0 },
        { id: 2, color: 'blue', dist: -SPACING }
      ]
    };
  }

  it('紧贴的一串整体平移（等价于刚性前进）', () => {
    const moved = pushChain(sampleChain(), 3.5);
    expect(dists(moved)).toEqual([23.5, 13.5, 3.5]);
    expect(colors(moved)).toEqual(['red', 'green', 'blue']);
  });

  it('有空隙时靠洞口那段原地不动，只有被入口推着的后段前进', () => {
    const moved = pushChain(brokenChain(), 5);
    // 链头那颗「后面没东西推它」，位移必须严格为 0，而不是旧模型里的满速爬行。
    expect(dists(moved)).toEqual([100, 5, -5]);
  });

  it('推进量先被空隙吃掉，剩余部分继续往前传', () => {
    // red@23 与 green@10 之间空 3；delta = 10 → red 只该拿到 7。
    const chain: Chain = {
      spacing: SPACING,
      marbles: [
        { id: 0, color: 'red', dist: 23 },
        { id: 1, color: 'green', dist: 10 },
        { id: 2, color: 'blue', dist: 0 }
      ]
    };
    const moved = pushChain(chain, 10);
    expect(dists(moved)).toEqual([30, 20, 10]);
    expect(hasGaps(moved)).toBe(false);
  });

  it('空隙按 1 倍链速闭合：第 9 步正好接上，第 10 步链头才动', () => {
    let chain: Chain = brokenChain();
    for (let step = 0; step < 9; step += 1) chain = pushChain(chain, 10);
    expect(chain.marbles[0]!.dist).toBe(100); // 9 步 × 10 = 90，刚好把空隙吃光
    expect(hasGaps(chain)).toBe(false);
    chain = pushChain(chain, 10);
    expect(chain.marbles[0]!.dist).toBe(110); // 接上了，前段开始被推
  });

  it('倒退（delta 小于 0）靠粘着往回拉，遇到空隙就拉不动', () => {
    const moved = pushChain(brokenChain(), -4);
    expect(dists(moved)).toEqual([100, -4, -14]);
  });

  it('任何一颗的单帧位移都不超过 delta 的绝对值（不会再有 2 倍速狂奔）', () => {
    let state = 12345;
    const rng = () => {
      state = (state * 1664525 + 1013904223) >>> 0;
      return state / 4294967296;
    };
    for (let trial = 0; trial < 300; trial += 1) {
      const count = 2 + Math.floor(rng() * 12);
      const built: { id: number; color: (typeof MARBLE_COLORS)[number]; dist: number }[] = [];
      let dist = 0;
      for (let i = 0; i < count; i += 1) {
        // 尾 → 头：随机留空隙，构造各种断开组合。
        dist += SPACING + (rng() < 0.3 ? rng() * 40 : 0);
        built.push({ id: i, color: MARBLE_COLORS[i % MARBLE_COLORS.length]!, dist });
      }
      built.reverse();
      let chain: Chain = { spacing: SPACING, marbles: built };
      for (let step = 0; step < 20; step += 1) {
        const delta = rng() < 0.25 ? -(2 + rng() * 6) : 1 + rng() * 12;
        const before = chain.marbles.map((m) => m.dist);
        const next = pushChain(chain, delta);
        next.marbles.forEach((m, i) => {
          expect(Math.abs(m.dist - before[i]!)).toBeLessThanOrEqual(Math.abs(delta) + 1e-9);
        });
        for (let i = 0; i < next.marbles.length - 1; i += 1) {
          // 不嵌球：相邻间距恒 ≥ spacing。
          expect(gapAfter(next, i)).toBeGreaterThanOrEqual(0);
        }
        chain = next;
      }
    }
  });

  it('delta 为 0 或空链时原样返回；原链不被改动', () => {
    const chain = sampleChain();
    expect(pushChain(chain, 0)).toBe(chain);
    const empty = createChain([], { spacing: SPACING });
    expect(pushChain(empty, 7)).toBe(empty);
    pushChain(chain, 100);
    expect(dists(chain)).toEqual([20, 10, 0]);
  });

  it('尾球恒被入口推着走 —— 断开只停前段，不存在永久停摆', () => {
    let chain = brokenChain();
    for (let step = 0; step < 50; step += 1) {
      const before = chain;
      chain = pushChain(chain, 3);
      const tailIndex = chain.marbles.length - 1;
      expect(chain.marbles[tailIndex]!.dist - before.marbles[tailIndex]!.dist).toBeCloseTo(3, 9);
    }
  });

  it('非有限 delta 抛错', () => {
    expect(() => pushChain(sampleChain(), Number.NaN)).toThrow(RangeError);
    expect(() => pushChain(sampleChain(), Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});

describe('findInsertIndex', () => {
  const chain = sampleChain();

  it('比头球还靠洞口 → 插在最前', () => {
    expect(findInsertIndex(chain, 999)).toBe(0);
  });

  it('比尾球还靠生成口 → 插在最后', () => {
    expect(findInsertIndex(chain, -5)).toBe(3);
  });

  it('落在两颗球之间 → 插在前一颗靠洞口侧', () => {
    expect(findInsertIndex(chain, 15)).toBe(1);
    expect(findInsertIndex(chain, 5)).toBe(2);
  });

  it('与非有限数较真是编程错误', () => {
    expect(() => findInsertIndex(chain, Number.NaN)).toThrow(RangeError);
  });
});

describe('insertMarble 挤压传播', () => {
  it('挤满的链中间插入：新球钳到贴住前一颗，后段整体让位一个 spacing', () => {
    const chain = sampleChain();
    const out = insertMarble(chain, { dist: 15, color: 'yellow', id: 99 });
    expect(colors(out)).toEqual(['red', 'yellow', 'green', 'blue']);
    // 命中点 15 会嵌进 red@20 的球体里（间距只有 5），钳到 20 - 10 = 10；
    // 于是 green 与 blue 各被顶走一个 spacing。
    expect(dists(out)).toEqual([20, 10, 0, -10]);
    expect(out.marbles[0]!.dist).toBe(20); // 前段（头球）不被推动
  });

  it('头前插入：不钳制、不挤压', () => {
    const out = insertMarble(sampleChain(), { dist: 30, color: 'yellow', id: 9 });
    expect(dists(out)).toEqual([30, 20, 10, 0]);
  });

  it('尾后插入同样不许嵌进尾球：钳到紧贴尾球之后', () => {
    const out = insertMarble(sampleChain(), { dist: -3, color: 'yellow', id: 8 });
    expect(dists(out)).toEqual([20, 10, 0, -10]);
  });

  it('生成口方向挤不动时，整条链往洞口方向拱（原版紧张感）', () => {
    const out = insertMarble(sampleChain(), { dist: 15, color: 'yellow', id: 99, minDist: 0 });
    // 钳制后尾球会到 -10，溢出 10 → 全体 +10
    expect(dists(out)).toEqual([30, 20, 10, 0]);
    expect(tailOf(out)!.dist).toBe(0);
  });

  it('插入后任意相邻间距都 ≥ spacing（不会互相吞掉）', () => {
    const out = insertMarble(sampleChain(), { dist: 12, color: 'yellow', id: 3 });
    for (let i = 1; i < out.marbles.length; i += 1) {
      expect(out.marbles[i - 1]!.dist - out.marbles[i]!.dist).toBeGreaterThanOrEqual(
        SPACING - 1e-9
      );
    }
  });

  it('原链不被改动，且非法颜色被挡', () => {
    const chain = sampleChain();
    insertMarble(chain, { dist: 15, color: 'yellow', id: 1 });
    expect(chain.marbles).toHaveLength(3);
    expect(() => insertMarble(chain, { dist: 0, color: 'pink' as never, id: 1 })).toThrow(
      RangeError
    );
  });
});

describe('closeGaps', () => {
  const gapped: Chain = {
    spacing: SPACING,
    marbles: [
      { id: 0, color: 'red', dist: 30 },
      { id: 1, color: 'green', dist: 10 },
      { id: 2, color: 'blue', dist: 0 }
    ]
  };

  it('头球不动，后段按 maxDelta 逐颗追近', () => {
    const out = closeGaps(gapped, 4);
    expect(dists(out)).toEqual([30, 14, 4]);
  });

  it('maxDelta 足够大时全部重新紧贴', () => {
    const out = closeGaps(gapped, 100);
    expect(dists(out)).toEqual([30, 20, 10]);
    expect(hasGaps(out)).toBe(false);
  });

  it('已紧贴的链不动；maxDelta 为 0 原样返回', () => {
    const tight = sampleChain();
    expect(closeGaps(tight, 5)).toBe(tight);
    expect(dists(closeGaps(gapped, 0))).toEqual([30, 10, 0]);
  });

  it('负 maxDelta 抛错', () => {
    expect(() => closeGaps(gapped, -1)).toThrow(RangeError);
  });
});

describe('间隙与窗口查询', () => {
  it('gapAfter 报出空隙，末颗之后为 0', () => {
    const chain: Chain = {
      spacing: SPACING,
      marbles: [
        { id: 0, color: 'red', dist: 30 },
        { id: 1, color: 'blue', dist: 10 }
      ]
    };
    expect(gapAfter(chain, 0)).toBe(10);
    expect(gapAfter(chain, 1)).toBe(0);
    expect(hasGaps(chain)).toBe(true);
    expect(hasGaps(sampleChain())).toBe(false);
  });

  it('marblesInWindow 含端点且不在乎传入顺序', () => {
    const chain = sampleChain();
    const hues = (ms: readonly { color: string }[]): string[] => ms.map((m) => m.color);
    expect(hues(marblesInWindow(chain, 5, 15))).toEqual(['green']);
    expect(hues(marblesInWindow(chain, 15, 5))).toEqual(['green']);
    expect(hues(marblesInWindow(chain, 0, 20))).toEqual(['red', 'green', 'blue']);
  });
});

describe('调色板', () => {
  it('paletteFor 按难度取前 N 色，顺序稳定', () => {
    expect(paletteFor(1)).toEqual(['red']);
    expect(paletteFor(3)).toEqual(['red', 'yellow', 'green']);
    expect(paletteFor(MAX_MARBLE_COLORS)).toEqual([...MARBLE_COLORS]);
  });

  it('越界色数抛错', () => {
    expect(() => paletteFor(0)).toThrow(RangeError);
    expect(() => paletteFor(MAX_MARBLE_COLORS + 1)).toThrow(RangeError);
    expect(() => paletteFor(2.5)).toThrow(RangeError);
  });

  it('isMarbleColor 只认调色板内的字符串', () => {
    expect(isMarbleColor('red')).toBe(true);
    expect(isMarbleColor('mauve')).toBe(false);
    expect(isMarbleColor(0)).toBe(false);
    expect(isMarbleColor(undefined)).toBe(false);
  });
});
