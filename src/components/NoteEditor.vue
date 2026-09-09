<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  reactive,
  ref,
  watch,
} from "vue";
import NoteToolbar from "./NoteToolbar.vue";
import type { ToolbarAction } from "./NoteToolbar.vue";
import { useNoteStyles } from "../composables/useNoteStyles";
import type { BlockKind, InlineMark, ToolbarUi } from "../editor/blocks";
import {
  caretTextIndex,
  codeExitOnArrowDown,
  currentBlockKind,
  editorHasContent,
  emptyToolbarUi,
  ensureStartParagraph,
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
} from "../editor/blocks";
import {
  legacyTextToHtml,
  looksLikeHtml,
  normalizeHtml,
  sanitizeHtml,
  textFromHtml,
} from "../editor/html";
import { useNotes } from "../composables/useNotes";
import { useToast } from "../composables/useToast";

const { currentNote, markEdited } = useNotes();
const { toasts, toast } = useToast();

/** 只展示最新一条提示（显示在格式条同一行右侧） */
const latestToast = computed(() => {
  const list = toasts.value;
  return list.length > 0 ? list[list.length - 1] : null;
});
/** 正文与标题的可视化样式（CSS 变量实时注入 .note-content） */
const { cssVars } = useNoteStyles();

const titleInput = ref<HTMLInputElement | null>(null);
const contentEl = ref<HTMLDivElement | null>(null);

const ui = reactive<ToolbarUi>(emptyToolbarUi());

/* ================= 标题 / 字数 ================= */

const titleModel = computed<string>({
  get: () => currentNote.value?.title ?? "",
  set: (v: string) => {
    const note = currentNote.value;
    if (note) note.title = v;
  },
});

const wordCount = computed(() => {
  const text = currentNote.value ? textFromHtml(currentNote.value.content) : "";
  return text.replace(/\s/g, "").length;
});

function onTitleInput(): void {
  markEdited();
}

function onTitleEnter(): void {
  const el = contentEl.value;
  if (!el) {
    titleInput.value?.blur();
    return;
  }
  // 正文首块若是代码块/分割线，先在其上方补一个空段落
  ensureStartParagraph(el);
  focusEditorStart(el);
  scheduleSync();
}

/* ================= 快照历史（撤销 / 重做） ================= */

interface HistItem {
  html: string;
  caret: number;
}

const hist = reactive<{ stack: HistItem[]; index: number }>({
  stack: [],
  index: -1,
});
let lastSnapshotHtml = "";

function snapshotCurrent(): void {
  const el = contentEl.value;
  if (!el) return;
  const html = el.innerHTML;
  if (html === lastSnapshotHtml && hist.index >= 0) return;
  hist.stack = hist.stack.slice(0, hist.index + 1);
  hist.stack.push({ html, caret: caretTextIndex(el) });
  if (hist.stack.length > 120) hist.stack.shift();
  hist.index = hist.stack.length - 1;
  lastSnapshotHtml = html;
  refreshUndoFlags();
}

function restoreHtml(item: HistItem): void {
  const el = contentEl.value;
  if (!el) return;
  el.innerHTML = item.html;
  lastSnapshotHtml = item.html;
  restoreCaretByTextIndex(el, item.caret);
}

function doUndo(): void {
  if (hist.index > 0) {
    hist.index -= 1;
    restoreHtml(hist.stack[hist.index]!);
    afterDomChange();
  }
}

function doRedo(): void {
  if (hist.index < hist.stack.length - 1) {
    hist.index += 1;
    restoreHtml(hist.stack[hist.index]!);
    afterDomChange();
  }
}

/* ================= DOM ⇄ 数据 同步 ================= */

let suppressContentWatch = false;
let syncTimer: number | undefined;

/** 组件卸载时 currentNote 可能已指向下一条笔记；只在装载的这条笔记上写回 */
const mountedNoteId: string | null = currentNote.value?.id ?? null;

function normalizeEditorHtml(el: HTMLElement): string {
  return normalizeHtml(el.innerHTML);
}

function syncNoteFromDom(): void {
  const note = currentNote.value;
  const el = contentEl.value;
  if (!note || !el) return;
  if (note.id !== mountedNoteId) return; // 卸载期防止把旧 DOM 写进新笔记
  const html = normalizeEditorHtml(el);
  suppressContentWatch = true;
  if (note.content !== html) note.content = html;
  suppressContentWatch = false;
  markEdited();
  updateEmptyClass();
}

