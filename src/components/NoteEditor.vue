<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import NoteToolbar from './NoteToolbar.vue'
import type { ToolbarAction } from './NoteToolbar.vue'
import type { BlockKind, InlineMark, ToolbarUi } from '../editor/blocks'
import {
  caretTextIndex,
  currentBlockKind,
  editorHasContent,
  emptyToolbarUi,
  focusEditorStart,
  getCaretRange,
  handleEnterKey,
  handleTabKey,
  insertDivider,
  isInsideEditor,
  isMarkActive,
  pasteTextInto,
  restoreCaretByTextIndex,
  setBlockType,
  toggleInlineMark,
} from '../editor/blocks'
import { legacyTextToHtml, looksLikeHtml, normalizeHtml, textFromHtml } from '../editor/html'
import { useNotes } from '../composables/useNotes'
import { useFileSave } from '../composables/useFileSave'
import { useToast } from '../composables/useToast'
import { formatClock, formatRelativeTime } from '../utils/format'

const { currentNote, requestAutosave, lastSavedAt } = useNotes()
const { savedFileName, busy, saveAll } = useFileSave()
const { toast } = useToast()

const titleInput = ref<HTMLInputElement | null>(null)
const contentEl = ref<HTMLDivElement | null>(null)

const ui = reactive<ToolbarUi>(emptyToolbarUi())

/* ================= 标题 / 保存状态 ================= */

const titleModel = computed<string>({
  get: () => currentNote.value?.title ?? '',
  set: (v: string) => {
    const note = currentNote.value
    if (note) note.title = v
  },
})

const wordCount = computed(() => {
  const text = currentNote.value ? textFromHtml(currentNote.value.content) : ''
  return text.replace(/\s/g, '').length
})

const editedText = computed(() => {
  const note = currentNote.value
  return note ? formatRelativeTime(note.updatedAt) : ''
})

const savedText = computed(() =>
  lastSavedAt.value !== null ? formatClock(lastSavedAt.value) : '',
)

const saveLabel = computed(() => {
  if (busy.value) return '保存中…'
  return savedFileName.value ? '保存' : '保存到文件'
})

const saveTitle = computed(() => {
  if (!savedFileName.value) return '保存到本地文件（首次需选择位置并授权）· ⌘S'
  return `原地覆盖保存到 ${savedFileName.value} · ⌘S`
})

function onSave(): void {
  void saveAll()
}

function onTitleInput(): void {
  requestAutosave()
}

function onTitleEnter(): void {
  if (contentEl.value) focusEditorStart(contentEl.value)
  else titleInput.value?.blur()
}

/* ================= 快照历史（撤销 / 重做） ================= */

interface HistItem {
  html: string
  caret: number
}

const hist = reactive<{ stack: HistItem[]; index: number }>({ stack: [], index: -1 })
let lastSnapshotHtml = ''

function snapshotCurrent(): void {
  const el = contentEl.value
  if (!el) return
  const html = el.innerHTML
  if (html === lastSnapshotHtml && hist.index >= 0) return
  hist.stack = hist.stack.slice(0, hist.index + 1)
  hist.stack.push({ html, caret: caretTextIndex(el) })
  if (hist.stack.length > 120) hist.stack.shift()
  hist.index = hist.stack.length - 1
  lastSnapshotHtml = html
  refreshUndoFlags()
}

function restoreHtml(item: HistItem): void {
  const el = contentEl.value
  if (!el) return
  el.innerHTML = item.html
  lastSnapshotHtml = item.html
  restoreCaretByTextIndex(el, item.caret)
}

function doUndo(): void {
  if (hist.index > 0) {
    hist.index -= 1
    restoreHtml(hist.stack[hist.index]!)
    afterDomChange()
  }
}

function doRedo(): void {
  if (hist.index < hist.stack.length - 1) {
    hist.index += 1
    restoreHtml(hist.stack[hist.index]!)
    afterDomChange()
  }
}

/* ================= DOM ⇄ 数据 同步 ================= */

let suppressContentWatch = false
let syncTimer: number | undefined

/** 组件卸载时 currentNote 可能已指向下一条笔记；只在装载的这条笔记上写回 */
const mountedNoteId: string | null = currentNote.value?.id ?? null

function normalizeEditorHtml(el: HTMLElement): string {
  return normalizeHtml(el.innerHTML)
}

function syncNoteFromDom(): void {
  const note = currentNote.value
  const el = contentEl.value
  if (!note || !el) return
  if (note.id !== mountedNoteId) return // 卸载期防止把旧 DOM 写进新笔记
  const html = normalizeEditorHtml(el)
  suppressContentWatch = true
  if (note.content !== html) note.content = html
  suppressContentWatch = false
  requestAutosave()
  updateEmptyClass()
}

