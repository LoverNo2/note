<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import {
  useNoteStyles,
  type TextBlockKey,
  type TextBlockStyle,
} from '../composables/useNoteStyles'
import { useToast } from '../composables/useToast'

const {
  state,
  defaults,
  resetBlock,
  resetAll,
} = useNoteStyles()
const { toast } = useToast()

/** 四种块（固定顺序渲染） */
const BLOCK_KEYS: TextBlockKey[] = ['paragraph', 'h1', 'h2', 'h3']

const open = ref(false)
const rootEl = ref<HTMLElement | null>(null)
/** 当前编辑的块（分段页签） */
const activeKey = ref<TextBlockKey>('paragraph')

/* ---------------- 单项目重置 ---------------- */

/** 该项当前值是否已偏离默认 */
function isDefault(key: TextBlockKey, field: keyof TextBlockStyle): boolean {
  const cur = state[key] as unknown as Record<string, unknown>
  const def = defaults[key] as unknown as Record<string, unknown>
  return cur[field] === def[field]
}

/** 恢复单个属性为默认值 */
function resetField(key: TextBlockKey, field: keyof TextBlockStyle): void {
  const cur = state[key] as unknown as Record<string, unknown>
  cur[field] = (defaults[key] as unknown as Record<string, unknown>)[field]
}

/** 形态行（斜体/下划线/删除线）是否全部为默认 */
function isShapesDefault(key: TextBlockKey): boolean {
  return (
    isDefault(key, 'italic') &&
    isDefault(key, 'underline') &&
    isDefault(key, 'strike')
  )
}

function resetShapes(key: TextBlockKey): void {
  resetField(key, 'italic')
  resetField(key, 'underline')
  resetField(key, 'strike')
}

/** 数值 → 紧凑显示，如 0.005 / -0.012 / 0.1 */
function fmt(v: number): string {
  return String(Math.round(v * 1000) / 1000)
}

/** range 的当前进度（用于填充色） */
function pct(min: number, max: number, v: number): string {
  const p = ((v - min) / (max - min)) * 100
  return `${Math.min(100, Math.max(0, p))}%`
}

/** 鼠标拖完滑块后主动失焦，避免控件残留焦点态 */
function blurRange(e: MouseEvent): void {
  ;(e.currentTarget as HTMLInputElement).blur()
}

/** 按下瞬间先失焦，让整个拖动过程不携带焦点指示 */
function blurRangeOnDown(e: PointerEvent): void {
  ;(e.currentTarget as HTMLInputElement).blur()
}

/** 页签短标签：正文 / H1 / H2 / H3 */
function tabLabel(key: TextBlockKey): string {
  return key === 'paragraph' ? '正文' : key.toUpperCase()
}

/* ---------------- 命名快照（保存 / 加载） ---------------- */

interface StyleSnapshot {
  name: string
  savedAt: string
  styles: Record<TextBlockKey, TextBlockStyle>
}

const SNAPSHOTS_KEY = 'notebook:textStyles:snapshots:v1'

/** 底部操作区当前展开的子面板：none=无，save=命名保存，load=选择加载 */
const snapMode = ref<'none' | 'save' | 'load'>('none')
const snapList = ref<StyleSnapshot[]>([])
const saveDraft = ref('')

function readSnapshots(): StyleSnapshot[] {
  try {
    const raw = localStorage.getItem(SNAPSHOTS_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as StyleSnapshot[]) : []
  } catch {
    return []
  }
}

function persistSnapshots(list: StyleSnapshot[]): void {
  try {
    localStorage.setItem(SNAPSHOTS_KEY, JSON.stringify(list))
  } catch {
    /* 忽略写入失败 */
  }
}

function closeSnap(): void {
  snapMode.value = 'none'
}

/** 点「保存样式」：打开命名输入（默认名不与现有重复） */
function openSave(): void {
  snapList.value = readSnapshots()
  const base = `样式 ${snapList.value.length + 1}`
  saveDraft.value = snapList.value.some((s) => s.name === base)
    ? `样式 ${snapList.value.length + 2}`
    : base
  snapMode.value = 'save'
}