function updateEmptyClass(): void {
  const el = contentEl.value;
  if (!el) return;
  el.classList.toggle("is-empty", !editorHasContent(el));
}

/** 首次装载：把 note.content（HTML 或旧纯文本）写入编辑区 */
function loadContent(): void {
  const note = currentNote.value;
  const el = contentEl.value;
  if (!note || !el) return;
  if (note.id !== mountedNoteId) return;

  const raw = note.content ?? "";
  let html = "";
  if (raw) {
    html = looksLikeHtml(raw)
      ? normalizeHtml(raw)
      : normalizeHtml(legacyTextToHtml(raw));
  }
  if (!html) html = "<p><br></p>";

  el.innerHTML = html;
  suppressContentWatch = true;
  if (note.content !== html) note.content = html;
  suppressContentWatch = false;

  updateEmptyClass();
  snapshotCurrent();
  refreshUi();
}

/** 输入防抖：停顿后同步数据 + 记一次快照 */
function scheduleSync(): void {
  window.clearTimeout(syncTimer);
  syncTimer = window.setTimeout(() => {
    syncNoteFromDom();
    snapshotCurrent();
  }, 500);
}

function flushSync(): void {
  window.clearTimeout(syncTimer);
  syncTimer = undefined;
  syncNoteFromDom();
  snapshotCurrent();
}

/* 外部修改了当前笔记内容时刷新编辑区 */
watch(
  () => currentNote.value?.content,
  (value) => {
    if (suppressContentWatch) return;
    const note = currentNote.value;
    const el = contentEl.value;
    if (!note || !el || value === undefined) return;
    if (note.id !== mountedNoteId) return;
    const incoming = normalizeHtml(value || "");
    if (incoming === normalizeEditorHtml(el)) return;
    // 重载前记住光标位置，重载后尽量恢复（避免光标跳回文档开头）
    const prevCaret = caretTextIndex(el);
    if (import.meta.env?.DEV) {
      console.info("[editor] reload note content, caret:", prevCaret);
    }
    el.innerHTML = incoming || "<p><br></p>";
    if (prevCaret >= 0) restoreCaretByTextIndex(el, prevCaret);
    updateEmptyClass();
    snapshotCurrent();
    refreshUi();
  },
);

/* ================= UI 状态刷新 ================= */

let selTimer: number | undefined;
/** 编辑区内最近一次的有效选区（供点击工具条后恢复） */
let lastSel: Range | null = null;

function refreshUi(): void {
  const el = contentEl.value;
  if (!el) return;
  if (!isInsideEditor(el)) return;

  // 记住编辑区内最近一次有效选区，供点击工具条后兜底恢复
  const r = getCaretRange(el);
  if (r) lastSel = r.cloneRange();

  ui.kind = currentBlockKind(el);
  const marks = ["bold", "italic", "strike", "inlineCode"] as const;
  for (const m of marks) {
    ui.marks[m] = isMarkActive(el, m);
  }
  ui.collapsed = !hasTextSelection(el);
  ui.inCode = ui.kind === "codeblock";
  ui.inList = ui.kind === "bulletList" || ui.kind === "orderedList";
  refreshUndoFlags();
}

function refreshUndoFlags(): void {
  ui.canUndo = hist.index > 0;
  ui.canRedo = hist.index < hist.stack.length - 1;
}

function onDocSelectionChange(): void {
  if (!isInsideEditor(contentEl.value!)) return;
  window.clearTimeout(selTimer);
  selTimer = window.setTimeout(refreshUi, 30);
}

function hasTextSelection(el: HTMLElement): boolean {
  const range = getCaretRange(el);
  return !!range && !range.collapsed && !!range.toString().trim();
}

/* ================= 工具条动作 ================= */

const MARK_ACTIONS = new Set<InlineMark>([
  "bold",
  "italic",
  "strike",
  "inlineCode",
]);

