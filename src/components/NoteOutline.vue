<script setup lang="ts">
/** 目录树条目（层级 1-5 对应 H1-H5） */
export interface OutlineItem {
  level: number;
  text: string;
}

defineProps<{ items: OutlineItem[]; activeIndex: number }>();
const emit = defineEmits<{ (e: "jump", index: number): void }>();
</script>

<template>
  <nav class="outline" aria-label="笔记目录">
    <p class="outline__title">目录</p>
    <p v-if="items.length === 0" class="outline__empty">暂无标题</p>
    <ul v-else class="outline__list">
      <li v-for="(item, i) in items" :key="i" class="outline__li">
        <button
          class="outline__item"
          :class="{ 'is-active': i === activeIndex }"
          :style="{ paddingLeft: 8 + (item.level - 1) * 12 + 'px' }"
          :title="item.text"
          @mousedown.prevent
          @click="emit('jump', i)"
        >
          <span class="outline__text">{{ item.text }}</span>
        </button>
      </li>
    </ul>
  </nav>
</template>

<style scoped>
/* 编辑器左侧空白区的目录树：与画布同色 + 内凹阴影（新拟态凹槽） */
.outline {
  flex: none;
  width: 200px; /* 固定宽度：父级槽位收窄时从右侧裁切，而不是挤压文字 */
  height: 100%;
  margin: 0; /* 定位由父级槽位控制（含动画） */
  display: flex;
  flex-direction: column;
  padding: 12px 8px;
  border-radius: 14px;
  background: var(--bg-canvas);
  box-shadow: var(--neu-sink-sm);
  overflow: hidden;
}

.outline__empty {
  margin: 0;
  padding: 0 9px;
  font-size: 12px;
  color: var(--text-faint);
  user-select: none;
}

.outline__title {
  flex: none;
  margin: 0 0 8px;
  padding: 0 9px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.1em;
  color: var(--text-faint);
  user-select: none;
}

.outline__list {
  list-style: none;
  margin: 0;
  padding: 0 2px 0 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-height: 0;
  overflow-y: auto; /* 只让条目列表滚动，“目录”标题保持固定 */
}

.outline__li {
  margin: 0;
}

.outline__item {
  display: flex;
  align-items: center;
  gap: 7px;
  width: 100%;
  padding: 4px 8px;
  border: none;
  border-radius: 8px;
  background: transparent;
  font-family: inherit;
  font-size: 12.5px;
  line-height: 1.45;
  color: var(--text-mid);
  text-align: left;
  cursor: pointer;
  transition:
    background-color 0.18s ease,
    color 0.18s ease,
    box-shadow 0.22s ease;
}

.outline__item:hover:not(.is-active) {
  color: var(--text-strong);
  background: rgba(255, 255, 255, 0.5);
}

.outline__item.is-active {
  color: var(--text-strong);
  font-weight: 500;
  box-shadow: var(--neu-sink-sm); /* 当前所在标题：内凹高亮 */
}

/* 层级标记已移除：层级仅靠缩进体现 */
.outline__text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
