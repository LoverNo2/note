<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
} from "vue";
import {
  useNoteStyles,
  type TextBlockKey,
  type TextBlockStyle,
} from "../composables/useNoteStyles";
import { useToast } from "../composables/useToast";

const { state, defaults } = useNoteStyles();
const { toast } = useToast();

/** 四种块（固定顺序渲染） */
const BLOCK_KEYS: TextBlockKey[] = ["paragraph", "h1", "h2", "h3"];

/** 对齐方式（图标分段按钮） */
const ALIGN_OPTS: ReadonlyArray<{
  value: TextBlockStyle["align"];
  label: string;
  d: readonly string[];
}> = [
  { value: "left", label: "左对齐", d: ["M2 4h16", "M2 9h7", "M2 14h10"] },
  { value: "center", label: "居中", d: ["M5 4h10", "M2 9h16", "M6 14h8"] },
  { value: "right", label: "右对齐", d: ["M8 4h10", "M3 9h15", "M6 14h12"] },
  {
    value: "justify",
    label: "两端对齐",
    d: ["M2 3h16", "M2 8h16", "M2 13h16", "M6 18h8"],
  },
];

/** 形态（可多选的分段切换） */
const SHAPE_OPTS: ReadonlyArray<{
  key: "italic" | "underline" | "strike";
  label: string;
  glyph: string;
  glyphClass: string;
}> = [
  {
    key: "italic",
    label: "斜体",
    glyph: "I",
    glyphClass: "seg-glyph--italic",
  },
  {
    key: "underline",
    label: "下划线",
    glyph: "U",
    glyphClass: "seg-glyph--under",
  },
  {
    key: "strike",
    label: "删除线",
    glyph: "S",
    glyphClass: "seg-glyph--strike",
  },
];

function toggleShape(key: "italic" | "underline" | "strike"): void {
  state[activeKey.value][key] = !state[activeKey.value][key];
}

const open = ref(false);
const rootEl = ref<HTMLElement | null>(null);
/** 当前编辑的块（分段页签） */
const activeKey = ref<TextBlockKey>("paragraph");

/* ---------------- 单项目撤销（相对最近一次保存） ---------------- */

/** 当前激活自定义样式的最近一次保存记录 */
function savedSnapOfActive(): StyleSnapshot | undefined {
  const name = customActive.value;
  if (!name) return undefined;
  return snapList.value.find((s) => s.name === name);
}

/** 该项当前值是否与最近保存一致（一致则隐藏单项 ↺ 图标） */
function isSavedEqual(
  key: TextBlockKey,
  field: keyof TextBlockStyle,
): boolean {
  const saved = savedSnapOfActive()?.styles?.[key] as
    | Record<string, unknown>
    | undefined;
  if (!saved) return true;
  const cur = state[key] as unknown as Record<string, unknown>;
  return cur[field] === saved[field];
}

/** 撤销单项改动：恢复为最近一次保存的值 */
function resetFieldToSaved(
  key: TextBlockKey,
  field: keyof TextBlockStyle,
): void {
  const saved = savedSnapOfActive()?.styles?.[key] as
    | Record<string, unknown>
    | undefined;
  if (!saved || saved[field] === undefined) return;
  (state[key] as unknown as Record<string, unknown>)[field] = saved[field];
}

/** 形态行（斜体/下划线/删除线）是否与最近保存一致 */
function isShapesSavedEqual(key: TextBlockKey): boolean {
  return (
    isSavedEqual(key, "italic") &&
    isSavedEqual(key, "underline") &&
    isSavedEqual(key, "strike")
  );
}

/** 撤销形态行改动：恢复为最近保存的三项开关 */
function resetShapesToSaved(key: TextBlockKey): void {
  resetFieldToSaved(key, "italic");
  resetFieldToSaved(key, "underline");
  resetFieldToSaved(key, "strike");
}

