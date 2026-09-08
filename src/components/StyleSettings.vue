<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import {
  useNoteStyles,
  type TextBlockKey,
} from '../composables/useNoteStyles'

const {
  state,
  labels,
  resetBlock,
  resetAll,
} = useNoteStyles()

/** 四种块（固定顺序渲染） */
const BLOCK_KEYS: TextBlockKey[] = ['paragraph', 'h1', 'h2', 'h3']

const open = ref(false)
const rootEl = ref<HTMLElement | null>(null)

/** 数值 → 紧凑显示，如 0.005 / -0.012 / 0.1 */
function fmt(v: number): string {
  return String(Math.round(v * 1000) / 1000)
}

function toggle(): void {
  open.value = !open.value
}

function onDocPointerdown(e: PointerEvent): void {
  if (!open.value) return
  const root = rootEl.value
  if (root && !root.contains(e.target as Node)) open.value = false
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape') open.value = false
}

onMounted(() => {
  document.addEventListener('pointerdown', onDocPointerdown)
  window.addEventListener('keydown', onKeydown)
})
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDocPointerdown)
  window.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <div ref="rootEl" class="ss">
    <!-- 入口：编辑区右上角常驻 -->
    <button
      class="ss__btn"
      :class="{ active: open }"
      title="调整正文与标题的样式（字号、字重、颜色、行高等）"
      @mousedown.prevent
      @click="toggle"
    >Aa</button>

    <transition name="drop">
      <div v-if="open" class="ss__panel" role="dialog" aria-label="正文与标题样式">
        <div class="ss__head">
          <span class="ss__head-title">正文与标题样式</span>
          <button class="ss__x" title="关闭（Esc）" @click="open = false">✕</button>
        </div>

        <div class="ss__body">
          <section
            v-for="key in BLOCK_KEYS"
            :key="key"
            class="ss-group"
          >
            <header class="ss-group__head">
              <span class="ss-group__name">{{ labels[key] }}</span>
              <button
                class="ss-group__reset"
                title="恢复该块默认样式"
                @click="resetBlock(key)"
              >重置</button>
            </header>

            <!-- 字号 -->
            <label class="ss-row">
              <span class="ss-row__label">字号</span>
              <input
                v-model.number="state[key].fontSize"
                class="ss-row__range"
                type="range"
                min="12"
                max="40"
                step="1"
              />
              <span class="ss-row__val">{{ state[key].fontSize }}px</span>
            </label>

            <!-- 字重 -->
            <label class="ss-row">
              <span class="ss-row__label">字重</span>
              <input
                v-model.number="state[key].fontWeight"
                class="ss-row__range"
                type="range"
                min="300"
                max="800"
                step="10"
              />
              <span class="ss-row__val">{{ state[key].fontWeight }}</span>
            </label>

            <!-- 行高 -->
            <label class="ss-row">
              <span class="ss-row__label">行高</span>
              <input
                v-model.number="state[key].lineHeight"
                class="ss-row__range"
                type="range"
                min="1.2"
                max="2.6"
                step="0.05"
              />
              <span class="ss-row__val">{{ state[key].lineHeight.toFixed(2) }}</span>
            </label>

            <!-- 颜色 -->
            <label class="ss-row">
              <span class="ss-row__label">颜色</span>
              <input
                v-model="state[key].color"
                class="ss-row__color"
                type="color"
              />
              <span class="ss-row__val ss-row__val--mono">{{ state[key].color }}</span>
            </label>

            <!-- 形态：斜体 / 下划线 / 删除线 -->
            <div class="ss-row ss-row--checks">
              <span class="ss-row__label">形态</span>
              <div class="ss-checks">
                <label class="ss-check">
                  <input v-model="state[key].italic" type="checkbox" />
                  <span>斜体</span>
                </label>
                <label class="ss-check">
                  <input v-model="state[key].underline" type="checkbox" />
                  <span>下划线</span>
                </label>
                <label class="ss-check">
                  <input v-model="state[key].strike" type="checkbox" />
                  <span>删除线</span>
                </label>
              </div>
            </div>

            <!-- 字间距 -->
            <label class="ss-row">
              <span class="ss-row__label">字间距</span>
              <input
                v-model.number="state[key].letterSpacing"
                class="ss-row__range"
                type="range"
                min="-0.05"
                max="0.2"
                step="0.005"
              />
              <span class="ss-row__val">{{ fmt(state[key].letterSpacing) }}em</span>
            </label>

            <!-- 对齐 -->
            <label class="ss-row">
              <span class="ss-row__label">对齐</span>
              <select v-model="state[key].align" class="ss-row__select">
                <option value="left">左对齐</option>
                <option value="center">居中</option>
                <option value="right">右对齐</option>
                <option value="justify">两端对齐</option>
              </select>
            </label>

            <!-- 仅正文：首行缩进 / 段间距 -->
            <template v-if="key === 'paragraph'">
              <label class="ss-row">
                <span class="ss-row__label">首行缩进</span>
                <input
                  v-model.number="state[key].textIndent"
                  class="ss-row__range"
                  type="range"
                  min="0"
                  max="3"
                  step="0.05"
                />
                <span class="ss-row__val">{{ fmt(state[key].textIndent) }}em</span>
              </label>
              <label class="ss-row">
                <span class="ss-row__label">段间距</span>
                <input
                  v-model.number="state[key].marginBottom"
                  class="ss-row__range"
                  type="range"
                  min="0"
                  max="30"
                  step="1"
                />
                <span class="ss-row__val">{{ state[key].marginBottom }}px</span>
              </label>
            </template>
          </section>
        </div>

        <footer class="ss__foot">
          <button class="ss__reset-all" @click="resetAll">恢复全部默认</button>
        </footer>
      </div>
    </transition>
  </div>
