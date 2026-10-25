<script setup lang="ts">
// 0.0.0 空骨架占位组件：仅 import core 样式以让 vite lib build 抽出非空
// dist/index.css（verify:dist 守卫要求）。真实 Canvas 舞台/触控瞄准/HUD 随引擎补入。
import '@my-games/zuma-core/style.css';

interface Props {
  title?: string;
}
withDefaults(defineProps<Props>(), { title: 'Zuma' });
</script>

<template>
  <div class="game-zuma">
    <p>{{ title }} · Vue 占位组件（0.0.0）。真实 Canvas 舞台随引擎后续提交补入。</p>
  </div>
</template>