/** 数值 → 紧凑显示，如 0.005 / -0.012 / 0.1 */
function fmt(v: number): string {
  return String(Math.round(v * 1000) / 1000);
}

/** range 的当前进度（用于填充色） */
function pct(min: number, max: number, v: number): string {
  const p = ((v - min) / (max - min)) * 100;
  return `${Math.min(100, Math.max(0, p))}%`;
}

/** 鼠标拖完滑块后主动失焦，避免控件残留焦点态 */
function blurRange(e: MouseEvent): void {
  (e.currentTarget as HTMLInputElement).blur();
}

/** 按下瞬间先失焦，让整个拖动过程不携带焦点指示 */
function blurRangeOnDown(e: PointerEvent): void {
  (e.currentTarget as HTMLInputElement).blur();
}

/** 页签短标签：正文 / H1 / H2 / H3 */
function tabLabel(key: TextBlockKey): string {
  return key === "paragraph" ? "正文" : key.toUpperCase();
}

/* ---------------- 命名样式（快照持久化） ---------------- */

interface StyleSnapshot {
  name: string;
  savedAt: string;
  styles: Record<TextBlockKey, TextBlockStyle>;
}

const SNAPSHOTS_KEY = "notebook:textStyles:snapshots:v1";
const snapList = ref<StyleSnapshot[]>([]);

function readSnapshots(): StyleSnapshot[] {
  try {
    const raw = localStorage.getItem(SNAPSHOTS_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as StyleSnapshot[]) : [];
  } catch {
    return [];
  }
}

function persistSnapshots(list: StyleSnapshot[]): void {
  try {
    localStorage.setItem(SNAPSHOTS_KEY, JSON.stringify(list));
  } catch {
    /* 忽略写入失败 */
  }
}

/** 深拷贝当前四块样式（用于保存 / 比较脏状态） */
function cloneState(): Record<TextBlockKey, TextBlockStyle> {
  const out = {} as Record<TextBlockKey, TextBlockStyle>;
  for (const key of BLOCK_KEYS) out[key] = { ...state[key] };
  return out;
}

/** 把某份样式配置套用到当前 state（缺项回退到系统默认） */
function restoreState(
  src?: Record<TextBlockKey, TextBlockStyle>,
): void {
  for (const key of BLOCK_KEYS) {
    state[key] = { ...(src?.[key] ?? defaults[key]) };
  }
}

/** 保存/更新一份配置到列表，返回是否同名覆盖 */
function upsertSnap(name: string): boolean {
  const snap: StyleSnapshot = {
    name,
    savedAt: new Date().toISOString(),
    styles: cloneState(),
  };
  const idx = snapList.value.findIndex((s) => s.name === name);
  if (idx >= 0) snapList.value[idx] = snap;
  else snapList.value.unshift(snap);
  persistSnapshots(snapList.value);
  return idx >= 0;
}

/* ---------------- 激活的样式配置 ---------------- */

/** null = 系统默认样式（只读）；否则为当前自定义样式名 */
const customActive = ref<string | null>(null);
/** 是否正在“新建命名中”：选择框位置显示名称输入框 */
const naming = ref(false);
const nameDraft = ref("");
const nameInputEl = ref<HTMLInputElement | null>(null);
const pickerOpen = ref(false);
const deletingName = ref<string | null>(null);

/** 默认样式为只读（配置区锁定） */
const lockedDefault = computed(() => customActive.value === null);
/** 当前自定义配置相对最近一次保存是否有未保存修改 */
const dirty = computed(() => {
  const name = customActive.value;
  if (!name) return false;
  const snap = snapList.value.find((s) => s.name === name);
  if (!snap) return false;
  return JSON.stringify(snap.styles) !== JSON.stringify(cloneState());
});

function togglePicker(): void {
  if (pickerOpen.value) {
    pickerOpen.value = false;
    return;
  }
  snapList.value = readSnapshots();
  deletingName.value = null;
  pickerOpen.value = true;
}

