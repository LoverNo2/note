<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import { useFonts } from "../composables/useFonts";

const { families, selected, setFont } = useFonts();
const open = ref(false);
const rootEl = ref<HTMLElement | null>(null);

function toggle(): void {
  open.value = !open.value;
}

function pick(kind: "latin" | "cjk", name: string): void {
  setFont(kind, name);
}

function onDocPointerDown(e: PointerEvent): void {
  if (!open.value) return;
  const el = rootEl.value;
  if (el && e.target instanceof Node && !el.contains(e.target))
    open.value = false;
}

function onKey(e: KeyboardEvent): void {
  if (e.key === "Escape") open.value = false;
}

onMounted(() => {
  document.addEventListener("pointerdown", onDocPointerDown);
  document.addEventListener("keydown", onKey);
});
onBeforeUnmount(() => {
  document.removeEventListener("pointerdown", onDocPointerDown);
  document.removeEventListener("keydown", onKey);
});
</script>

<template>
  <div ref="rootEl" class="fs">
    <button
      class="fs__btn"
      :class="{ open }"
      title="切换字体（英文与中文可分别设置）"
      @click="toggle"
    >
      font
    </button>

    <transition name="fspop">
      <div v-if="open" class="fs__panel">
        <p class="fs__group">英文 / 数字</p>
        <button
          v-for="f in families"
          :key="`l-${f.name}`"
          class="fs__opt"
          :class="{ 'is-active': selected.latin === f.name }"
          :title="`英文使用 ${f.name}`"
          @click="pick('latin', f.name)"
        >
          <span class="fs__name">{{ f.name }}</span>
        </button>

        <p class="fs__group fs__group--gap">中文</p>
        <button
          v-for="f in families"
          :key="`c-${f.name}`"
          class="fs__opt"
          :class="{ 'is-active': selected.cjk === f.name }"
          :title="`中文使用 ${f.name}`"
          @click="pick('cjk', f.name)"
        >
          <span class="fs__name">{{ f.name }}</span>
        </button>

        <p v-if="families.length === 0" class="fs__empty">
          未在 asset/fonts/ 下发现字体包
        </p>
      </div>
    </transition>
  </div>
</template>

<style scoped>
.fs {
  position: relative;
}

/* 与 PDF 按钮同尺寸、同质感 */
.fs__btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 34px;
  border: none;
  border-radius: 10px;
  background: var(--bg-canvas);
  color: var(--text-mid);
  font-family: inherit;
  font-size: 12.5px;
  font-weight: 600;
  letter-spacing: 0.02em;
  cursor: pointer;
  box-shadow: var(--neu-raise-sm);
  transition:
    background-color 0.18s ease,
    color 0.18s ease,
    box-shadow 0.22s ease;
}
.fs__btn:hover:not(:active):not(.open) {
  color: var(--text-strong);
  background: rgba(255, 255, 255, 0.5);
}
.fs__btn.open,
.fs__btn:active {
  box-shadow: var(--neu-sink-sm);
}

/* 选择框：新拟态浮层 */
.fs__panel {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  z-index: 70;
  width: 208px;
  max-height: 62vh;
  overflow-y: auto;
  padding: 10px 8px;
  border-radius: 14px;
  background: var(--bg-canvas);
  box-shadow: var(--shadow-pop);
}

.fs__group {
  margin: 0 0 6px;
  padding: 0 8px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.1em;
  color: var(--text-faint);
  user-select: none;
}
.fs__group--gap {
  margin-top: 12px;
}

.fs__opt {
  display: block;
  width: 100%;
  padding: 5px 8px;
  border: none;
  border-radius: 8px;
  background: transparent;
  font-family: inherit;
  font-size: 12.5px;
  line-height: 1.5;
  color: var(--text-mid);
  text-align: left;
  cursor: pointer;
  transition:
    background-color 0.18s ease,
    color 0.18s ease,
    box-shadow 0.22s ease;
}
.fs__opt:hover:not(.is-active) {
  color: var(--text-strong);
  background: rgba(255, 255, 255, 0.5);
}
.fs__opt.is-active {
  color: var(--text-strong);
  font-weight: 500;
  box-shadow: var(--neu-sink-sm);
}

.fs__name {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.fs__empty {
  margin: 4px 8px 2px;
  font-size: 12px;
  color: var(--text-faint);
}

.fspop-enter-active,
.fspop-leave-active {
  transition:
    opacity 0.16s ease,
    transform 0.18s cubic-bezier(0.2, 0.8, 0.3, 1);
}
.fspop-enter-from,
.fspop-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
</style>