/** 是否有同名配置（提示会被覆盖） */
function hasDupName(): boolean {
  const name = saveDraft.value.trim()
  return snapList.value.some((s) => s.name === name)
}

/** 确认保存（同名则覆盖） */
function commitSave(): void {
  const name = saveDraft.value.trim()
  if (!name) {
    toast('请输入配置名称', 'info')
    return
  }
  const snap: StyleSnapshot = {
    name,
    savedAt: new Date().toISOString(),
    styles: JSON.parse(JSON.stringify(state)) as Record<TextBlockKey, TextBlockStyle>,
  }
  const idx = snapList.value.findIndex((s) => s.name === name)
  if (idx >= 0) snapList.value[idx] = snap
  else snapList.value.unshift(snap)
  persistSnapshots(snapList.value)
  snapMode.value = 'none'
  toast(idx >= 0 ? `已更新配置「${name}」` : `已保存配置「${name}」`, 'success')
}

/** 点「加载样式」：展开配置列表 */
function openLoad(): void {
  snapList.value = readSnapshots()
  snapMode.value = 'load'
}

/** 应用某个配置（覆盖当前四块样式，自动持久化） */
function applySnapshot(snap: StyleSnapshot): void {
  for (const key of BLOCK_KEYS) {
    const st = snap.styles?.[key]
    if (st && typeof st === 'object') state[key] = { ...st }
  }
  snapMode.value = 'none'
  toast(`已加载配置「${snap.name}」`, 'success')
}

/** 删除某个配置 */
function removeSnapshot(name: string): void {
  snapList.value = snapList.value.filter((s) => s.name !== name)
  persistSnapshots(snapList.value)
}

function fmtTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })
  } catch {
    return ''
  }
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
  if (e.key !== 'Escape') return
  // 先退出命名/加载子面板，再关闭整个面板
  if (snapMode.value !== 'none') snapMode.value = 'none'
  else open.value = false
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
    <!-- 入口按钮（AppBar 右侧） -->
    <button
      class="ss__btn"
      :class="{ active: open }"
      title="调整正文与标题的样式"
      @mousedown.prevent
      @click="toggle"
    >
      <svg viewBox="0 0 24 24" class="ss__btn-ic" aria-hidden="true">
        <text
          x="12" y="13.2" text-anchor="middle" dominant-baseline="central"
          font-size="15" font-weight="600" fill="currentColor" stroke="none"
        >Aa</text>
      </svg>
    </button>

    <transition name="pop">
      <div v-if="open" class="ss__panel" role="dialog" aria-label="正文与标题样式">
        <!-- 头部 -->
        <header class="ss__head">
          <div class="ss__head-title">
            自定义正文与标题样式
          </div>
          <button class="ss__close" title="关闭（Esc）" @click="open = false">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </header>

        <!-- 块页签 -->
        <nav class="ss__tabs" role="tablist" aria-label="选择要配置的块">
          <button
            v-for="key in BLOCK_KEYS"
            :key="key"
            class="ss__tab"
            :class="{ active: key === activeKey }"
            role="tab"
            :aria-selected="key === activeKey"
            @click="activeKey = key"
          >{{ tabLabel(key) }}</button>
        </nav>

        <!-- 当前块配置 -->
        <div v-if="activeKey" class="ss__body">
          <!-- 字号 -->
          <div class="f-row">
            <span class="f-label">字号</span>
            <input
              v-model.number="state[activeKey].fontSize"
              class="range"
              type="range"
              min="12"
              max="40"
              step="1"
              :style="{ '--pct': pct(12, 40, state[activeKey].fontSize) }"
              @pointerdown="blurRangeOnDown"
              @mouseup="blurRange"
            />
            <span class="f-val">{{ state[activeKey].fontSize }}px</span>
            <button
              class="f-reset"
              :class="{ off: isDefault(activeKey, 'fontSize') }"
              title="恢复字号默认"
              @click="resetField(activeKey, 'fontSize')"
            >↺</button>
          </div>

          <!-- 字重 -->
          <div class="f-row">
            <span class="f-label">字重</span>
            <input
              v-model.number="state[activeKey].fontWeight"
              class="range"
              type="range"
              min="300"
              max="800"
              step="10"
              :style="{ '--pct': pct(300, 800, state[activeKey].fontWeight) }"
              @pointerdown="blurRangeOnDown"
              @mouseup="blurRange"
            />
            <span class="f-val">{{ state[activeKey].fontWeight }}</span>
            <button
              class="f-reset"
              :class="{ off: isDefault(activeKey, 'fontWeight') }"
              title="恢复字重默认"
              @click="resetField(activeKey, 'fontWeight')"
            >↺</button>
          </div>

          <!-- 行高 -->
          <div class="f-row">
            <span class="f-label">行高</span>
            <input
              v-model.number="state[activeKey].lineHeight"
              class="range"
              type="range"
              min="1.2"
              max="2.6"
              step="0.05"
              :style="{ '--pct': pct(1.2, 2.6, state[activeKey].lineHeight) }"
              @pointerdown="blurRangeOnDown"
              @mouseup="blurRange"
            />
            <span class="f-val">{{ state[activeKey].lineHeight.toFixed(2) }}</span>
            <button
              class="f-reset"
              :class="{ off: isDefault(activeKey, 'lineHeight') }"
              title="恢复行高默认"
              @click="resetField(activeKey, 'lineHeight')"
            >↺</button>
          </div>

          <!-- 颜色（保留 label，色条占满 label 右侧整行） -->
          <div class="f-row">
            <span class="f-label">颜色</span>
            <input
              v-model="state[activeKey].color"
              class="c-swatch"
              type="color"
              title="点击选择颜色"
            />
            <span class="f-val f-val--mono">{{ state[activeKey].color }}</span>
            <button
              class="f-reset"
              :class="{ off: isDefault(activeKey, 'color') }"
              title="恢复颜色默认"
              @click="resetField(activeKey, 'color')"
            >↺</button>
          </div>

          <!-- 形态：斜体 / 下划线 / 删除线 -->
          <div class="f-row">
            <span class="f-label">形态</span>
            <div class="f-switches">
              <label class="sw">
                <input v-model="state[activeKey].italic" type="checkbox" />
                <i class="sw__track"></i>
                <span>斜体</span>
              </label>
              <label class="sw">
                <input v-model="state[activeKey].underline" type="checkbox" />
                <i class="sw__track"></i>
                <span>下划线</span>
              </label>
              <label class="sw">
                <input v-model="state[activeKey].strike" type="checkbox" />
                <i class="sw__track"></i>
                <span>删除线</span>
              </label>
            </div>
            <span class="f-val f-val--empty"></span>
            <button
              class="f-reset"
              :class="{ off: isShapesDefault(activeKey) }"
              title="关闭斜体/下划线/删除线"
              @click="resetShapes(activeKey)"
            >↺</button>
          </div>

          <!-- 字间距 -->
          <div class="f-row">
            <span class="f-label">字间距</span>
            <input
              v-model.number="state[activeKey].letterSpacing"
              class="range"
              type="range"
              min="-0.05"
              max="0.2"
              step="0.005"
              :style="{ '--pct': pct(-0.05, 0.2, state[activeKey].letterSpacing) }"
              @pointerdown="blurRangeOnDown"
              @mouseup="blurRange"
            />
            <span class="f-val">{{ fmt(state[activeKey].letterSpacing) }}em</span>
            <button
              class="f-reset"
              :class="{ off: isDefault(activeKey, 'letterSpacing') }"
              title="恢复字间距默认"
              @click="resetField(activeKey, 'letterSpacing')"
            >↺</button>
          </div>

          <!-- 对齐 -->
          <div class="f-row">
            <span class="f-label">对齐</span>
            <select v-model="state[activeKey].align" class="f-select">
              <option value="left">左对齐</option>
              <option value="center">居中</option>
              <option value="right">右对齐</option>
              <option value="justify">两端对齐</option>
            </select>
            <span class="f-val f-val--empty"></span>
            <button
              class="f-reset"
              :class="{ off: isDefault(activeKey, 'align') }"
              title="恢复对齐默认"
              @click="resetField(activeKey, 'align')"
            >↺</button>
          </div>

          <!-- 仅正文：首行缩进 / 段间距 -->
          <template v-if="activeKey === 'paragraph'">
            <div class="f-row">
              <span class="f-label">首行缩进</span>
              <input
                v-model.number="state[activeKey].textIndent"
                class="range"
                type="range"
                min="0"
                max="3"
                step="0.05"
                :style="{ '--pct': pct(0, 3, state[activeKey].textIndent) }"
                @pointerdown="blurRangeOnDown"
                @mouseup="blurRange"
              />
              <span class="f-val">{{ fmt(state[activeKey].textIndent) }}em</span>
              <button
                class="f-reset"
                :class="{ off: isDefault(activeKey, 'textIndent') }"
                title="恢复首行缩进默认"
                @click="resetField(activeKey, 'textIndent')"
              >↺</button>
            </div>
            <div class="f-row">
              <span class="f-label">段间距</span>
              <input
                v-model.number="state[activeKey].marginBottom"
                class="range"
                type="range"
                min="0"
                max="30"
                step="1"
                :style="{ '--pct': pct(0, 30, state[activeKey].marginBottom) }"
                @pointerdown="blurRangeOnDown"
                @mouseup="blurRange"
              />
              <span class="f-val">{{ state[activeKey].marginBottom }}px</span>
              <button
                class="f-reset"
                :class="{ off: isDefault(activeKey, 'marginBottom') }"
                title="恢复段间距默认"
                @click="resetField(activeKey, 'marginBottom')"
              >↺</button>
            </div>
          </template>
        </div>

        <!-- 命名保存 / 配置列表（子面板） -->
        <div v-if="snapMode !== 'none'" class="ss__snap">
          <template v-if="snapMode === 'save'">
            <div class="ss__snap-head">
              <span class="ss__snap-title">保存为配置</span>
            </div>
            <div class="ss__snap-row">
              <input
                v-model="saveDraft"
                class="ss__snap-input"
                type="text"
                maxlength="24"
                placeholder="配置名称"
                spellcheck="false"
                @keydown.enter="commitSave"
              />
              <button
                class="ss__go"
                :disabled="!saveDraft.trim()"
                @click="commitSave"
              >保存</button>
              <button class="ss__go ss__go--ghost" @click="closeSnap">取消</button>
            </div>
            <p v-if="hasDupName()" class="ss__snap-warn">
              已有同名配置，保存将覆盖它
            </p>
          </template>

          <template v-else-if="snapMode === 'load'">
            <div class="ss__snap-head">
              <span class="ss__snap-title">选择要加载的配置</span>
              <button class="ss__go ss__go--ghost" @click="closeSnap">取消</button>
            </div>
            <ul v-if="snapList.length > 0" class="ss__snap-list">
              <li
                v-for="s in snapList"
                :key="s.savedAt + s.name"
                class="ss__snap-item"
              >
                <button
                  class="ss__snap-pick"
                  title="应用该配置"
                  @click="applySnapshot(s)"
                >
                  <span class="ss__snap-name">{{ s.name }}</span>
                  <span class="ss__snap-time">{{ fmtTime(s.savedAt) }}</span>
                </button>
                <button
                  class="ss__snap-del"
                  title="删除该配置"
                  @click.stop="removeSnapshot(s.name)"
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M6 6l12 12M18 6L6 18" />
                  </svg>
                </button>
              </li>
            </ul>
            <p v-else class="ss__snap-empty">
              还没有保存过的配置<br />点「保存样式」创建一个
            </p>
          </template>
        </div>

        <!-- 底部操作 -->
        <footer class="ss__foot">
          <button class="ss__action" title="把当前四种块的样式存为一份命名配置" @click="openSave">保存样式</button>
          <button class="ss__action" title="选择并加载一份保存过的配置" @click="openLoad">加载样式</button>
          <span class="ss__spacer"></span>
          <button class="ss__reset" @click="resetBlock(activeKey)">重置此项</button>
          <button class="ss__reset ss__reset--danger" @click="resetAll">全部默认</button>
        </footer>
      </div>
    </transition>
  </div>