function exec(action: ToolbarAction): void {
  const el = contentEl.value;
  if (!el) return;

  if (action === "undo") return doUndo();
  if (action === "redo") return doRedo();

  // 点击工具条后编辑器仍可能短暂失去选区：先恢复最近一次的有效选区
  ensureEditorSelection(el);

  if (MARK_ACTIONS.has(action as InlineMark)) {
    if (!hasTextSelection(el)) {
      toast("请先选中要设置样式的文字", "info");
      return;
    }
    toggleInlineMark(el, action as InlineMark);
    afterDomChange();
    return;
  }

  switch (action) {
    case "paragraph":
    case "h1":
    case "h2":
    case "h3":
    case "codeblock":
    case "bulletList":
    case "orderedList":
      setBlockType(el, action as BlockKind);
      break;
    case "divider":
      insertDivider(el);
      break;
    default:
      return;
  }
  afterDomChange();
}

/** 确保工具条动作执行时，编辑器内有我们想操作的选区/光标 */
function ensureEditorSelection(el: HTMLElement): void {
  if (getCaretRange(el)) return; // 选区仍在编辑器内
  if (!lastSel || !el.contains(lastSel.startContainer)) return;
  el.focus();
  const sel = window.getSelection();
  if (!sel) return;
  sel.removeAllRanges();
  sel.addRange(lastSel);
}

/** 结构变化后：落库、入快照、刷新状态 */
function afterDomChange(): void {
  syncNoteFromDom();
  snapshotCurrent();
  refreshUi();
}

/* ================= 编辑器键盘 / 剪贴板 ================= */

function onKeydown(e: KeyboardEvent): void {
  const el = contentEl.value;
  if (!el) return;
  const mod = e.metaKey || e.ctrlKey;

  if (mod && (e.key === "z" || e.key === "Z")) {
    e.preventDefault();
    if (e.shiftKey) doRedo();
    else doUndo();
    return;
  }
  if (mod && (e.key === "y" || e.key === "Y")) {
    e.preventDefault();
    doRedo();
    return;
  }
  if (mod) return;

  // 代码块最后一行行尾按 ↓：在代码块下方另起新行并跳出代码块
  if (e.key === "ArrowDown") {
    if (codeExitOnArrowDown(el)) {
      e.preventDefault();
      afterDomChange();
    }
    return;
  }

  if (e.key === "Enter") {
    // 输入法组合中按回车是确认候选词，交给浏览器，不做块拆分
    if (e.isComposing || e.keyCode === 229) return;
    if (e.shiftKey) return; // 保留浏览器行为插入 <br>
    if (import.meta.env?.DEV) {
      const idx = caretTextIndex(el);
      console.info(
        "[enter] caretIdx=",
        idx,
        " 全文长度≈",
        (el.textContent ?? "").length,
        " html尾:",
        JSON.stringify(el.innerHTML.slice(-80)),
      );
    }
    const handled = handleEnterKey(el);
    if (handled) {
      e.preventDefault();
      afterDomChange();
    }
    return;
  }
  if (e.key === "Tab") {
    if (handleTabKey(el, e.shiftKey)) {
      e.preventDefault();
      afterDomChange();
    }
  }
}

function onPaste(e: ClipboardEvent): void {
  const el = contentEl.value;
  if (!el) return;
  e.preventDefault();
  const plain = e.clipboardData?.getData("text/plain") ?? "";
  const rawHtml = e.clipboardData?.getData("text/html") ?? "";
  let inserted = false;

  // 优先富文本：清洗后以 HTML 插入，保留标题/粗体/斜体/列表等样式
  if (rawHtml && looksLikeHtml(rawHtml)) {
    const cleaned = sanitizeHtml(rawHtml);
    if (/<[a-z!\/]/i.test(cleaned)) {
      const rich = normalizeHtml(cleaned);
      try {
        document.execCommand("insertHTML", false, rich);
        inserted = true;
      } catch {
        inserted = false;
      }
    }
  }

  // 无可用富文本或插入失败：退回纯文本
  if (!inserted) {
    const text = plain !== "" ? plain : textFromHtml(rawHtml);
    if (text) {
      pasteTextInto(el, text);
      inserted = true;
    }
  }

  scheduleSync();
  refreshUi();
  updateEmptyClass();
}

/** 复制：把选区连同样式（text/html）写入剪贴板 */
function onCopy(e: ClipboardEvent): void {
  const el = contentEl.value;
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;
  if (!el || !el.contains(sel.anchorNode)) return;

  const frag = sel.getRangeAt(0).cloneContents();
  const box = document.createElement("div");
  box.appendChild(frag);
  const cleaned = sanitizeHtml(box.innerHTML);
  if (!cleaned) return;

  e.clipboardData?.setData("text/html", cleaned);
  e.clipboardData?.setData("text/plain", sel.toString());
  e.preventDefault();
}

