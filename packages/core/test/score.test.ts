import { describe, expect, it } from 'vitest';
import {
  ACCURACY_BONUS_MAX,
  BASE_POINTS_PER_MARBLE,
  clearBonus,
  comboMultiplier,
  COMBO_MULTIPLIER_STEP,
  EXTRA_RUN_BONUS_PER_MARBLE,
  farShotPoints,
  matchPoints,
  PERFECT_CLEAR_BONUS,
  scoreMatch
} from '../src/score';

describe('matchPoints 消合基础分', () => {
  it('连珠越长单球价值越高（超线性）', () => {
    // 钉死公式：n=3→300，4→600，5→1000，6→1500
    expect([3, 4, 5, 6].map(matchPoints)).toEqual([300, 600, 1000, 1500]);
  });

  it('不足 3 连不给分', () => {
    expect(matchPoints(0)).toBe(0);
    expect(matchPoints(2)).toBe(0);
  });

  it('3 连恰为「球数 × 基础分」，更长串才吃到额外斜率', () => {
    expect(matchPoints(3)).toBe(3 * BASE_POINTS_PER_MARBLE);
    expect(matchPoints(5)).toBe(
      5 * BASE_POINTS_PER_MARBLE + 2 * 5 * EXTRA_RUN_BONUS_PER_MARBLE
    );
  });

  it('非法输入抛错', () => {
    expect(() => matchPoints(-1)).toThrow(RangeError);
    expect(() => matchPoints(Number.NaN)).toThrow(RangeError);
    expect(() => matchPoints(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});

describe('comboMultiplier 连锁倍率', () => {
  it('逐档 +0.5', () => {
    expect([1, 2, 3, 5].map(comboMultiplier)).toEqual([1, 1.5, 2, 3]);
  });

  it('倍率步进与常量一致（改常量必须显式改测试）', () => {
    expect(comboMultiplier(4) - comboMultiplier(3)).toBeCloseTo(COMBO_MULTIPLIER_STEP, 10);
  });

  it('combo 必须是 ≥ 1 的整数', () => {
    expect(() => comboMultiplier(0)).toThrow(RangeError);
    expect(() => comboMultiplier(1.5)).toThrow(RangeError);
  });
});

describe('scoreMatch 单次得分', () => {
  it('等于基础分乘倍率并取整', () => {
    expect(scoreMatch(3, 1)).toBe(300);
    expect(scoreMatch(4, 2)).toBe(600 * 1.5);
    expect(scoreMatch(5, 3)).toBe(1000 * 2);
  });

  it('combo 默认为 1', () => {
    expect(scoreMatch(3)).toBe(scoreMatch(3, 1));
  });

  it('取整不留小数（分数一律是整数，HUD 直接显示）', () => {
    for (const [n, combo] of [
      [3, 1],
      [4, 3],
      [7, 4],
      [9, 5]
    ] as const) {
      expect(Number.isInteger(scoreMatch(n, combo))).toBe(true);
    }
  });
});

describe('farShotPoints 远射奖励', () => {
  it('按整档给分，不足一档为零', () => {
    expect([0, 99.9, 100, 199, 250, 1000].map(farShotPoints)).toEqual([0, 0, 25, 25, 50, 250]);
  });

  it('非法距离抛错', () => {
    expect(() => farShotPoints(-1)).toThrow(RangeError);
    expect(() => farShotPoints(Number.NaN)).toThrow(RangeError);
  });
});

describe('clearBonus 过关结算', () => {
  it('清空 + 全命中拿满奖励', () => {
    expect(clearBonus(0, 10, 10)).toBe(PERFECT_CLEAR_BONUS + ACCURACY_BONUS_MAX);
  });

  it('剩余球按颗扣分，命中率加奖', () => {
    // 剩 10 颗、20 发 10 中 → 0 + round(0.5 × 500) - 150 = 100
    expect(clearBonus(10, 20, 10)).toBe(100);
  });

  it('一枪未发不会有精度奖励，也不会除零', () => {
    expect(clearBonus(5, 0, 0)).toBe(0); // 0 + 0 - 75 夹到 0
    expect(clearBonus(0, 0, 0)).toBe(PERFECT_CLEAR_BONUS); // 只有清空大奖
  });

  it('扣分超过奖励时夹到 0，不出现负分', () => {
    expect(clearBonus(100, 1, 1)).toBe(0);
  });

  it('命中数大于发射数是数据错误，直接抛错', () => {
    expect(() => clearBonus(0, 5, 6)).toThrow(RangeError);
  });

  it('非法参数抛错', () => {
    expect(() => clearBonus(-1, 5, 1)).toThrow(RangeError);
    expect(() => clearBonus(0, Number.NaN, 0)).toThrow(RangeError);
    expect(() => clearBonus(0, 5, -1)).toThrow(RangeError);
  });
});