</template>

<style scoped>
.ss {
  position: absolute;
  top: 52px;
  right: 16px;
  z-index: 30;
}

.ss__btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 32px;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  background: var(--bg-canvas);
  color: var(--text-mid);
  font-family: var(--font-sans);
  font-size: 14px;
  font-weight: 600;
  letter-spacing: 0.02em;
  cursor: pointer;
  box-shadow: var(--shadow-pop);
  transition:
    background-color 0.14s ease,
    color 0.14s ease,
    border-color 0.14s ease;
}
.ss__btn:hover {
  background: var(--bg-hover);
  color: var(--text-strong);
}
.ss__btn.active {
  background: var(--accent-soft);
  border-color: var(--accent);
  color: var(--accent);
}

.ss__panel {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  width: 292px;
  display: flex;
  flex-direction: column;
  max-height: min(72vh, 620px);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--bg-canvas);
  box-shadow: var(--shadow-pop);
  overflow: hidden;
}

.ss__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  border-bottom: 1px solid var(--border);
}
.ss__head-title {
  font-size: 13.5px;
  font-weight: 600;
  color: var(--text-strong);
}
.ss__x {
  border: none;
  background: transparent;
  color: var(--text-faint);
  font-size: 12px;
  cursor: pointer;
  padding: 2px 6px;
  border-radius: 4px;
}
.ss__x:hover {
  background: var(--bg-hover);
  color: var(--text-strong);
}

.ss__body {
  overflow-y: auto;
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.ss-group {
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 8px 10px 6px;
}
.ss-group__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 4px;
}
.ss-group__name {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--text-strong);
}
.ss-group__reset {
  border: none;
  background: transparent;
  color: var(--text-faint);
  font-size: 11.5px;
  cursor: pointer;
  padding: 1px 4px;
  border-radius: 4px;
}
.ss-group__reset:hover {
  background: var(--bg-hover);
  color: var(--accent);
}

.ss-row {
  display: grid;
  grid-template-columns: 40px 1fr 58px;
  align-items: center;
  gap: 8px;
  padding: 3px 0;
}
.ss-row__label {
  font-size: 12px;
  color: var(--text-mid);
}
.ss-row__range {
  width: 100%;
  accent-color: var(--accent);
  cursor: pointer;
}
.ss-row__select {
  width: 100%;
  height: 24px;
  padding: 0 4px;
  border: 1px solid var(--border-strong);
  border-radius: 4px;
  background: var(--bg-canvas);
  color: var(--text-mid);
  font-size: 12px;
  cursor: pointer;
}
.ss-row--checks {
  grid-template-columns: 40px 1fr;
}
.ss-checks {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 10px;
}
.ss-check {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: var(--text-mid);
  cursor: pointer;
  user-select: none;
}
.ss-check input {
  accent-color: var(--accent);
  margin: 0;
}
.ss-row__color {
  width: 100%;
  height: 22px;
  padding: 0;
  border: 1px solid var(--border-strong);
  border-radius: 4px;
  background: transparent;
  cursor: pointer;
}
.ss-row__val {
  font-size: 11.5px;
  color: var(--text-mid);
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.ss-row__val--mono {
  font-family: var(--font-mono);
  font-size: 11px;
}

.ss__foot {
  padding: 8px 12px;
  border-top: 1px solid var(--border);
  display: flex;
  justify-content: flex-end;
}
.ss__reset-all {
  border: none;
  background: transparent;
  color: var(--text-faint);
  font-size: 12px;
  cursor: pointer;
}
.ss__reset-all:hover {
  color: var(--danger);
}

/* 面板弹出动画 */
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
</style>
