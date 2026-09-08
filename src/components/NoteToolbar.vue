<script setup lang="ts">
import type { ToolbarUi } from '../editor/blocks'

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
</script>

<template>
  <div class="fmtbar" role="toolbar" aria-label="文本格式">
    <button
      class="btn"
      :class="{ active: isBlockActive('paragraph') }"
      title="正文段落"
      @mousedown.prevent
      @click="emit('exec', 'paragraph')"
    >正文</button>
    <button
      class="btn"
      :class="{ active: isBlockActive('h1') }"
      title="一级标题"
      @mousedown.prevent
      @click="emit('exec', 'h1')"
    >一级</button>
    <button
      class="btn"
      :class="{ active: isBlockActive('h2') }"
      title="二级标题"
      @mousedown.prevent
      @click="emit('exec', 'h2')"
    >二级</button>
    <button
      class="btn"
      :class="{ active: isBlockActive('h3') }"
      title="三级标题"
      @mousedown.prevent
      @click="emit('exec', 'h3')"
    >三级</button>

    <span class="sep"></span>

    <button
      class="btn"
      :class="{ active: isBlockActive('blockquote') }"
      title="引用块"
      @mousedown.prevent
      @click="emit('exec', 'blockquote')"
    >引用</button>
    <button
      class="btn"
      :class="{ active: isBlockActive('codeblock') }"
      title="代码块"
      @mousedown.prevent
      @click="emit('exec', 'codeblock')"
    >代码</button>

    <span class="sep"></span>

    <button
      class="btn"
      title="插入分割线"
      @mousedown.prevent
      @click="emit('exec', 'divider')"
    >分割线</button>

    <span class="sep"></span>

    <button
      class="btn"
      :class="{ active: isBlockActive('bulletList') }"
      title="无序列表（列表内 Tab 缩进、Shift+Tab 退级）"
      @mousedown.prevent
      @click="emit('exec', 'bulletList')"
    >列表</button>
    <button
      class="btn"
      :class="{ active: isBlockActive('orderedList') }"
      title="有序列表"
      @mousedown.prevent
      @click="emit('exec', 'orderedList')"
    >编号</button>

    <span class="sep"></span>

    <button
      class="btn"
      :class="{ active: ui.marks.bold }"
      :disabled="ui.inCode"
      title="粗体（需先选中文字）"
      @mousedown.prevent
      @click="emit('exec', 'bold')"
    >粗体</button>
    <button
      class="btn"
      :class="{ active: ui.marks.italic }"
      :disabled="ui.inCode"
      title="斜体（需先选中文字）"
      @mousedown.prevent
      @click="emit('exec', 'italic')"
    >斜体</button>
    <button
      class="btn"
      :class="{ active: ui.marks.strike }"
      :disabled="ui.inCode"
      title="删除线（需先选中文字）"
      @mousedown.prevent
      @click="emit('exec', 'strike')"
    >删除线</button>
    <button
      class="btn"
      :class="{ active: ui.marks.inlineCode }"
      :disabled="ui.inCode"
      title="行内代码（需先选中文字）"
      @mousedown.prevent
      @click="emit('exec', 'inlineCode')"
    >行内代码</button>

    <span class="sep"></span>

    <button
      class="btn"
      :disabled="!ui.canUndo"
      title="撤销（⌘Z / Ctrl+Z）"
      @mousedown.prevent
      @click="emit('exec', 'undo')"
    >撤销</button>
    <button
      class="btn"
      :disabled="!ui.canRedo"
      title="重做（⇧⌘Z / Ctrl+Y）"
      @mousedown.prevent
      @click="emit('exec', 'redo')"
    >重做</button>
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
  flex: none;
  height: 26px;
  padding: 0 9px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-mid);
  font-size: 12.5px;
  line-height: 1;
  cursor: pointer;
  white-space: nowrap;
  transition: background-color 0.14s ease, color 0.14s ease;
}
.btn:hover {
  background: var(--bg-hover);
  color: var(--text-strong);
}
.btn.active {
  background: var(--accent-soft);
  color: var(--accent);
  font-weight: 600;
}
.btn:disabled {
  opacity: 0.35;
  cursor: default;
  background: transparent;
}

.sep {
  width: 1px;
  height: 15px;
  margin: 0 5px;
  background: var(--border);
  flex: none;
}
</style>