function updateEmptyClass(): void {
  const el = contentEl.value
  if (!el) return
  el.classList.toggle('is-empty', !editorHasContent(el))
}

/** 首次装载：把 note.content（HTML 或旧纯文本）写入编辑区 */
function loadContent(): void {
  const note = currentNote.value
  const el = contentEl.value
  if (!note || !el) return
  if (note.id !== mountedNoteId) return

  const raw = note.content ?? ''
  let html = ''
  if (raw) {
    html = looksLikeHtml(raw) ? normalizeHtml(raw) : normalizeHtml(legacyTextToHtml(raw))
  }
  if (!html) html = '<p><br></p>'

  el.innerHTML = html
  suppressContentWatch = true
  if (note.content !== html) note.content = html
  suppressContentWatch = false

  updateEmptyClass()
  snapshotCurrent()
  refreshUi()
}

/** 输入防抖：停顿后同步数据 + 记一次快照 */
function scheduleSync(): void {
  window.clearTimeout(syncTimer)
  syncTimer = window.setTimeout(() => {
    syncNoteFromDom()
    snapshotCurrent()
  }, 500)
}

function flushSync(): void {
  window.clearTimeout(syncTimer)
  syncTimer = undefined
  syncNoteFromDom()
  snapshotCurrent()
}

/* 外部（如导入）修改了当前笔记内容时刷新编辑区 */
watch(
  () => currentNote.value?.content,
  (value) => {
    if (suppressContentWatch) return
    const note = currentNote.value
    const el = contentEl.value
    if (!note || !el || value === undefined) return
    if (note.id !== mountedNoteId) return
    const incoming = normalizeHtml(value || '')
    if (incoming === normalizeEditorHtml(el)) return
    el.innerHTML = incoming || '<p><br></p>'
    updateEmptyClass()
    snapshotCurrent()
    refreshUi()
  },
)

/* ================= UI 状态刷新 ================= */

let selTimer: number | undefined

function refreshUi(): void {
  const el = contentEl.value
  if (!el) return
  if (!isInsideEditor(el)) return

  ui.kind = currentBlockKind(el)
  const marks = ['bold', 'italic', 'strike', 'inlineCode'] as const
  for (const m of marks) {
    ui.marks[m] = isMarkActive(el, m)
  }
  ui.collapsed = !hasTextSelection(el)
  ui.inCode = ui.kind === 'codeblock'
  ui.inList = ui.kind === 'bulletList' || ui.kind === 'orderedList'
  refreshUndoFlags()
}

function refreshUndoFlags(): void {
  ui.canUndo = hist.index > 0
  ui.canRedo = hist.index < hist.stack.length - 1
}

function onDocSelectionChange(): void {
  if (!isInsideEditor(contentEl.value!)) return
  window.clearTimeout(selTimer)
  selTimer = window.setTimeout(refreshUi, 90)
}

function hasTextSelection(el: HTMLElement): boolean {
  const range = getCaretRange(el)
  return !!range && !range.collapsed && !!range.toString().trim()
}

/* ================= 工具条动作 ================= */

const MARK_ACTIONS = new Set<InlineMark>(['bold', 'italic', 'strike', 'inlineCode'])

function exec(action: ToolbarAction): void {
  const el = contentEl.value
  if (!el) return

  if (action === 'undo') return doUndo()
  if (action === 'redo') return doRedo()

  if (MARK_ACTIONS.has(action as InlineMark)) {
    if (!hasTextSelection(el)) {
      toast('请先选中要设置样式的文字', 'info')
      return
    }
    toggleInlineMark(el, action as InlineMark)
    afterDomChange()
    return
  }

  switch (action) {
    case 'paragraph':
    case 'h1':
    case 'h2':
    case 'h3':
    case 'blockquote':
    case 'codeblock':
    case 'bulletList':
    case 'orderedList':
      setBlockType(el, action as BlockKind)
      break
    case 'divider':
      insertDivider(el)
      break
    default:
      return
  }
  afterDomChange()
}

/** 结构变化后：落库、入快照、刷新状态 */
function afterDomChange(): void {
  syncNoteFromDom()
  snapshotCurrent()
  refreshUi()
}

/* ================= 编辑器键盘 / 剪贴板 ================= */

function onKeydown(e: KeyboardEvent): void {
  const el = contentEl.value
  if (!el) return
  const mod = e.metaKey || e.ctrlKey

  if (mod && (e.key === 'z' || e.key === 'Z')) {
    e.preventDefault()
    if (e.shiftKey) doRedo()
    else doUndo()
    return
  }
  if (mod && (e.key === 'y' || e.key === 'Y')) {
    e.preventDefault()
    doRedo()
    return
  }
  if (mod) return

  if (e.key === 'Enter') {
    if (e.shiftKey) return // 保留浏览器行为插入 <br>
    e.preventDefault()
    handleEnterKey(el)
    afterDomChange()
    return
  }
  if (e.key === 'Tab') {
    if (handleTabKey(el, e.shiftKey)) {
      e.preventDefault()
      afterDomChange()
    }
  }
}

