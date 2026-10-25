/**
 * 引擎共享的游戏域类型。
 *
 * 几何类型（`Vec2` / `Track`）留在各自模块里保持内聚，这里只放**跨模块共识**的东西：
 * 颜色枚举与其类型守卫。存档反序列化（`storage`）、关卡生成（`levels`）、
 * 渲染（`renderer`）都要靠同一份颜色定义对齐，所以单点放在这里。
 */

/**
 * 彩球颜色。用字符串字面量而不是数字枚举，是为了让存档、快照与调试输出可读，
 * 也让 IIFE/UMD 使用者能直接写 `'red'`。
 */
export const MARBLE_COLORS = ['red', 'yellow', 'green', 'blue', 'purple', 'orange'] as const;

/** 一颗彩球的颜色。 */
export type MarbleColor = (typeof MARBLE_COLORS)[number];

/** 全部可用颜色（关卡按难度取前 N 种，见 `levels`）。 */
export const MARBLE_PALETTE: readonly MarbleColor[] = MARBLE_COLORS;

/** 难度用的最大色数上限。 */
export const MAX_MARBLE_COLORS = MARBLE_COLORS.length;

/** 类型守卫：反序列化存档 / 校验外部输入时用它挡掉非法颜色。 */
export function isMarbleColor(value: unknown): value is MarbleColor {
  return typeof value === 'string' && (MARBLE_COLORS as readonly string[]).includes(value);
}

/** 取关卡允许的前 `count` 种颜色（顺序稳定，便于低难度先只出前几色）。 */
export function paletteFor(count: number): readonly MarbleColor[] {
  if (!Number.isInteger(count) || count < 1 || count > MAX_MARBLE_COLORS) {
    throw new RangeError(`色数必须是 1..${MAX_MARBLE_COLORS} 的整数，收到 ${count}`);
  }
  return MARBLE_PALETTE.slice(0, count);
}
