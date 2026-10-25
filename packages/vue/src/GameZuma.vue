<script setup lang="ts">
/**
 * `GameZuma` —— Vue 3 组件形态的祖玛。
 *
 * 分工：引擎与状态在 `useGame`（core 的 `Zuma`），**画面与输入在这一层**：
 * 建 canvas、按 devicePixelRatio 贴合容器、跑 `requestAnimationFrame`、把指针位置换算成
 * 世界坐标喂给 `aim()`。绘制本身完全交给 core 的 `drawScene`，组件里一行画球代码都没有。
 *
 * 触控方案（用户 2026-10-25 选定：拖拽定角 + 松手发射）：
 * `pointerdown` 定角并捕获指针 → `pointermove` 连续修正 → `pointerup` 才发射。
 * 手机上这样比「点一下就打」友好：拇指可以沿着螺旋慢慢蹭到想要的角度，误触也不会浪费一发。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import {
  DEFAULT_STYLE,
  LEVELS,
  LEVEL_COUNT,
  createView,
  drawScene,
  type Vec2,
  type View,
  type ZumaState
} from '@my-games/zuma-core';
import '@my-games/zuma-core/style.css';
import { useGame } from './useGame';
import type { GameZumaHandle } from './instance';

interface Props {
  /** HUD 标题（仅用于 a11y 标签与关卡名缺省）。 */
  title?: string;
  /** 起始关卡 id（1..12）。 */
  level?: number;
  /** 用 localStorage 记录进度与最高分。 */
  persistent?: boolean;
  /** 有存档时接着玩。 */
  resumeSaved?: boolean;
  /** 显示装填预览。 */
  showQueue?: boolean;
  /** 显示关卡选择条。 */
  showLevelPicker?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  title: 'Zuma',
  level: 1,
  persistent: true,
  resumeSaved: false,
  showQueue: true,
  showLevelPicker: true
});

const emit = defineEmits<{
  won: [score: number, level: number];
  lost: [score: number, level: number];
  'level-change': [level: number];
}>();

const engine = useGame({
  level: props.level,
  persistent: props.persistent,
  resumeSaved: props.resumeSaved
});

const stageRef = ref<HTMLDivElement | null>(null);
const canvasRef = ref<HTMLCanvasElement | null>(null);

const state = computed(() => engine.state.value);
const spec = computed(() => LEVELS.find((l) => l.id === (state.value?.level ?? props.level)));
const unlocked = ref(engine.unlockedLevel());
/** 关卡总数给模板用（最后一关不显示「下一关」）。 */
const levelCount = LEVEL_COUNT;

/** 画布几何与循环的内部状态（刻意不进响应式：每帧都变，响应化只会白白触发渲染）。 */
let view: View | null = null;
let cssSize = { width: 0, height: 0 };
let rafId = 0;
let lastTs = 0;
let dragging = false;
let observer: ResizeObserver | null = null;

