<script setup lang="ts">
import type { ToolbarUi } from '../editor/blocks'
import Icon from './Icon.vue'
import type { IconName } from './Icon.vue'

/** 工具条能触发的动作（与 NoteEditor.exec 一一对应） */
export type ToolbarAction =
  | 'paragraph'
  | 'h1'
  | 'h2'
  | 'h3'
  | 'blockquote'
  | 'codeblock'
  | 'divider'
  | 'bulletList'
  | 'orderedList'
  | 'bold'
  | 'italic'
  | 'strike'
  | 'inlineCode'
  | 'undo'
  | 'redo'

const props = defineProps<{ ui: ToolbarUi }>()
const emit = defineEmits<{ (e: 'exec', action: ToolbarAction): void }>()

function isBlockActive(key: ToolbarAction): boolean {
  return props.ui.kind === key
}

/** 动作 → 图标名（同名映射，便于批量渲染） */
function iconOf(action: ToolbarAction): IconName {
  return action
}
</script>

<template>
  <div
    class="fmtbar"
    role="toolbar"
    aria-label="文本格式"
    @mousedown.prevent
  >
    <button
      class="btn"
      :class="{ active: isBlockActive('paragraph') }"
      title="正文段落"
      @mousedown.prevent
      @click="emit('exec', 'paragraph')"
    ><Icon :name="iconOf('paragraph')" /></button>
    <button
      class="btn"
      :class="{ active: isBlockActive('h1') }"
      title="一级标题"
      @mousedown.prevent
      @click="emit('exec', 'h1')"
    ><Icon :name="iconOf('h1')" /></button>
    <button
      class="btn"
      :class="{ active: isBlockActive('h2') }"
      title="二级标题"
      @mousedown.prevent
      @click="emit('exec', 'h2')"
    ><Icon :name="iconOf('h2')" /></button>
    <button
      class="btn"
      :class="{ active: isBlockActive('h3') }"
      title="三级标题"
      @mousedown.prevent
      @click="emit('exec', 'h3')"
    ><Icon :name="iconOf('h3')" /></button>

    <span class="sep"></span>

    <button
      class="btn"
      :class="{ active: isBlockActive('blockquote') }"
      title="引用块"
      @mousedown.prevent
      @click="emit('exec', 'blockquote')"
    ><Icon :name="iconOf('blockquote')" /></button>
    <button
      class="btn"
      :class="{ active: isBlockActive('codeblock') }"
      title="代码块"
      @mousedown.prevent
      @click="emit('exec', 'codeblock')"
    ><Icon :name="iconOf('codeblock')" /></button>


    <button
      class="btn"
      title="插入分割线"
      @mousedown.prevent
      @click="emit('exec', 'divider')"
    ><Icon :name="iconOf('divider')" /></button>


    <button
      class="btn"
      :class="{ active: isBlockActive('bulletList') }"
      title="无序列表（列表内 Tab 缩进、Shift+Tab 退级）"
      @mousedown.prevent
      @click="emit('exec', 'bulletList')"
    ><Icon :name="iconOf('bulletList')" /></button>
    <button
      class="btn"
      :class="{ active: isBlockActive('orderedList') }"
      title="有序列表"
      @mousedown.prevent
      @click="emit('exec', 'orderedList')"
    ><Icon :name="iconOf('orderedList')" /></button>


    <button
      class="btn"
      :class="{ active: ui.marks.bold }"
      :disabled="ui.inCode"
      title="粗体（需先选中文字）"
      @mousedown.prevent
      @click="emit('exec', 'bold')"
    ><Icon :name="iconOf('bold')" /></button>
    <button
      class="btn"
      :class="{ active: ui.marks.italic }"
      :disabled="ui.inCode"
      title="斜体（需先选中文字）"
      @mousedown.prevent
      @click="emit('exec', 'italic')"
    ><Icon :name="iconOf('italic')" /></button>
    <button
      class="btn"
      :class="{ active: ui.marks.strike }"
      :disabled="ui.inCode"
      title="删除线（需先选中文字）"
      @mousedown.prevent
      @click="emit('exec', 'strike')"
    ><Icon :name="iconOf('strike')" /></button>
    <button
      class="btn"
      :class="{ active: ui.marks.inlineCode }"
      :disabled="ui.inCode"
      title="行内代码（需先选中文字）"
      @mousedown.prevent
      @click="emit('exec', 'inlineCode')"
    ><Icon :name="iconOf('inlineCode')" /></button>
  </div>
</template>

<style scoped>
.fmtbar {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 6px 12px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-canvas);
  overflow-x: auto;
  scrollbar-width: none;
}
.fmtbar::-webkit-scrollbar {
  display: none;
}

.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  width: 33px;
  height: 30px;
  padding: 0;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-mid);
  cursor: pointer;
  transition: background-color 0.14s ease, color 0.14s ease;
}
.btn:hover:not(:active):not(.active) {
  background: rgba(255, 255, 255, 0.32);
  box-shadow: var(--neu-raise-sm);
  color: var(--text-strong);
}
.btn.active {
  background: transparent;
  box-shadow: var(--neu-sink);
  color: var(--accent);
}
.btn:disabled {
  opacity: 0.35;
  cursor: default;
  background: transparent;
  box-shadow: none;
}

.sep {
  width: 1px;
  height: 15px;
  margin: 0 5px;
  background: var(--border);
  flex: none;
}

/* 按钮按压态 / 常态平滑切换（统一） */
.btn {
  transition:
    background-color 0.18s ease,
    color 0.18s ease,
    box-shadow 0.22s ease,
    opacity 0.2s ease;
}
</style>
