import { describe, expect, it } from 'vitest';
import * as barrel from '../src/index';
import {
  MARBLE_COLORS,
  advanceChain,
  closeGaps,
  createChain,
  hasGaps,
  insertMarble,
  isMarbleColor,
  paletteFor,
  poseAt,
  sampleTrack
} from '../src/index';
import type { Vec2 } from '../src/index';

/**
 * 空骨架期的占位测试已随引擎落地退役（对齐 sudoku 的同名约定：占位常量删除后，
 * 这个文件改为校验 `index.ts` 的**公共导出面**真的接通，并跑一条端到端最小闭环。
 * 它同时是「`pnpm test` 不是空跑」的证据来源之一。
 */
describe('core barrel（index.ts 公共导出面）', () => {
  it('导出曲线、弧长查询与彩球链的关键 API', () => {
    expect(typeof sampleTrack).toBe('function');
    expect(typeof poseAt).toBe('function');
    expect(typeof createChain).toBe('function');
    expect(typeof advanceChain).toBe('function');
    expect(typeof insertMarble).toBe('function');
    expect(typeof closeGaps).toBe('function');
    expect(typeof hasGaps).toBe('function');
    expect(typeof paletteFor).toBe('function');
    expect(typeof isMarbleColor).toBe('function');
    expect(MARBLE_COLORS.length).toBeGreaterThanOrEqual(3);
  });

  it('占位常量已退役，不再出现在公共面里', () => {
    expect('ZUMA_PACKAGE' in barrel).toBe(false);
    expect('ZUMA_STAGE' in barrel).toBe(false);
  });
});

describe('端到端最小闭环（轨道 + 链，不含状态机）', () => {
  /** 一条从左上往右下收缩的三段曲线，够当关卡骨架用。 */
  const CONTROL: Vec2[] = [
    { x: 40, y: 40 },
    { x: 460, y: 60 },
    { x: 420, y: 420 },
    { x: 120, y: 380 }
  ];

  it('链上每颗球都能查到有限姿态', () => {
    const track = sampleTrack(CONTROL);
    const spacing = 24;
    // 让整条链贴着轨道尾部摆布：尾球在 0，头球靠洞口方向。
    const chain = createChain(['red', 'green', 'blue', 'blue'], {
      spacing,
      headDist: spacing * 3 + 100
    });

    const inserted = insertMarble(chain, { dist: 150, color: 'yellow', id: 42, minDist: 0 });
    expect(inserted.marbles).toHaveLength(5);

    for (const marble of inserted.marbles) {
      const pose = poseAt(track, marble.dist);
      expect(Number.isFinite(pose.x)).toBe(true);
      expect(Number.isFinite(pose.y)).toBe(true);
      expect(Number.isFinite(pose.angle)).toBe(true);
      // 世界坐标不会跑到轨道外（控制点包围盒 + 样条外扩余量）。
      expect(pose.x).toBeGreaterThanOrEqual(-100);
      expect(pose.x).toBeLessThanOrEqual(700);
      expect(pose.y).toBeGreaterThanOrEqual(-100);
      expect(pose.y).toBeLessThanOrEqual(700);
    }
  });

  it('平移 + 消合后空隙闭合：链始终不自交重叠', () => {
    const spacing = 10;
    let chain = createChain(['red', 'red', 'red', 'green'], { spacing });
    chain = advanceChain(chain, 35);
    // 模拟消合：摘掉头三颗，剩下的段与新车头之间留空隙。
    const afterMatch = { spacing, marbles: [chain.marbles[3]!] };
    expect(hasGaps(afterMatch)).toBe(false); // 单球无所谓空隙
    const rejoined = {
      spacing,
      marbles: [chain.marbles[0]!, chain.marbles[3]!]
    };
    expect(hasGaps(rejoined)).toBe(true);
    const closed = closeGaps(rejoined, 1000);
    expect(hasGaps(closed)).toBe(false);
    expect(closed.marbles[1]!.dist).toBe(closed.marbles[0]!.dist - spacing);
  });
});
