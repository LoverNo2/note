<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { Note } from "../types";
import { useNotes } from "../composables/useNotes";
import { useToast } from "../composables/useToast";
import { textFromHtml } from "../editor/html";
import { formatRelativeTime, noteSummary } from "../utils/format";

const {
  sortedNotes,
  currentNote,
  createNote,
  selectNote,
  deleteNote,
} = useNotes();
const { toasts, toast } = useToast();

/* ---------------- 下拉 ---------------- */
const open = ref(false);
const deletingId = ref<string | null>(null);
const rootEl = ref<HTMLElement | null>(null);

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

function onDocPointerdown(e: PointerEvent): void {
  if (!open.value) return;
  const root = rootEl.value;
  if (root && !root.contains(e.target as Node)) open.value = false;
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
  <header ref="rootEl" class="appbar">
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
    </div>
  </header>

  <div class="toast-list">
    <div
      v-for="t in toasts"
      :key="t.id"
      class="toast"
      :class="`toast--${t.type}`"
    >{{ t.text }}</div>
  </div>
</template>

<style scoped>
.appbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  height: 50px;
  flex: none;
  padding: 0 16px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-canvas);
}

.appbar__left {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
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
  height: 30px;
  padding: 0 6px 0 12px;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  background: var(--bg-canvas);
  color: var(--text-strong);
  font-size: 13.5px;
  cursor: pointer;
  transition:
    background-color 0.14s ease,
    border-color 0.14s ease;
}
.picker__trigger:hover:not(:disabled) {
  background: var(--bg-hover);
}
.picker__trigger:disabled {
  color: var(--text-faint);
  cursor: default;
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
  top: calc(100% + 6px);
  left: 0;
  z-index: 40;
  width: 300px;
  max-height: min(420px, 60vh);
  overflow-y: auto;
  padding: 5px;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
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
.note:hover {
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
.note:hover .note__del,
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
</style>