function onPaste(e: ClipboardEvent): void {
  const el = contentEl.value
  if (!el) return
  e.preventDefault()
  const text = e.clipboardData?.getData('text/plain') ?? ''
  if (text) {
    pasteTextInto(el, text)
    scheduleSync()
    refreshUi()
  }
}

function onContentInput(): void {
  scheduleSync()
  updateEmptyClass()
}

function onBlur(): void {
  flushSync()
}

/* ================= 生命周期 ================= */

onMounted(() => {
  loadContent()
  document.addEventListener('selectionchange', onDocSelectionChange)

  const note = currentNote.value
  nextTick(() => {
    // 新建的空白笔记自动聚焦标题
    if (note && !note.title && !note.content) {
      titleInput.value?.focus()
    }
  })
})

onBeforeUnmount(() => {
  window.clearTimeout(syncTimer)
  window.clearTimeout(selTimer)
  flushSync()
  document.removeEventListener('selectionchange', onDocSelectionChange)
})
</script>

<template>
  <div class="editor">
    <!-- 顶栏：最近编辑时间 + 自动保存 + 保存到文件 -->
    <div class="editor__bar">
      <span class="bar__edited">{{ editedText }}</span>
      <span class="bar__right">
        <transition name="fade">
          <span v-if="savedText" class="save-hint">
            <span class="save-hint__dot"></span>
            {{ savedText }} 已自动保存
          </span>
        </transition>

        <span
          v-if="savedFileName"
          class="bar__target"
          :title="`保存到 ${savedFileName}`"
        >{{ savedFileName }}</span>

        <button
          class="btn-ghost bar__save"
          :disabled="busy"
          :title="saveTitle"
          @click="onSave"
        >{{ saveLabel }}</button>
      </span>
    </div>

    <!-- 顶部格式工具条 -->
    <NoteToolbar :ui="ui" @exec="exec" />

    <div class="editor__body">
      <div class="page">
        <input
          ref="titleInput"
          v-model="titleModel"
          class="title"
          type="text"
          maxlength="200"
          placeholder="无标题"
          @input="onTitleInput"
          @keydown.enter.prevent="onTitleEnter"
        />

        <div
          ref="contentEl"
          class="note-content"
          contenteditable="true"
          spellcheck="false"
          role="textbox"
          aria-multiline="true"
          data-placeholder="开始记录一些想法…"
          @input="onContentInput"
          @keydown="onKeydown"
          @paste="onPaste"
          @click="refreshUi"
          @keyup="refreshUi"
          @focus="refreshUi"
          @blur="onBlur"
        ></div>

        <p class="page__foot">共 {{ wordCount }} 字</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.editor {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-width: 0;
}

/* ---------- 顶栏 ---------- */
.editor__bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  height: 44px;
  flex: none;
  padding: 0 24px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-canvas);
}
.bar__edited {
  font-size: 12.5px;
  color: var(--text-faint);
  white-space: nowrap;
}
.bar__right {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
.save-hint {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12.5px;
  color: var(--text-mid);
  white-space: nowrap;
}
.save-hint__dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--success);
}
.bar__target {
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  color: var(--text-mid);
  background: var(--bg-soft);
  border-radius: 999px;
  padding: 3px 11px;
}
.bar__save {
  padding: 4px 11px;
  font-size: 12.5px;
}
.bar__save:disabled {
  opacity: 0.55;
  cursor: default;
}
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.25s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

/* ---------- 正文滚动区 ---------- */
.editor__body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}

.page {
  max-width: 740px;
  margin: 0 auto;
  padding: 34px 56px 90px;
}

.title {
  display: block;
  width: 100%;
  border: none;
  outline: none;
  background: transparent;
  font-size: 30px;
  font-weight: 700;
  line-height: 1.3;
  letter-spacing: -0.015em;
  padding: 0;
  margin-bottom: 18px;
  caret-color: var(--accent);
}
.title::placeholder {
  color: var(--text-faint);
  font-weight: 600;
}

.page__foot {
  margin: 30px 0 0;
  text-align: right;
  font-size: 12px;
  color: var(--text-faint);
}

/* 正文内容区域（内部块的排版样式见 src/style.css 全局定义） */
.note-content {
  min-height: 58vh;
  outline: none;
  caret-color: var(--accent);
}
</style>
