<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { Note } from "../types";
import { useNotes } from "../composables/useNotes";
import { useToast } from "../composables/useToast";
import StyleSettings from "./StyleSettings.vue";
import FontSwitcher from "./FontSwitcher.vue";
import { textFromHtml } from "../editor/html";
import { formatRelativeTime, noteSummary } from "../utils/format";
import { useTheme } from "../composables/useTheme";

const { sortedNotes, currentNote, createNote, selectNote, deleteNote } =
  useNotes();
const { toasts, toast } = useToast();
/** 外观主题：浅色 / 黑夜模式（切换按钮放在导出 PDF 左侧） */
const { isDark, toggleTheme } = useTheme();
/** 只展示最新一条提示（显示在文章选择器右侧，纯文字） */
const latestToast = computed(() => {
  const list = toasts.value;
  return list.length > 0 ? list[list.length - 1] : null;
});

/* ---------------- 下拉 ---------------- */
const open = ref(false);
const deletingId = ref<string | null>(null);

const currentLabel = computed(() => {
  const n = currentNote.value;
  return n ? itemLabel(n) : "无笔记";
});

function itemLabel(n: Note): string {
  const t = n.title.trim();
  if (t) return t;
  const first = noteSummary(textFromHtml(n.content));
  return first || "无标题";
}

function toggleOpen(): void {
  open.value = !open.value;
}

function onPick(note: Note): void {
  open.value = false;
  deletingId.value = null;
  if (note.id !== currentNote.value?.id) selectNote(note.id);
}

function startDelete(n: Note): void {
  deletingId.value = deletingId.value === n.id ? null : n.id;
}

function confirmDelete(n: Note): void {
  deleteNote(n.id);
  deletingId.value = null;
  open.value = false;
  toast("已删除", "success");
}

function onCreate(): void {
  open.value = false;
  createNote();
  toast("已新建笔记", "success");
}

function onExportPdf(): void {
  // 临时清空页面标题，避免浏览器页眉打印出 “Notebook” 等文字
  const prev = document.title;
  document.title = "";
  try {
    window.print();
  } finally {
    document.title = prev;
  }
}

function onDocPointerdown(e: PointerEvent): void {
  if (!open.value) return;
  const target = e.target as Element | null;
  // 只要点击不在笔记切换 picker（trigger / 面板）内，就收起下拉
  // （含顶栏其它按钮、样式设置弹窗、页面其它位置）
  if (!target || !target.closest(".picker")) {
    open.value = false;
  }
}

watch(open, (v) => {
  if (!v) deletingId.value = null;
});

onMounted(() => document.addEventListener("pointerdown", onDocPointerdown));
onBeforeUnmount(() =>
  document.removeEventListener("pointerdown", onDocPointerdown),
);
</script>

