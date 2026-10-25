import { useEffect, useRef } from 'react';
import { createApp, h, type App as VueApp } from 'vue';
import { GameZuma } from '@my-games/zuma-vue';

/**
 * 把 Vue 版组件挂进 React playground 的桥接面板。
 *
 * React 负责这个 tab 的存在，Vue 负责真正的游戏：`createApp` + `h(GameZuma)` 在容器上
 * 起一个独立的 Vue 应用，卸载时 `unmount()`。这样两个框架跑的是同一份 core 状态机与同一个
 * `drawScene`，观感应当完全一致 —— 这正是核对「适配层有没有偷偷写业务」的最好现场。
 */
export interface VuePanelProps {
  /** 起始关卡 id（变化时整体重挂载，语义与组件的 `level` prop 一致）。 */
  readonly level?: number;
  /** 是否用 localStorage 记进度。 */
  readonly persistent?: boolean;
}

export function VuePanel({ level = 1, persistent = true }: VuePanelProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const app: VueApp = createApp({
      render: () =>
        h(GameZuma, {
          title: '祖玛 · Vue',
          level,
          persistent,
          resumeSaved: false
        })
    });
    app.mount(host);
    return () => {
      app.unmount();
    };
  }, [level, persistent]);

  return <div ref={hostRef} className="pg-vue-host" />;
}