</template>

<style scoped>
/* ============ 入口按钮（位于 AppBar 右侧） ============ */
.ss {
  position: relative;
  z-index: 60;
  display: flex;
}
.ss__btn {
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
  transition: background-color 0.15s ease, color 0.15s ease, box-shadow 0.15s ease;
}
.ss__btn:hover {
  background: rgba(255, 255, 255, 0.35);
  color: var(--text-strong);
}
.ss__btn.active {
  background: transparent;
  box-shadow: var(--neu-sink);
  color: var(--accent);
}
.ss__btn-ic {
  width: 18px;
  height: 18px;
}
.ss__btn-ic text {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
}

/* ============ 面板 ============ */
.ss__panel {
  position: absolute;
  top: calc(100% + 12px);
  right: 0;
  width: 350px;
  max-height: min(78vh, 660px);
  display: flex;
  flex-direction: column;
  border: none;
  border-radius: 18px;
  background: var(--bg-canvas);
  box-shadow: var(--shadow-pop);
  overflow: hidden;
}

/* ---------- 头部 ---------- */
.ss__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 13px 14px 11px;
}
.ss__head-title {
  display: flex;
  flex-direction: column;
  gap: 1px;
  font-size: 14px;
  font-weight: 650;
  color: var(--text-strong);
}
.ss__head-sub {
  font-size: 11px;
  font-weight: 400;
  color: var(--text-faint);
}
.ss__close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border: none;
  border-radius: 7px;
  background: transparent;
  color: var(--text-faint);
  cursor: pointer;
  transition: background-color 0.14s ease, color 0.14s ease;
}
.ss__close:hover {
  background: rgba(255, 255, 255, 0.35);
  color: var(--text-strong);
}
.ss__close svg {
  width: 15px;
  height: 15px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.8;
  stroke-linecap: round;
}