<template>
  <header class="appbar">
    <!-- 新建 + 笔记切换 -->
    <div class="appbar__left">
      <!-- <span class="brand">笔记本</span> -->

      <button
        class="btn-primary appbar__new"
        title="新建笔记（⌘N / Ctrl+N）"
        @click="onCreate"
      >
        新建
      </button>

      <div class="picker">
        <button
          class="picker__trigger"
          :class="{ open }"
          :title="
            currentNote
              ? `切换笔记（共 ${sortedNotes.length} 条）`
              : '还没有笔记'
          "
          :disabled="!currentNote"
          @click="toggleOpen"
        >
          <span class="picker__label">{{ currentLabel }}</span>
        </button>

        <transition name="drop">
          <div v-if="open" class="picker__panel">
            <div
              v-for="n in sortedNotes"
              :key="n.id"
              class="note"
              :class="{ active: n.id === currentNote?.id }"
              @click="onPick(n)"
            >
              <span class="note__main">
                <span class="note__title">{{ itemLabel(n) }}</span>
                <span class="note__time">{{
                  formatRelativeTime(n.updatedAt)
                }}</span>
              </span>

              <span v-if="deletingId === n.id" class="note__ops" @click.stop>
                <button class="mini-btn danger" @click="confirmDelete(n)">
                  删除
                </button>
                <button class="mini-btn" @click="deletingId = null">
                  取消
                </button>
              </span>
              <button
                v-else
                class="mini-btn note__del"
                :title="'删除「' + itemLabel(n) + '」'"
                @click.stop="startDelete(n)"
              >
                删除
              </button>
            </div>

            <p v-if="sortedNotes.length === 0" class="picker__empty">
              暂无笔记，点「新建」开始
            </p>
          </div>
        </transition>
      </div>

      <!-- 操作提示：紧贴文章选择器右侧，仅文字 -->
      <transition name="toastfade">
        <span
          v-if="latestToast"
          :key="latestToast.id"
          class="bar-toast"
          :class="`bar-toast--${latestToast.type}`"
          >{{ latestToast.text }}</span
        >
      </transition>
    </div>

    <!-- 右侧：黑夜模式 · 导出 PDF · 样式设置（相邻排布，尺寸一致） -->
    <div class="appbar__right">
      <!-- 黑夜模式开关：紧挨在导出 PDF 左侧 -->
      <button
        class="theme-btn"
        :class="{ 'is-dark': isDark }"
        :title="isDark ? '切换到浅色模式' : '切换到黑夜模式'"
        :aria-label="isDark ? '切换到浅色模式' : '切换到黑夜模式'"
        :aria-pressed="isDark"
        @click="toggleTheme"
      >
        <svg
          viewBox="0 0 24 24"
          class="theme-btn-ic"
          fill="none"
          stroke="currentColor"
          stroke-width="1.7"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <!-- 当前是黑夜模式 → 显示太阳（点它回到浅色） -->
          <template v-if="isDark">
            <circle cx="12" cy="12" r="4.1" />
            <path
              d="M12 3.2v2.3M12 18.5v2.3M3.2 12h2.3M18.5 12h2.3M5.8 5.8l1.6 1.6M16.6 16.6l1.6 1.6M18.2 5.8l-1.6 1.6M7.4 16.6l-1.6 1.6"
            />
          </template>
          <!-- 当前是浅色 → 显示月亮 -->
          <path
            v-else
            d="M20.4 13.7A8.4 8.4 0 1 1 10.3 3.6a6.7 6.7 0 0 0 10.1 10.1z"
          />
        </svg>
      </button>
      <button
        class="pdf-btn"
        title="把当前笔记打印 / 另存为 PDF"
        aria-label="导出 PDF"
        @click="onExportPdf"
      >
        <svg viewBox="0 0 24 24" class="pdf-btn-ic" aria-hidden="true">
          <text
            x="12"
            y="13.2"
            text-anchor="middle"
            dominant-baseline="central"
            font-size="11"
            font-weight="600"
            fill="currentColor"
            stroke="none"
          >
            PDF
          </text>
        </svg>
      </button>
      <FontSwitcher />
      <StyleSettings />
    </div>
  </header>
</template>

<style scoped>
.appbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  height: 50px;
  flex: none;
  padding: 0 20px;
  border-bottom: none;
  background: var(--bg-canvas);
  box-shadow: var(--neu-raise-sm);
}

.appbar__right {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: none;
}

/* 黑夜模式开关 + 导出 PDF 按钮：尺寸与样式设置按钮(.ss__btn 36×34)一致 */
.theme-btn,
.pdf-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 34px;
  border: none;
  border-radius: 10px;
  background: var(--bg-canvas);
  color: var(--text-mid);
  cursor: pointer;
  box-shadow: var(--neu-raise-sm);
  transition:
    background-color 0.18s ease,
    color 0.18s ease,
    box-shadow 0.22s ease;
}
.theme-btn-ic,
.pdf-btn-ic {
  width: 22px;
  height: 22px;
}
.theme-btn:hover:not(:active),
.pdf-btn:hover:not(:active) {
  background: var(--surface-hl);
  color: var(--text-strong);
}
.theme-btn:active,
.pdf-btn:active {
  box-shadow: var(--neu-sink-sm);
}
/* 黑夜模式下让开关保持一点强调色，提示当前处于深色外观 */
.theme-btn.is-dark {
  color: var(--accent);
}