/** 切回系统默认样式（不可修改） */
function applyDefaultStyle(): void {
  naming.value = false;
  customActive.value = null;
  restoreState(defaults);
  pickerOpen.value = false;
  deletingName.value = null;
  toast("已切换到默认样式", "success");
}

/** 切换到某个自定义配置（丢弃当前未保存修改） */
function applySnapshot(snap: StyleSnapshot): void {
  naming.value = false;
  customActive.value = snap.name;
  restoreState(snap.styles);
  pickerOpen.value = false;
  deletingName.value = null;
  toast(`已切换到「${snap.name}」`, "success");
}

function requestDeleteStyle(name: string): void {
  deletingName.value = deletingName.value === name ? null : name;
}

/** 删除配置；若删除的是当前激活项则回到默认样式 */
function confirmDeleteStyle(snap: StyleSnapshot): void {
  removeSnapshot(snap.name);
  if (customActive.value === snap.name) {
    customActive.value = null;
    naming.value = false;
    restoreState(defaults);
  }
  deletingName.value = null;
  toast(`已删除配置「${snap.name}」`, "success");
}

/** 点下拉底部「新增样式」：立即以默认值进入新样式，并就地命名 */
function createNewStyle(): void {
  pickerOpen.value = false;
  deletingName.value = null;
  restoreState(defaults);
  naming.value = true;
  customActive.value = null;
  nameDraft.value = "";
  toast("为新样式输入名称并回车，取消请按 Esc", "info");
  nextTick(() => nameInputEl.value?.focus());
}

/** 命名未完成前取消新建（丢弃） */
function cancelNaming(): void {
  if (!naming.value) return;
  naming.value = false;
  nameDraft.value = "";
  customActive.value = null;
  restoreState(defaults);
}

/** 在名称输入框回车：保存命名并激活该样式 */
function commitNaming(): void {
  const name = nameDraft.value.trim();
  if (!name) {
    toast("请输入样式名称", "info");
    nextTick(() => nameInputEl.value?.focus());
    return;
  }
  const overwrite = upsertSnap(name);
  naming.value = false;
  customActive.value = name;
  toast(overwrite ? `已更新「${name}」` : `已新建样式「${name}」`, "success");
}

/** 头部「保存」：把当前样式存为最近一次保存 */
function saveCurrent(): void {
  const name = customActive.value;
  if (!name || naming.value) return;
  upsertSnap(name);
  toast(`已保存「${name}」`, "success");
}

/** 头部「重置」：回到该样式上次保存的状态 */
function resetCurrent(): void {
  const name = customActive.value;
  if (!name || naming.value) return;
  const snap = snapList.value.find((s) => s.name === name);
  if (!snap) return;
  restoreState(snap.styles);
  toast(`已回到「${name}」上次保存的状态`, "success");
}

/** 删除某个配置 */
function removeSnapshot(name: string): void {
  snapList.value = snapList.value.filter((s) => s.name !== name);
  persistSnapshots(snapList.value);
}

function fmtTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  } catch {
    return "";
  }
}

function toggle(): void {
  open.value = !open.value;
}

function onDocPointerdown(e: PointerEvent): void {
  const root = rootEl.value;
  const target = e.target as Node;
  if (root && !root.contains(target)) {
    // 点击样式设置之外：命名中的新建视为失败，并收起整个面板
    if (naming.value) cancelNaming();
    open.value = false;
    pickerOpen.value = false;
    return;
  }
  const elTarget = e.target as Element;
  // 命名保存之前点击其它任何地方 = 新建失败
  if (naming.value && !elTarget.closest(".ss__name-input")) {
    cancelNaming();
    return;
  }
  // 面板内点到了样式选择下拉之外：收起下拉
  if (pickerOpen.value && !elTarget.closest(".ss__picker")) {
    pickerOpen.value = false;
  }
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key !== "Escape") return;
  // 依次收起：命名新建 → 样式下拉 → 整个面板
  if (naming.value) cancelNaming();
  else if (pickerOpen.value) pickerOpen.value = false;
  else open.value = false;
}