/* ---------- 块页签 ---------- */
.ss__tabs {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 2px;
  padding: 0 12px;
  background: var(--bg-sidebar);
  box-shadow: inset 0 1px 3px rgba(24, 26, 30, 0.08);
}
.ss__tab {
  height: 30px;
  border: none;
  background: transparent;
  color: var(--text-mid);
  font-size: 12.5px;
  cursor: pointer;
  position: relative;
  transition: color 0.14s ease;
}
.ss__tab:hover {
  color: var(--text-strong);
}
.ss__tab.active {
  color: var(--accent);
  font-weight: 600;
}
.ss__tab.active::after {
  content: '';
  position: absolute;
  left: 14%;
  right: 14%;
  bottom: 0;
  height: 2px;
  border-radius: 2px 2px 0 0;
  background: var(--accent);
}

/* ---------- 配置区 ---------- */
.ss__body {
  overflow-y: auto;
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 11px;
}

.f-row {
  display: grid;
  grid-template-columns: 52px minmax(0, 1fr) auto 18px;
  align-items: center;
  gap: 8px;
  min-height: 24px;
}
.f-label {
  font-size: 12px;
  color: var(--text-mid);
}
.f-val {
  min-width: 46px;
  padding: 2px 7px;
  border-radius: 7px;
  background: var(--bg-sidebar);
  box-shadow: var(--neu-sink-sm);
  font-size: 11px;
  color: var(--text-mid);
  text-align: center;
  font-variant-numeric: tabular-nums;
  box-sizing: border-box;
}
.f-val--mono {
  font-family: var(--font-mono);
}
.f-val--empty {
  min-width: 0;
  background: transparent;
  padding: 0;
}

/* 单项恢复默认（↺），偏离默认时可用；为默认时隐藏占位 */
.f-reset {
  width: 18px;
  height: 18px;
  border: none;
  border-radius: 5px;
  background: transparent;
  color: var(--text-faint);
  font-size: 13px;
  line-height: 1;
  cursor: pointer;
  transition: background-color 0.14s ease, color 0.14s ease;
}
.f-reset:hover {
  background: var(--bg-hover);
  color: var(--accent);
}
.f-reset.off {
  visibility: hidden;
  pointer-events: none;
}