function formatTime(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** 贴合容器：CSS 尺寸交给布局，位图尺寸按 devicePixelRatio 放大，绘制只用 CSS 像素。 */
function resize(): void {
  const canvas = canvasRef.value;
  const stage = stageRef.value;
  if (!canvas || !stage) return;
  const rect = stage.getBoundingClientRect();
  const width = Math.max(1, Math.round(rect.width));
  const height = Math.max(1, Math.round(rect.height));
  const dpr = Math.min(3, Math.max(1, window.devicePixelRatio || 1));
  cssSize = { width, height };
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  const ctx = canvas.getContext('2d');
  ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
  view = null; // 尺寸变了，包围盒映射重建
}

function draw(): void {
  const canvas = canvasRef.value;
  const snapshot: ZumaState | null = state.value;
  const game = engine.getGame();
  if (!canvas || !snapshot || !game) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  if (!view) {
    view = createView(game.getBounds(16), cssSize.width, cssSize.height);
  }
  drawScene(ctx, {
    state: snapshot,
    track: game.getTrack(),
    view,
    launcher: game.getLauncher()
  }, DEFAULT_STYLE);
}

function frame(ts: number): void {
  const dt = lastTs === 0 ? 0 : Math.max(0, ts - lastTs);
  lastTs = ts;
  engine.getGame()?.tick(dt);
  draw();
  rafId = window.requestAnimationFrame(frame);
}

/** 屏幕坐标 → 世界坐标（`createView` 的逆变换）。 */
function toWorld(clientX: number, clientY: number): Vec2 | null {
  const canvas = canvasRef.value;
  if (!canvas || !view) return null;
  const rect = canvas.getBoundingClientRect();
  return {
    x: (clientX - rect.left - view.offsetX) / view.scale,
    y: (clientY - rect.top - view.offsetY) / view.scale
  };
}

function onPointerDown(event: PointerEvent): void {
  const world = toWorld(event.clientX, event.clientY);
  if (!world) return;
  dragging = true;
  canvasRef.value?.setPointerCapture?.(event.pointerId);
  engine.aimAtWorld(world);
  draw();
}

function onPointerMove(event: PointerEvent): void {
  if (!dragging) return;
  const world = toWorld(event.clientX, event.clientY);
  if (!world) return;
  engine.aimAtWorld(world);
  draw();
}

function onPointerUp(event: PointerEvent): void {
  if (!dragging) return;
  dragging = false;
  canvasRef.value?.releasePointerCapture?.(event.pointerId);
  const world = toWorld(event.clientX, event.clientY);
  if (world) engine.aimAtWorld(world);
  engine.shoot();
  draw();
}

function onKeyDown(event: KeyboardEvent): void {
  const game = engine.getGame();
  if (!game) return;
  const step = event.shiftKey ? 0.02 : 0.08;
  switch (event.key) {
    case 'ArrowLeft':
      engine.aim(game.getState().aimAngle - step);
      break;
    case 'ArrowRight':
      engine.aim(game.getState().aimAngle + step);
      break;
    case ' ':
    case 'Enter':
      engine.shoot();
      break;
    case 'p':
    case 'P':
      engine.togglePause();
      break;
    case 'r':
    case 'R':
      engine.restart();
      break;
    default:
      return;
  }
  event.preventDefault();
  draw();
}

function selectLevel(level: number): void {
  if (level > engine.unlockedLevel()) return;
  engine.start(level);
  unlocked.value = engine.unlockedLevel();
  emit('level-change', level);
  draw();
}

watch(
  () => state.value?.phase,
  (phase, previous) => {
    const snapshot = state.value;
    if (!snapshot || phase === previous) return;
    if (phase === 'won') emit('won', snapshot.score, snapshot.level);
    if (phase === 'lost') emit('lost', snapshot.score, snapshot.level);
    if (phase === 'playing') emit('level-change', snapshot.level);
  }
);

function onVisibilityChange(): void {
  if (document.visibilityState === 'hidden') engine.pause();
}

onMounted(() => {
  resize();
  draw();
  lastTs = 0;
  rafId = window.requestAnimationFrame(frame);
  if (typeof ResizeObserver !== 'undefined' && stageRef.value) {
    observer = new ResizeObserver(() => {
      resize();
      draw();
    });
    observer.observe(stageRef.value);
  } else {
    window.addEventListener('resize', resize);
  }
  document.addEventListener('visibilitychange', onVisibilityChange);
});

onBeforeUnmount(() => {
  if (rafId) window.cancelAnimationFrame(rafId);
  observer?.disconnect();
  window.removeEventListener('resize', resize);
  document.removeEventListener('visibilitychange', onVisibilityChange);
  engine.pause();
});

defineExpose<GameZumaHandle>({
  getState: () => engine.state.value,
  aim: engine.aim,
  aimAt: (point) => engine.getGame()?.aimAt(point) ?? false,
  shoot: engine.shoot,
  start: engine.start,
  restart: engine.restart,
  next: engine.next,
  pause: engine.pause,
  resume: engine.resume,
  togglePause: engine.togglePause,
  save: engine.save,
  load: engine.load,
  bestScore: engine.bestScore,
  unlockedLevel: engine.unlockedLevel,
  queue: () => engine.state.value?.queue ?? [],
  resize: () => {
    resize();
    draw();
  }
});
</script>

<template>
  <div class="game-zuma" data-test="zuma-root" :aria-label="title">
    <div class="game-zuma-hud">
      <span class="game-zuma-hud-item">
        <span class="game-zuma-hud-label">分数</span>
        <span class="game-zuma-hud-value" data-test="zuma-score">{{ state?.score ?? 0 }}</span>
      </span>
      <span class="game-zuma-hud-item">
        <span class="game-zuma-hud-label">关卡</span>
        <span class="game-zuma-hud-value">{{ state?.level ?? 0 }}</span>
        <span class="game-zuma-hud-label">{{ spec?.name }}</span>
      </span>
      <span class="game-zuma-hud-item">
        <span class="game-zuma-hud-label">剩余</span>
        <span class="game-zuma-hud-value" data-test="zuma-remaining">{{ state?.remaining ?? 0 }}</span>
      </span>
      <span class="game-zuma-hud-item">
        <span class="game-zuma-hud-label">用时</span>
        <span class="game-zuma-hud-value">{{ formatTime(state?.elapsedMs ?? 0) }}</span>
      </span>
      <span class="game-zuma-hud-item">
        <span class="game-zuma-hud-label">最佳</span>
        <span class="game-zuma-hud-value">{{ engine.bestScore() }}</span>
      </span>
      <span
        class="game-zuma-hud-item game-zuma-hud-combo"
        :class="{ 'is-active': (state?.combo ?? 0) > 1 }"
        data-test="zuma-combo"
      >
        <span class="game-zuma-hud-label">连锁</span>
        <span class="game-zuma-hud-value">×{{ state?.combo ?? 0 }}</span>
      </span>
    </div>

    <div ref="stageRef" class="game-zuma-stage">
      <canvas
        ref="canvasRef"
        class="game-zuma-canvas"
        tabindex="0"
        role="application"
        :aria-label="`${title} 游戏画面：拖动瞄准，松手发射`"
        @pointerdown="onPointerDown"
        @pointermove="onPointerMove"
        @pointerup="onPointerUp"
        @pointercancel="onPointerUp"
        @keydown="onKeyDown"
      />
      <div
        v-if="state && state.phase !== 'playing'"
        class="game-zuma-overlay is-visible"
        :class="{
          'is-won': state.phase === 'won',
          'is-lost': state.phase === 'lost',
          'is-paused': state.phase === 'paused'
        }"
        data-test="zuma-overlay"
      >
        <p class="game-zuma-overlay-title">
          {{ state.phase === 'won' ? '过关！' : state.phase === 'lost' ? '进洞了' : '已暂停' }}
        </p>
        <p class="game-zuma-overlay-score">
          本关得分 {{ state.score }}
          <template v-if="state.settled">（含结算 {{ state.settled }}）</template>
        </p>
        <div class="game-zuma-overlay-actions">
          <button
            v-if="state.phase === 'paused'"
            type="button"
            class="game-zuma-button game-zuma-button-primary"
            @click="engine.resume()"
          >
            继续
          </button>
          <button type="button" class="game-zuma-button" @click="engine.restart()">
            重玩本关
          </button>
          <button
            v-if="state.phase === 'won' && state.level < levelCount"
            type="button"
            class="game-zuma-button game-zuma-button-primary"
            @click="selectLevel(state.level + 1)"
          >
            下一关
          </button>
        </div>
      </div>
    </div>

    <div v-if="showQueue && state" class="game-zuma-queue" aria-label="装填预览">
      <span
        v-for="(color, index) in state.queue"
        :key="index"
        class="game-zuma-queue-ball"
        :class="`game-zuma-ball-${color}`"
        :data-test="`zuma-queue-${index}`"
      />
    </div>

    <div class="game-zuma-controls">
      <button
        type="button"
        class="game-zuma-button"
        data-test="zuma-pause"
        @click="engine.togglePause()"
      >
        {{ state?.phase === 'paused' ? '继续' : '暂停' }}
      </button>
      <button type="button" class="game-zuma-button" data-test="zuma-restart" @click="engine.restart()">
        重新开始
      </button>
      <button type="button" class="game-zuma-button" data-test="zuma-shoot" @click="engine.shoot()">
        发射
      </button>
      <div v-if="showLevelPicker" class="game-zuma-levels" aria-label="关卡选择">
        <button
          v-for="item in LEVELS"
          :key="item.id"
          type="button"
          class="game-zuma-level-chip"
          :disabled="item.id > unlocked"
          :aria-current="item.id === state?.level"
          @click="selectLevel(item.id)"
        >
          {{ item.id }}
        </button>
      </div>
    </div>
  </div>
</template>
