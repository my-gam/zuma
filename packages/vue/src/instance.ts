/**
 * `GameZuma` 组件对外句柄的类型镜像。
 *
 * 单独放一个文件是模板的既有约定：`<script setup>` 里 `defineExpose` 出来的成员只通过
 * 这份 interface 对宿主暴露，宿主拿 `ref` 时读到的是契约而不是组件内部实现；
 * 而契约必须写在 `.ts` 里才能被 `vue-tsc` 与打包后的 `.d.ts` 正常引用。
 */
import type { MarbleColor, ZumaState } from '@my-games/zuma-core';

/** `<GameZuma ref="…">` 上可调的成员。 */
export interface GameZumaHandle {
  /** 当前快照（渲染循环之外读取用）。 */
  getState(): ZumaState | null;
  /** 设置瞄准角（弧度）。 */
  aim(angle: number): boolean;
  /** 瞄准一个世界坐标点。 */
  aimAt(point: { x: number; y: number }): boolean;
  /** 发射装填球。 */
  shoot(): boolean;
  /** 开始指定关卡（省略则重开当前关）。 */
  start(level?: number): void;
  /** 重玩当前关。 */
  restart(): void;
  /** 进入下一关。 */
  next(): void;
  pause(): void;
  resume(): void;
  togglePause(): void;
  save(): boolean;
  load(): boolean;
  /** 某关最高分（省略关卡号为当前关）。 */
  bestScore(level?: number): number;
  /** 已解锁到第几关。 */
  unlockedLevel(): number;
  /** 装填队列（第 0 个是可发射的）。 */
  queue(): readonly MarbleColor[];
  /** 容器尺寸被外部改动后重新贴合画布。 */
  resize(): void;
}