/* ---------- 滑块（自绘轨道 + 圆钮） ---------- */
.range {
  -webkit-appearance: none;
  appearance: none;
  width: 100%;
  height: 16px;
  margin: 0;
  background: transparent;
  cursor: pointer;
  caret-color: transparent;
}
.range:focus {
  outline: none;
}
.range::-webkit-slider-runnable-track {
  height: 6px;
  border-radius: 4px;
  background: linear-gradient(
    90deg,
    var(--accent) 0 var(--pct),
    rgba(24, 26, 30, 0.14) var(--pct) 100%
  );
  box-shadow: inset 0 1px 2px rgba(24, 26, 30, 0.16);
}
.range::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  margin-top: -4.5px;
  width: 15px;
  height: 15px;
  border-radius: 50%;
  background: #fff;
  border: none;
  box-shadow: var(--neu-raise-sm);
  transition: transform 0.12s ease, box-shadow 0.12s ease;
}
.range::-webkit-slider-thumb:hover {
  transform: scale(1.15);
  box-shadow: var(--neu-raise);
}
.range::-moz-range-track {
  height: 6px;
  border-radius: 4px;
  background: rgba(24, 26, 30, 0.14);
}
.range::-moz-range-progress {
  height: 6px;
  border-radius: 4px;
  background: var(--accent);
}
.range::-moz-range-thumb {
  width: 13px;
  height: 13px;
  border-radius: 50%;
  background: #fff;
  border: none;
  box-shadow: 0 2px 4px rgba(24, 26, 30, 0.3);
}

/* ---------- 取色（色块铺满 label 与 hex 之间整段） ---------- */
.c-swatch {
  -webkit-appearance: none;
  appearance: none;
  width: 100%;
  min-width: 0;
  height: 26px;
  padding: 0;
  border: 1px solid var(--border-strong);
  border-radius: 8px;
  background: #fff;
  cursor: pointer;
  transition: border-color 0.14s ease;
}
.c-swatch:hover {
  border-color: var(--accent);
}
.c-swatch::-webkit-color-swatch-wrapper {
  padding: 0;
}
.c-swatch::-webkit-color-swatch {
  border: none;
  border-radius: 7px;
}
.c-swatch::-moz-color-swatch {
  border: none;
  border-radius: 7px;
}

/* ---------- 开关 ---------- */
.f-switches {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 12px;
}
.sw {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11.5px;
  color: var(--text-mid);
  cursor: pointer;
  user-select: none;
}
.sw input {
  display: none;
}
.sw__track {
  position: relative;
  width: 28px;
  height: 17px;
  border-radius: 9px;
  background: rgba(24, 26, 30, 0.16);
  box-shadow: inset 0 1px 2px rgba(24, 26, 30, 0.22);
  transition: background-color 0.16s ease, box-shadow 0.16s ease;
}
.sw__track::after {
  content: '';
  position: absolute;
  top: 2px;
  left: 2px;
  width: 13px;
  height: 13px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 3px rgba(24, 26, 30, 0.3);
  transition: transform 0.16s ease;
}
.sw input:checked + .sw__track {
  background: var(--accent);
  box-shadow: none;
}
.sw input:checked + .sw__track::after {
  transform: translateX(11px);
}

/* ---------- 下拉 ---------- */
.f-select {
  width: 100%;
  height: 28px;
  padding: 0 8px;
  border: none;
  border-radius: 8px;
  background: var(--bg-sidebar);
  box-shadow: var(--neu-sink-sm);
  color: var(--text-mid);
  font-size: 12px;
  cursor: pointer;
  outline: none;
  transition: background-color 0.14s ease, color 0.14s ease, box-shadow 0.14s ease;
}
.f-select:hover {
  background: rgba(255, 255, 255, 0.3);
  box-shadow: var(--neu-raise-sm);
  color: var(--text-strong);
}

