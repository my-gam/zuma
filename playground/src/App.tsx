import { useState } from 'react';
import { GameZuma as ReactZuma } from '@my-games/zuma-react';
import { LEVELS } from '@my-games/zuma-core';
import { VanillaDemo } from './VanillaDemo';
import { VuePanel } from './VuePanel';

/** 三个 tab：同一引擎的三种接法。 */
type Tab = 'vanilla' | 'vue' | 'react';

const TABS: readonly { id: Tab; label: string; hint: string }[] = [
  { id: 'vanilla', label: 'Vanilla', hint: '只用 core，不加载任何框架' },
  { id: 'vue', label: 'Vue 3', hint: '@my-games/zuma-vue 的 GameZuma 组件' },
  { id: 'react', label: 'React', hint: '@my-games/zuma-react 的 GameZuma 组件' }
];

/**
 * Playground 外壳 —— 三 tab 演示。
 *
 * 它是 GitHub Pages 的构建源（`tools/pages.mjs` 会把三包先 build 出来再让这里 import），
 * 所以这个页面的作用不只是「能玩」，还要证明三种接法跑的是同一份 core：
 * 切 tab 时画面比例、配色、HUD 文案都不该变，变的只是外壳。
 */
export function App() {
  const [tab, setTab] = useState<Tab>('vanilla');
  const [level, setLevel] = useState(1);

  return (
    <main className="pg-shell">
      <header className="pg-header">
        <h1 className="pg-title">zuma · Playground</h1>
        <p className="pg-subtitle">
          同一份 <code>@my-games/zuma-core</code> 引擎，三种接法。手机上请直接拖动瞄准、松手发射；
          桌面端可用 ← → 转方向、空格发射、P 暂停、R 重开。
        </p>
      </header>

      <nav className="pg-tabs" aria-label="演示切换">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            className="pg-tab"
            aria-selected={tab === item.id}
            onClick={() => setTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </nav>

      <p className="pg-hint">{TABS.find((item) => item.id === tab)?.hint}</p>

      <label className="pg-level-picker">
        <span className="pg-level-label">关卡</span>
        <select
          className="pg-select"
          value={level}
          onChange={(event) => setLevel(Number(event.target.value))}
        >
          {LEVELS.map((item) => (
            <option key={item.id} value={item.id}>
              {item.id} · {item.name}（{item.colors} 色 / {item.marbles} 球
              {item.rewind.length ? ` / 倒退 ×${item.rewind.length}` : ''}）
            </option>
          ))}
        </select>
      </label>

      <section className="pg-body">
        {tab === 'vanilla' ? <VanillaDemo level={level} /> : null}
        {tab === 'vue' ? <VuePanel level={level} /> : null}
        {tab === 'react' ? (
          <div className="pg-react-host">
            <ReactZuma level={level} />
          </div>
        ) : null}
      </section>

      <footer className="pg-footer">
        <p>
          关卡曲线由 <code>archimedeanSpiral</code> / <code>serpentine</code> 参数化生成；
          球体、轨道与爆点全是程序化绘制，不含任何外部素材。
        </p>
      </footer>
    </main>
  );
}