function onContentInput(): void {
  scheduleSync();
  updateEmptyClass();
}

function onBlur(): void {
  flushSync();
}

/* ================= 生命周期 ================= */

onMounted(() => {
  loadContent();
  document.addEventListener("selectionchange", onDocSelectionChange);

  const note = currentNote.value;
  nextTick(() => {
    // 新建的空白笔记自动聚焦标题
    if (note && !note.title && !note.content) {
      titleInput.value?.focus();
    }
  });
});

onBeforeUnmount(() => {
  window.clearTimeout(syncTimer);
  window.clearTimeout(selTimer);
  flushSync();
  document.removeEventListener("selectionchange", onDocSelectionChange);
});
</script>

<template>
  <div class="editor">
    <!-- 顶部格式工具条 + 右侧提示文字（同一行） -->
    <div class="fmtline">
      <NoteToolbar :ui="ui" @exec="exec" />

      <transition name="slotfade" mode="out-in">
        <span
          v-if="latestToast"
          :key="latestToast.id"
          class="toast-slot"
          :class="`toast-slot--${latestToast.type}`"
          >{{ latestToast.text }}</span
        >
      </transition>
    </div>

    <div class="editor__body">
      <div class="page">
        <!-- 滚动区：内容只在 padding 内侧可见，超出即裁切 -->
        <div class="page__content">
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
            :style="cssVars"
            @input="onContentInput"
            @keydown="onKeydown"
            @paste="onPaste"
            @copy="onCopy"
            @click="refreshUi"
            @keyup="refreshUi"
            @focus="refreshUi"
            @blur="onBlur"
          ></div>
        </div>

        <!-- 页脚：固定在页面底部 padding 条内、右下角，不随内容滚动 -->
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
  position: relative; /* 供右上角样式设置悬浮定位 */
}

/* ---------- 格式条行：工具条占满 + 右侧提示文字（浮层，不影响 fmtbar 宽度与边框） ---------- */
.fmtline {
  position: relative;
  flex: none;
}
.fmtline :deep(.fmtbar) {
  width: 100%;
  min-width: 0;
}
.toast-slot {
  position: absolute;
  top: 50%;
  right: 14px;
  transform: translateY(-50%);
  max-width: 34vw;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  line-height: 1;
  font-size: 12px;
  font-weight: 500;
  color: var(--text-mid);
  pointer-events: none;
  z-index: 2;
}
.toast-slot--success {
  color: #0d8f5f;
}
.toast-slot--error {
  color: #cf3b3b;
}
.slotfade-enter-active,
.slotfade-leave-active {
  transition: opacity 0.18s ease;
}
.slotfade-enter-from,
.slotfade-leave-to {
  opacity: 0;
}

/* ---------- 页面视口 ---------- */
/* editor__body 不再自身滚动：滚动被限制在 .page__content（padding 内侧），
   内容滚出 padding 内侧可视区即被裁剪隐藏；上下左右留白始终干净。 */
.editor__body {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  padding: 0 36px; /* 左右留白：纸张卡片不贴屏幕边 */
}

.page {
  height: calc(100% - 28px);
  max-width: 1060px;
  margin: 14px auto;
  display: flex;
  flex-direction: column;
  padding: 30px 40px 0;
  overflow: hidden;
  background: #fffef8; /* 白纸卡面 */
  border-radius: 20px;
  box-shadow:
    18px 18px 36px rgba(95, 100, 110, 0.32),
    -14px -14px 28px rgba(255, 255, 255, 0.9);
}

/* 滚动内容区：可滚动的只有这里，四边 padding 均不参与滚动 */
.page__content {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
}

/* 页脚：固定在页面底部 padding 条内（右下角），不随内容滚动 */
.page__foot {
  flex: none;
  height: 40px;
  margin: 0;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  font-size: 12px;
  color: var(--text-faint);
}

.title {
  display: block;
  width: 100%;
  border: none;
  outline: none;
  background: transparent;
  font-family: var(--font-content);
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

/* 正文内容区域（内部块的排版样式见 src/style.css 全局定义） */
.note-content {
  min-height: 58vh;
  outline: none;
  caret-color: var(--accent);
}
</style>