/* ---------- 命名快照子面板 ---------- */
.ss__snap {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 12px;
  border: none;
  background: var(--bg-soft);
}
.ss__snap-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.ss__snap-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-strong);
}
.ss__snap-row {
  display: flex;
  gap: 6px;
}
.ss__snap-input {
  flex: 1;
  min-width: 0;
  height: 28px;
  padding: 0 8px;
  border: none;
  border-radius: 8px;
  background: var(--bg-sidebar);
  box-shadow: var(--neu-sink-sm);
  color: var(--text-strong);
  font-size: 12px;
  outline: none;
  transition: background-color 0.14s ease, box-shadow 0.14s ease;
}
.ss__snap-input:focus {
  background: rgba(255, 255, 255, 0.4);
  box-shadow: var(--neu-sink), 0 0 0 2px var(--accent-soft);
}
.ss__go {
  height: 28px;
  padding: 0 12px;
  border: none;
  border-radius: 9px;
  background: linear-gradient(180deg, #3771f0, var(--accent));
  color: #fff;
  font-size: 12px;
  cursor: pointer;
  white-space: nowrap;
  box-shadow: 3px 3px 8px rgba(37, 99, 235, 0.32), -2px -2px 5px rgba(255, 255, 255, 0.65);
  transition: background-color 0.14s ease, opacity 0.14s ease, box-shadow 0.14s ease;
}
.ss__go:hover {
  background: var(--accent-hover);
}
.ss__go:disabled {
  opacity: 0.45;
  cursor: default;
}
.ss__go--ghost {
  background: var(--bg-canvas);
  color: var(--text-mid);
  border: none;
  box-shadow: var(--neu-raise-sm);
}
.ss__go--ghost:hover {
  background: rgba(255, 255, 255, 0.35);
  color: var(--text-strong);
  box-shadow: var(--neu-raise);
}
.ss__snap-warn {
  margin: 0;
  font-size: 11px;
  color: var(--danger);
}
.ss__snap-list {
  margin: 0;
  padding: 0;
  list-style: none;
  max-height: 160px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.ss__snap-item {
  display: flex;
  align-items: center;
  gap: 4px;
  border-radius: 8px;
  transition: background-color 0.12s ease;
}
.ss__snap-item:hover {
  background: var(--bg-hover);
}
.ss__snap-pick {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 4px 6px 8px;
  border: none;
  background: transparent;
  cursor: pointer;
  text-align: left;
}
.ss__snap-name {
  font-size: 12.5px;
  color: var(--text-strong);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ss__snap-time {
  font-size: 10.5px;
  color: var(--text-faint);
  flex: none;
  font-variant-numeric: tabular-nums;
}
.ss__snap-del {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--text-faint);
  cursor: pointer;
  transition: background-color 0.12s ease, color 0.12s ease;
}
.ss__snap-del:hover {
  background: var(--danger-soft);
  color: var(--danger);
}
.ss__snap-del svg {
  width: 11px;
  height: 11px;
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
}
.ss__snap-empty {
  margin: 0;
  padding: 6px 0;
  font-size: 12px;
  line-height: 1.7;
  text-align: center;
  color: var(--text-faint);
}

/* ---------- 底部 ---------- */
.ss__foot {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 8px 10px;
  border-top: 1px solid var(--border);
  background: var(--bg-soft);
}
.ss__spacer {
  flex: 1;
}
.ss__action,
.ss__reset {
  border: none;
  background: transparent;
  font-size: 11.5px;
  cursor: pointer;
  padding: 4px 7px;
  border-radius: 6px;
  white-space: nowrap;
  transition: background-color 0.14s ease, color 0.14s ease;
}
.ss__action {
  color: var(--accent);
  font-weight: 550;
}
.ss__action:hover {
  background: var(--accent-soft);
}
.ss__reset {
  color: var(--text-mid);
}
.ss__reset:hover {
  background: var(--bg-hover);
  color: var(--text-strong);
}
.ss__reset--danger:hover {
  background: var(--danger-soft);
  color: var(--danger);
}

/* ---------- 弹出动画 ---------- */
.pop-enter-active,
.pop-leave-active {
  transition:
    opacity 0.16s ease,
    transform 0.16s cubic-bezier(0.2, 0.9, 0.3, 1.15);
  transform-origin: top right;
}
.pop-enter-from,
.pop-leave-to {
  opacity: 0;
  transform: translateY(-6px) scale(0.98);
}
</style>