/* 刷新/重新打开后：默认激活第一个已保存的自定义样式（若有），否则为系统默认 */
const storedInit = readSnapshots();
snapList.value = storedInit;
if (storedInit.length > 0) {
  restoreState(storedInit[0].styles);
  customActive.value = storedInit[0].name;
}

onMounted(() => {
  document.addEventListener("pointerdown", onDocPointerdown);
  window.addEventListener("keydown", onKeydown);
});
onBeforeUnmount(() => {
  document.removeEventListener("pointerdown", onDocPointerdown);
  window.removeEventListener("keydown", onKeydown);
});
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
          x="12"
          y="13.2"
          text-anchor="middle"
          dominant-baseline="central"
          font-size="15"
          font-weight="600"
          fill="currentColor"
          stroke="none"
        >
          Aa
        </text>
      </svg>
    </button>

    <transition name="pop">
      <div
        v-if="open"
        class="ss__panel"
        role="dialog"
        aria-label="正文与标题样式"
      >
        <!-- 头部：样式选择 + 重置（替代原标题，关闭按钮保留在右） -->
        <header class="ss__head">
          <div class="ss__head-tools">
            <div class="ss__picker">
              <button
                v-if="!naming"
                class="ss__trigger"
                :class="{ open: pickerOpen }"
                title="选择 / 管理样式配置"
                @click.stop="togglePicker"
              >
                <span class="ss__trigger-label">{{ customActive ?? "默认样式" }}</span>
              </button>
              <input
                v-else
                ref="nameInputEl"
                v-model="nameDraft"
                class="ss__name-input"
                type="text"
                maxlength="24"
                placeholder="样式名称，回车保存"
                spellcheck="false"
                autocomplete="off"
                @keydown.enter.prevent="commitNaming"
                @keydown.esc.prevent="cancelNaming"
              />

              <transition name="ssdrop">
                <div v-if="pickerOpen" class="ss__picker-panel" @click.stop>
                  <div
                    class="ss__popt"
                    :class="{ active: !customActive }"
                    @click="applyDefaultStyle"
                  >
                    <span class="ss__popt-name">默认样式</span>
                  </div>

                  <template v-if="snapList.length > 0">
                    <div
                      v-for="s in snapList"
                      :key="s.savedAt + s.name"
                      class="ss__popt"
                      :class="{ active: customActive === s.name }"
                    >
                      <span
                        class="ss__popt-main"
                        :title="`加载「${s.name}」`"
                        @click="applySnapshot(s)"
                      >
                        <span class="ss__popt-name">{{ s.name }}</span>
                        <span class="ss__popt-time">{{
                          fmtTime(s.savedAt)
                        }}</span>
                      </span>

                      <span
                        v-if="deletingName === s.name"
                        class="ss__popt-ops"
                      >
                        <button
                          class="ss__mini danger"
                          @click="confirmDeleteStyle(s)"
                        >
                          删除
                        </button>
                        <button class="ss__mini" @click="deletingName = null">
                          取消
                        </button>
                      </span>
                      <button
                        v-else
                        class="ss__mini ss__popt-del"
                        :title="`删除配置「${s.name}」`"
                        @click.stop="requestDeleteStyle(s.name)"
                      >
                        删除
                      </button>
                    </div>
                  </template>
                  <div
                    class="ss__popt ss__popt-new"
                    title="把当前四种块的样式存为一份新的命名配置"
                    @click="createNewStyle"
                  >
                    <span class="ss__popt-name">新增样式</span>
                  </div>
                </div>
              </transition>
            </div>

            <template v-if="customActive && !naming">
              <button
                class="ss__save"
                :disabled="!dirty"
                title="保存当前样式（之后可随时重置回此状态）"
                @click="saveCurrent"
              >
                保存
              </button>
              <button
                class="ss__reset"
                title="放弃未保存的修改，回到上次保存的状态"
                @click="resetCurrent"
              >
                重置
              </button>
            </template>
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
          >
            {{ tabLabel(key) }}
          </button>
        </nav>

        <!-- 当前块配置 -->
        <p v-if="lockedDefault || naming" class="ss__lock-hint">
          {{
            naming
              ? "输入样式名称并回车后即可开始编辑；回车前点击其它位置将放弃新建"
              : "默认样式仅供查看，新建或选择自定义样式后即可编辑"
          }}
        </p>
        <fieldset
          v-if="activeKey"
          class="ss__body"
          :disabled="lockedDefault || naming"
        >
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
              :class="{ off: isSavedEqual(activeKey, 'fontSize') }"
              title="恢复字号默认"
              @click="resetFieldToSaved(activeKey, 'fontSize')"
            >
              ↺
            </button>
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
              :class="{ off: isSavedEqual(activeKey, 'fontWeight') }"
              title="恢复字重默认"
              @click="resetFieldToSaved(activeKey, 'fontWeight')"
            >
              ↺
            </button>
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
            <span class="f-val">{{
              state[activeKey].lineHeight.toFixed(2)
            }}</span>
            <button
              class="f-reset"
              :class="{ off: isSavedEqual(activeKey, 'lineHeight') }"
              title="恢复行高默认"
              @click="resetFieldToSaved(activeKey, 'lineHeight')"
            >
              ↺
            </button>
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
              :class="{ off: isSavedEqual(activeKey, 'color') }"
              title="恢复颜色默认"
              @click="resetFieldToSaved(activeKey, 'color')"
            >
              ↺
            </button>
          </div>

          <!-- 形态：斜体 / 下划线 / 删除线（可多选） -->
          <div class="f-row">
            <span class="f-label">形态</span>
            <div
              class="seg seg--3"
              role="group"
              aria-label="文字形态（可多选）"
            >
              <button
                v-for="shape in SHAPE_OPTS"
                :key="shape.key"
                type="button"
                class="seg__btn"
                :class="{ active: state[activeKey][shape.key] }"
                :title="shape.label"
                @click="toggleShape(shape.key)"
              >
                <span class="seg-glyph" :class="shape.glyphClass">{{
                  shape.glyph
                }}</span>
              </button>
            </div>
            <span class="f-val f-val--empty"></span>
            <button
              class="f-reset"
              :class="{ off: isShapesSavedEqual(activeKey) }"
              title="关闭斜体/下划线/删除线"
              @click="resetShapesToSaved(activeKey)"
            >
              ↺
            </button>
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
              :style="{
                '--pct': pct(-0.05, 0.2, state[activeKey].letterSpacing),
              }"
              @pointerdown="blurRangeOnDown"
              @mouseup="blurRange"
            />
            <span class="f-val"
              >{{ fmt(state[activeKey].letterSpacing) }}em</span
            >
            <button
              class="f-reset"
              :class="{ off: isSavedEqual(activeKey, 'letterSpacing') }"
              title="恢复字间距默认"
              @click="resetFieldToSaved(activeKey, 'letterSpacing')"
            >
              ↺
            </button>
          </div>

          <!-- 对齐 -->
          <div class="f-row">
            <span class="f-label">对齐</span>
            <div class="seg" role="radiogroup" aria-label="对齐方式">
              <button
                v-for="opt in ALIGN_OPTS"
                :key="opt.value"
                type="button"
                class="seg__btn"
                :class="{ active: state[activeKey].align === opt.value }"
                :title="opt.label"
                @click="state[activeKey].align = opt.value"
              >
                <svg class="seg__ic" viewBox="0 0 20 20" aria-hidden="true">
                  <path v-for="d in opt.d" :key="d" :d="d" />
                </svg>
              </button>
            </div>
            <span class="f-val f-val--empty"></span>
            <button
              class="f-reset"
              :class="{ off: isSavedEqual(activeKey, 'align') }"
              title="恢复对齐默认"
              @click="resetFieldToSaved(activeKey, 'align')"
            >
              ↺
            </button>
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
              <span class="f-val"
                >{{ fmt(state[activeKey].textIndent) }}em</span
              >
              <button
                class="f-reset"
                :class="{ off: isSavedEqual(activeKey, 'textIndent') }"
                title="恢复首行缩进默认"
                @click="resetFieldToSaved(activeKey, 'textIndent')"
              >
                ↺
              </button>
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
                :class="{ off: isSavedEqual(activeKey, 'marginBottom') }"
                title="恢复段间距默认"
                @click="resetFieldToSaved(activeKey, 'marginBottom')"
              >
                ↺
              </button>
            </div>
          </template>
        </fieldset>
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
  transition:
    background-color 0.15s ease,
    color 0.15s ease,
    box-shadow 0.15s ease;
}
.ss__btn:hover:not(:active):not(.active) {
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
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif;
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
.ss__head-tools {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 0;
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
  transition:
    background-color 0.14s ease,
    color 0.14s ease;
}
.ss__close:hover:not(:active) {
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

/* ---------- 块页签（无背景容器，按钮各自为新拟态胶囊） ---------- */
.ss__tabs {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 6px;
  padding: 4px 14px 12px;
  background: transparent;
}
.ss__tab {
  height: 30px;
  border: none;
  border-radius: 9px;
  background: var(--bg-canvas);
  color: var(--text-mid);
  font-size: 12.5px;
  cursor: pointer;
  box-shadow: var(--neu-raise-sm);
  transition:
    background-color 0.14s ease,
    color 0.14s ease,
    box-shadow 0.14s ease;
}
.ss__tab:hover:not(:active):not(.active) {
  background: rgba(255, 255, 255, 0.35);
  color: var(--text-strong);
}
.ss__tab:active {
  box-shadow: var(--neu-sink-sm);
}
.ss__tab.active {
  background: transparent;
  color: var(--accent);
  font-weight: 600;
  box-shadow: var(--neu-sink-sm);
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
  transition:
    background-color 0.14s ease,
    color 0.14s ease;
}
.f-reset:hover:not(:active) {
  background: var(--bg-hover);
  color: var(--accent);
}
.f-reset.off {
  visibility: hidden;
  pointer-events: none;
}

/* ---------- 滑块（灰圆底轨 + 独立圆头蓝色进度层；Firefox 用原生 progress） ---------- */
.range {
  -webkit-appearance: none;
  appearance: none;
  position: relative;
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
.range::before {
  content: "";
  position: absolute;
  left: 0;
  top: 50%;
  transform: translateY(-50%);
  width: var(--pct, 0%);
  height: 6px;
  border-radius: 999px;
  background: var(--accent);
  pointer-events: none;
}
.range::-webkit-slider-runnable-track {
  height: 6px;
  border-radius: 999px;
  background: rgba(24, 26, 30, 0.14);
  box-shadow: inset 0 1px 2px rgba(24, 26, 30, 0.16);
}
.range::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 0;
  height: 0;
  border: none;
  background: transparent;
  box-shadow: none;
}
.range::-moz-range-track {
  height: 6px;
  border-radius: 999px;
  background: rgba(24, 26, 30, 0.14);
}
.range::-moz-range-progress {
  height: 6px;
  border-radius: 999px;
  background: var(--accent);
}
.range::-moz-range-thumb {
  width: 0;
  height: 0;
  border: none;
  background: transparent;
  box-shadow: none;
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
.c-swatch:hover:not(:active) {
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

/* ---------- 分段按钮扩展（多列 / 字形） ---------- */
.seg--3 {
  grid-template-columns: repeat(3, 1fr);
}
.seg-glyph {
  font-size: 15px;
  line-height: 1;
  user-select: none;
}
.seg-glyph--italic {
  font-style: italic;
  font-family: Georgia, "Times New Roman", serif;
}
.seg-glyph--under {
  text-decoration: underline;
  text-underline-offset: 2px;
}
.seg-glyph--strike {
  text-decoration: line-through;
}

/* ---------- 对齐分段按钮 ---------- */
.seg {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 4px;
  width: 100%;
}
.seg__btn {
  height: 28px;
  border: none;
  border-radius: 8px;
  background: var(--bg-canvas);
  color: var(--text-mid);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  box-shadow: var(--neu-raise-sm);
  transition:
    background-color 0.14s ease,
    color 0.14s ease,
    box-shadow 0.14s ease;
}
.seg__btn:hover:not(:active):not(.active) {
  background: rgba(255, 255, 255, 0.35);
  color: var(--text-strong);
}
.seg__btn:active {
  box-shadow: var(--neu-sink-sm);
}
.seg__btn.active {
  background: transparent;
  color: var(--accent);
  box-shadow: var(--neu-sink-sm);
}
.seg__ic {
  width: 15px;
  height: 15px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.8;
  stroke-linecap: round;
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
  transition:
    background-color 0.14s ease,
    box-shadow 0.14s ease;
}
.ss__snap-input:focus {
  background: rgba(255, 255, 255, 0.4);
  box-shadow:
    var(--neu-sink),
    0 0 0 2px var(--accent-soft);
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
  box-shadow:
    3px 3px 8px rgba(37, 99, 235, 0.32),
    -2px -2px 5px rgba(255, 255, 255, 0.65);
  transition:
    background-color 0.14s ease,
    opacity 0.14s ease,
    box-shadow 0.14s ease;
}
.ss__go:hover:not(:active):not(:disabled) {
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
.ss__go--ghost:hover:not(:active) {
  background: rgba(255, 255, 255, 0.35);
  color: var(--text-strong);
  box-shadow: var(--neu-raise);
}
.ss__snap-warn {
  margin: 0;
  font-size: 11px;
  color: var(--danger);
}

/* ---------- 样式选择下拉（视觉对齐笔记切换 picker） ---------- */
.ss__picker {
  position: relative;
  flex: 0 1 auto;
  min-width: 120px;
  max-width: 320px;
}
.ss__trigger {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
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
    color 0.14s ease,
    box-shadow 0.14s ease;
}
.ss__trigger:hover:not(:active):not(.open) {
  background: rgba(255, 255, 255, 0.3);
}
.ss__trigger.open {
  box-shadow: var(--neu-sink-sm);
  color: var(--accent);
}
.ss__trigger-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: left;
}
.ss__picker-panel {
  position: absolute;
  top: calc(100% + 10px);
  left: 0;
  z-index: 62;
  width: 300px;
  max-width: calc(100vw - 32px);
  padding: 6px;
  border-radius: 12px;
  background: var(--bg-canvas);
  box-shadow: var(--shadow-pop);
  max-height: 42vh;
  overflow-y: auto;
}
.ssdrop-enter-active,
.ssdrop-leave-active {
  transition:
    opacity 0.14s ease,
    transform 0.14s ease;
}
.ssdrop-enter-from,
.ssdrop-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
.ss__popt {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px 8px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: background-color 0.12s ease;
}
.ss__popt + .ss__popt {
  margin-top: 6px;
}
.ss__popt:hover:not(:active):not(.active) {
  background: var(--bg-hover);
}
.ss__popt.active {
  background: var(--bg-active);
}
.ss__popt-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.ss__popt-name {
  font-size: 13.5px;
  font-weight: 550;
  color: var(--text-strong);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ss__popt-time {
  font-size: 11px;
  color: var(--text-faint);
  font-variant-numeric: tabular-nums;
}
.ss__mini {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 7px;
  font-size: 12px;
  padding: 3px 9px;
  cursor: pointer;
  background: var(--bg-canvas);
  color: var(--text-mid);
  box-shadow: var(--neu-raise-sm);
  transition:
    background-color 0.15s ease,
    color 0.15s ease,
    box-shadow 0.15s ease;
}
.ss__mini:hover:not(:active) {
  background: rgba(255, 255, 255, 0.3);
  color: var(--text-strong);
}
.ss__mini.danger {
  background: var(--danger-soft);
  color: var(--danger);
  box-shadow: none;
}
.ss__mini.danger:hover:not(:active) {
  background: rgba(211, 61, 61, 0.16);
}
.ss__popt-del {
  opacity: 0;
}
.ss__popt:hover:not(.active) .ss__popt-del,
.ss__popt:focus-within .ss__popt-del {
  opacity: 1;
}
.ss__popt-ops {
  display: inline-flex;
  gap: 4px;
  flex: none;
}
.ss__popt-new {
  color: var(--accent);
  font-weight: 600;
}

.ss__reset {
  border: none;
  background: var(--bg-canvas);
  color: var(--text-mid);
  font-size: 11.5px;
  cursor: pointer;
  padding: 6px 12px;
  border-radius: 8px;
  white-space: nowrap;
  box-shadow: var(--neu-raise-sm);
  transition:
    background-color 0.14s ease,
    color 0.14s ease,
    box-shadow 0.14s ease;
}
.ss__reset {
  color: var(--text-mid);
}
.ss__reset:hover:not(:active) {
  background: rgba(255, 255, 255, 0.3);
  color: var(--text-strong);
}
.ss__reset:active {
  box-shadow: var(--neu-sink-sm);
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

/* ---------- 内联命名输入（替换下拉触发按钮） ---------- */
.ss__name-input {
  box-sizing: border-box;
  width: 100%;
  height: 28px;
  padding: 0 6px 0 12px;
  border: none;
  border-radius: var(--radius-md);
  background: var(--bg-canvas);
  color: var(--text-strong);
  font-size: 13.5px;
  font-family: inherit;
  outline: none;
  box-shadow: var(--neu-sink-sm);
}
.ss__name-input::placeholder {
  color: var(--text-faint);
}

/* ---------- 头部「保存」按钮（与重置同规格，强调色） ---------- */
.ss__save {
  border: none;
  background: var(--bg-canvas);
  color: var(--accent);
  font-size: 11.5px;
  font-weight: 600;
  cursor: pointer;
  padding: 6px 12px;
  border-radius: 8px;
  white-space: nowrap;
  box-shadow: var(--neu-raise-sm);
  transition:
    background-color 0.14s ease,
    color 0.14s ease,
    box-shadow 0.14s ease;
}
.ss__save:hover:not(:active):not(:disabled) {
  background: rgba(255, 255, 255, 0.3);
  color: var(--accent);
}
.ss__save:active:not(:disabled) {
  box-shadow: var(--neu-sink-sm);
}
.ss__save:disabled {
  color: var(--text-faint);
  opacity: 0.55;
  cursor: default;
  box-shadow: none;
}

/* ---------- 配置区（fieldset）：只读锁定态 ---------- */
.ss__body {
  border: 0;
  margin: 0;
  min-inline-size: 0;
}
.ss__body:disabled {
  opacity: 0.55;
}
.ss__lock-hint {
  margin: 0;
  padding: 2px 14px 10px;
  font-size: 11px;
  color: var(--text-faint);
}

/* ---------- 按钮按压态 / 常态平滑切换（统一） ---------- */
.ss__btn,
.ss__close,
.ss__tab,
.f-reset,
.seg__btn,
.ss__go,
.ss__go--ghost,
.ss__trigger,
.ss__mini,
.ss__save,
.ss__reset,
.ss__popt {
  transition:
    background-color 0.18s ease,
    color 0.18s ease,
    box-shadow 0.22s ease,
    opacity 0.2s ease;
}
</style>