.appbar__left {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

/* 操作提示：仅一行文字，无边框 / 无背景。
   质感靠字号字重、状态色与极轻的淡入微移来实现 */
.bar-toast {
  min-width: 0;
  max-width: 340px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  font-weight: 500;
  letter-spacing: 0.012em;
  line-height: 1.5;
  color: var(--text-mid);
  text-rendering: optimizeLegibility;
  margin: 15px;
}
.bar-toast--info {
  color: var(--text-mid);
}
.bar-toast--success {
  color: var(--msg-success);
}
.bar-toast--error {
  color: var(--msg-error);
}

/* 出现：淡入 + 轻微上移；消失：淡出 + 轻微上移，安静不打扰 */
.toastfade-enter-active {
  transition:
    opacity 0.2s ease,
    transform 0.24s cubic-bezier(0.2, 0.8, 0.3, 1);
}
.toastfade-leave-active {
  transition:
    opacity 0.16s ease,
    transform 0.18s ease;
}
.toastfade-enter-from {
  opacity: 0;
  transform: translateY(3px);
}
.toastfade-leave-to {
  opacity: 0;
  transform: translateY(-2px);
}
.brand {
  font-size: 15px;
  font-weight: 700;
  letter-spacing: 0.01em;
  color: var(--accent);
  white-space: nowrap;
}
.appbar__new {
  padding: 5px 12px;
  font-size: 13px;
  font-weight: 400;
  height: 28px;
}

/* ---------- 笔记切换下拉 ---------- */
.picker {
  position: relative;
  min-width: 0;
}
.picker__trigger {
  display: flex;
  align-items: center;
  gap: 8px;
  max-width: 320px;
  min-width: 120px;
  height: 28px;
  padding: 0 6px 0 12px;
  border: none;
  border-radius: var(--radius-md);
  background: var(--bg-canvas);
  color: var(--text-strong);
  font-size: 13.5px;
  cursor: pointer;
  box-shadow: var(--neu-raise-sm);
  transition:
    background-color 0.14s ease,
    box-shadow 0.14s ease;
}
.picker__trigger:hover:not(:disabled):not(:active):not(.open) {
  background: var(--surface-hl);
}
.picker__trigger:active:not(:disabled),
.picker__trigger.open:not(:disabled) {
  box-shadow: var(--neu-sink-sm);
}
.picker__trigger.open:not(:disabled) {
  color: var(--accent);
}
.picker__trigger:disabled {
  color: var(--text-faint);
  cursor: default;
  box-shadow: none;
}
.picker__label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: left;
}

.picker__panel {
  position: absolute;
  top: calc(100% + 10px);
  left: 0;
  z-index: 40;
  width: 300px;
  max-height: min(420px, 60vh);
  overflow-y: auto;
  padding: 6px;
  border: none;
  border-radius: 12px;
  background: var(--bg-canvas);
  box-shadow: var(--shadow-pop);
}
.drop-enter-active,
.drop-leave-active {
  transition:
    opacity 0.14s ease,
    transform 0.14s ease;
}
.drop-enter-from,
.drop-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}

.note {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px 8px;
  border-radius: var(--radius-sm);
  cursor: pointer;
}
.note + .note {
  margin-top: 6px; /* 选项间隙 = 面板 padding */
}
.note:hover:not(.active) {
  background: var(--bg-hover);
}
.note.active {
  background: var(--bg-active);
}
.note__main {
  flex: 1;
  min-width: 0;
}
.note__title {
  display: block;
  font-size: 13.5px;
  font-weight: 550;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.note__time {
  display: block;
  margin-top: 2px;
  font-size: 11px;
  color: var(--text-faint);
}
.note__del {
  opacity: 0;
}
.note:hover:not(.active) .note__del,
.note:focus-within .note__del {
  opacity: 1;
}
.note__ops {
  display: inline-flex;
  gap: 4px;
  flex: none;
}
.picker__empty {
  margin: 0;
  padding: 18px 8px;
  text-align: center;
  font-size: 12.5px;
  color: var(--text-faint);
}

/* 按钮按压态 / 常态平滑切换（统一） */
.picker__trigger,
.note {
  transition:
    background-color 0.18s ease,
    color 0.18s ease,
    box-shadow 0.22s ease,
    opacity 0.2s ease;
}
</style>
