<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { Note } from '../types'
import { useNotes } from '../composables/useNotes'
import { useToast } from '../composables/useToast'
import { textFromHtml } from '../editor/html'
import { displayTitle, formatRelativeTime, noteSummary } from '../utils/format'

const {
  sortedNotes,
  currentId,
  createNote,
  selectNote,
  deleteNote,
  importFromFile,
  exportToFile,
} = useNotes()
const { toast } = useToast()

/** 当前等待确认删除的笔记 id */
const confirmId = ref<string | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)

const count = computed(() => sortedNotes.value.length)

// 切换选中或列表变化后，收起任何展开中的删除确认
watch([currentId, sortedNotes], () => {
  confirmId.value = null
})

function contentText(n: Note): string {
  return textFromHtml(n.content)
}

function itemTitle(n: Note): string {
  const t = n.title.trim()
  if (t) return t
  return displayTitle(noteSummary(contentText(n)) || '')
}

/** 标题为空时，正文首行已作为标题，摘要行不再重复 */
function itemSummary(n: Note): string {
  if (!n.title.trim()) return ''
  return noteSummary(contentText(n))
}

function onSelect(id: string): void {
  confirmId.value = null
  selectNote(id)
}

function onTrash(id: string): void {
  confirmId.value = id
}

function onConfirmDelete(id: string): void {
  deleteNote(id)
  confirmId.value = null
  toast('已删除', 'success')
}

function onCreate(): void {
  createNote()
  toast('已新建笔记', 'success')
}

function onExport(): void {
  exportToFile()
  toast(`已导出 ${count.value} 条笔记`, 'success')
}

function openImport(): void {
  fileInput.value?.click()
}

async function onImportChange(e: Event): Promise<void> {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (file) {
    try {
      const result = await importFromFile(file)
      if (result.total === 0) {
        toast('该备份中没有可导入的笔记', 'info')
      } else {
        toast(`导入完成：新增 ${result.added} 条，更新 ${result.updated} 条`, 'success')
      }
    } catch (err) {
      toast(err instanceof Error ? err.message : '导入失败，请检查文件内容', 'error')
    }
  }
  input.value = ''
}
</script>

<template>
  <aside class="sidebar">
    <header class="sidebar__head">
      <span class="brand">
        <span class="brand__mark">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3.6" y="2.8" width="16.8" height="18.4" rx="3.4" />
            <path d="M8.2 8.4h7.6M8.2 12h7.6M8.2 15.6h4.4" />
          </svg>
        </span>
        <span class="brand__name">笔记本</span>
      </span>
      <button class="btn-primary head-new" title="新建笔记（⌘N / Ctrl+N）" @click="onCreate">新建</button>
    </header>

    <nav class="sidebar__list">
      <div
        v-for="n in sortedNotes"
        :key="n.id"
        class="note-item"
        :class="{ active: n.id === currentId }"
        role="button"
        tabindex="0"
        @click="onSelect(n.id)"
        @keydown.enter.prevent="onSelect(n.id)"
      >
        <div class="note-item__top">
          <span class="note-item__title">{{ itemTitle(n) }}</span>

          <span v-if="confirmId === n.id" class="note-item__ops" @click.stop>
            <button class="mini-btn danger" @click="onConfirmDelete(n.id)">删除</button>
            <button class="mini-btn" @click="confirmId = null">取消</button>
          </span>
          <button
            v-else
            class="mini-btn note-item__delete"
            title="删除这条笔记"
            @click.stop="onTrash(n.id)"
          >删除</button>
        </div>

        <div class="note-item__sub">
          <span v-if="itemSummary(n)" class="note-item__summary">{{ itemSummary(n) }}</span>
          <span class="note-item__time">{{ formatRelativeTime(n.updatedAt) }}</span>
        </div>
      </div>

      <div v-if="count === 0" class="sidebar__empty">
        <p>暂无笔记</p>
        <p class="sidebar__empty-sub">点击右上角「新建」创建第一条笔记</p>
      </div>
    </nav>

    <footer class="sidebar__foot">
      <div class="sidebar__ops">
        <button class="btn-ghost" title="将全部笔记导出为 JSON 备份文件" @click="onExport">导出</button>
        <button class="btn-ghost" title="从 JSON 备份文件导入笔记" @click="openImport">导入</button>
      </div>
      <p class="sidebar__meta">
        {{ count }} 条笔记 · 自动保存于本机
      </p>
    </footer>

    <input
      ref="fileInput"
      type="file"
      accept="application/json,.json"
      hidden
      @change="onImportChange"
    />
  </aside>
</template>

<style scoped>
.sidebar {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-width: 0;
  background: var(--bg-sidebar);
}

/* ---------- 头部 ---------- */
.sidebar__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 12px 10px 8px 14px;
}
.brand {
  display: flex;
  align-items: center;
  gap: 9px;
  min-width: 0;
}
.brand__mark {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border-radius: 7px;
  background: var(--accent-soft);
  color: var(--accent);
  flex: none;
}
.brand__mark svg {
  width: 17px;
  height: 17px;
}
.brand__name {
  font-size: 15px;
  font-weight: 650;
  letter-spacing: -0.01em;
  white-space: nowrap;
}
.head-new {
  padding: 5px 12px;
  font-size: 13px;
}

/* ---------- 列表 ---------- */
.sidebar__list {
  flex: 1;
  overflow-y: auto;
  padding: 4px 6px;
}

.note-item {
  padding: 7px 9px;
  margin-bottom: 1px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: background-color 0.12s ease;
}
.note-item:hover {
  background: var(--bg-hover);
}
.note-item.active {
  background: var(--bg-active);
}

.note-item__top {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.note-item__title {
  flex: 1;
  min-width: 0;
  font-family: var(--font-content);
  font-size: 14px;
  font-weight: 550;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.note-item.active .note-item__title {
  font-weight: 600;
}

.note-item__delete {
  opacity: 0;
  padding: 2px 7px;
  transition: opacity 0.12s ease;
}
.note-item:hover .note-item__delete,
.note-item:focus-within .note-item__delete {
  opacity: 1;
}

.note-item__ops {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex: none;
}

.note-item__sub {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  margin-top: 3px;
}
.note-item__summary {
  flex: 1;
  min-width: 0;
  font-family: var(--font-content);
  font-size: 12.5px;
  color: var(--text-mid);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.note-item__time {
  flex: none;
  font-size: 11.5px;
  color: var(--text-faint);
}
.note-item.active .note-item__time {
  color: var(--text-mid);
}

/* 空状态 */
.sidebar__empty {
  padding: 40px 16px;
  text-align: center;
}
.sidebar__empty p {
  margin: 0 0 6px;
  font-size: 13.5px;
  color: var(--text-mid);
}
.sidebar__empty-sub {
  font-size: 12.5px !important;
  color: var(--text-faint) !important;
}

/* ---------- 底部 ---------- */
.sidebar__foot {
  border-top: 1px solid var(--border);
  padding: 10px 14px 12px;
}
.sidebar__ops {
  display: flex;
  gap: 8px;
}
.sidebar__ops .btn-ghost {
  flex: 1;
  justify-content: center;
  padding: 6px 8px;
}
.sidebar__meta {
  margin: 8px 2px 0;
  font-size: 11.5px;
  color: var(--text-faint);
}
</style>
