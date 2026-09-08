<script setup lang="ts">
import { computed } from 'vue'

/**
 * 轻量内联图标：统一 24x24 视口、currentColor 描边。
 * 避免引入任何图标库依赖。
 */
const ICONS: Record<string, string[]> = {
  plus: ['M12 5v14', 'M5 12h14'],
  trash: [
    'M4 7h16',
    'M19 7v12a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V7',
    'M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2',
    'M10 11v6',
    'M14 11v6',
  ],
  download: [
    'M12 3v12',
    'M8.5 11.5 12 15l3.5-3.5',
    'M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2',
  ],
  upload: [
    'M12 15V3',
    'M8.5 6.5 12 3l3.5 3.5',
    'M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2',
  ],
  close: ['M6 6l12 12', 'M18 6 6 18'],
  save: [
    'M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z',
    'M17 21v-8H7v8',
    'M7 3v5h8',
  ],
  undo: ['M3 7v6h6', 'M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13'],
  redo: ['M21 7v6h-6', 'M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3L21 13'],
  file: [
    'M13.5 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8.5L13.5 3Z',
    'M13.5 3v5.5H19',
  ],
}

const props = withDefaults(defineProps<{ name: string; size?: number }>(), {
  size: 16,
})

const paths = computed(() => ICONS[props.name] ?? [])
</script>

<template>
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.8"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path v-for="d in paths" :key="d" :d="d" />
  </svg>
</template>
