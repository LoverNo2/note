<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import Icon from "./Icon.vue";

/**
 * 顶部「表格」按钮 + 浮层：
 * - 光标不在表格里 → 输入行列数后插入
 * - 光标在表格里 → 增删行列 / 删除整张表格
 */
const props = defineProps<{
  /** 光标当前是否位于表格内（决定浮层显示“插入”还是“表格操作”） */
  inTable: boolean;
  /** 光标所在单元格的内容对齐（用于高亮当前项） */
  tableAlign: "left" | "center" | "right";
}>();

/** 单元格内容对齐选项 */
const ALIGN_OPTS: ReadonlyArray<{
  key: "left" | "center" | "right";
  label: string;
  title: string;
}> = [
  { key: "left", label: "左", title: "左对齐" },
  { key: "center", label: "居中", title: "居中对齐" },
  { key: "right", label: "右", title: "右对齐" },
];

const emit = defineEmits<{
  (e: "insert", rows: number, cols: number): void;
  (e: "row", where: "above" | "below"): void;
  (e: "col", where: "left" | "right"): void;
  (e: "delete-row"): void;
  (e: "delete-col"): void;
  (e: "delete-table"): void;
  (e: "align", align: "left" | "center" | "right"): void;
}>();

const MAX_ROWS = 30;
const MAX_COLS = 15;

const PANEL_WIDTH = 196;

const open = ref(false);
const rootEl = ref<HTMLElement | null>(null);
const btnEl = ref<HTMLElement | null>(null);
const panelPos = ref({ top: 0, left: 0 });
const rows = ref(3);
const cols = ref(3);
const error = ref("");

/** 浮层挂在按钮正下方：fmtbar 有 overflow-x:auto，绝对定位的浮层会被裁掉，
 *  所以用 position:fixed + 按钮的视口坐标定位 */
function placePanel(): void {
  const btn = btnEl.value;
  if (!btn) return;
  const r = btn.getBoundingClientRect();
  const margin = 8;
  let left = r.left;
  if (left + PANEL_WIDTH > window.innerWidth - margin) {
    left = Math.max(margin, window.innerWidth - margin - PANEL_WIDTH);
  }
  panelPos.value = { top: r.bottom + margin, left };
}

function toggle(): void {
  open.value = !open.value;
  if (open.value) {
    error.value = "";
    nextTick(placePanel);
  }
}

/** 页面滚动 / 改变窗口大小时直接收起，避免浮层与按钮脱节。
 *  浮层自身滚动（内容超出高度）要忽略，否则一滚就把浮层关掉。 */
function onScrollOrResize(e?: Event): void {
  if (!open.value) return;
  const target = e?.target;
  if (target instanceof Node && rootEl.value?.contains(target)) return;
  open.value = false;
}

function doInsert(): void {
  const r = Math.floor(Number(rows.value));
  const c = Math.floor(Number(cols.value));
  if (!Number.isFinite(r) || !Number.isFinite(c)) {
    error.value = "请输入数字";
    return;
  }
  if (r < 1 || c < 1) {
    error.value = "行列都要大于 0";
    return;
  }
  if (r > MAX_ROWS || c > MAX_COLS) {
    error.value = `最多 ${MAX_ROWS} 行 / ${MAX_COLS} 列`;
    return;
  }
  emit("insert", r, c);
  open.value = false;
}

/** 行/列数值增减（− / + 按钮）：不依赖输入框焦点，点击必定生效 */
function bump(which: 0 | 1, delta: number): void {
  if (which === 0) {
    rows.value = Math.max(1, Math.min(MAX_ROWS, Math.floor(Number(rows.value) || 1) + delta));
  } else {
    cols.value = Math.max(1, Math.min(MAX_COLS, Math.floor(Number(cols.value) || 1) + delta));
  }
  error.value = "";
}

function act(fn: () => void): void {
  fn();
  open.value = false;
}

function onDocPointerDown(e: PointerEvent): void {
  if (!open.value) return;
  const el = rootEl.value;
  if (el && e.target instanceof Node && !el.contains(e.target)) open.value = false;
}

function onKey(e: KeyboardEvent): void {
  if (e.key === "Escape") open.value = false;
}

onMounted(() => {
  document.addEventListener("pointerdown", onDocPointerDown);
  document.addEventListener("keydown", onKey);
  window.addEventListener("scroll", onScrollOrResize, true);
  window.addEventListener("resize", onScrollOrResize);
});
onBeforeUnmount(() => {
  document.removeEventListener("pointerdown", onDocPointerDown);
  document.removeEventListener("keydown", onKey);
  window.removeEventListener("scroll", onScrollOrResize, true);
  window.removeEventListener("resize", onScrollOrResize);
});
</script>

<template>
  <div ref="rootEl" class="tb">
    <button
      ref="btnEl"
      class="btn"
      :class="{ open }"
      :title="
        props.inTable
          ? '表格：增删行列 / 删除表格'
          : '插入表格（可指定行列数）'
      "
      @mousedown.prevent
      @click="toggle"
    >
      <Icon name="table" />
    </button>

    <transition name="tbpop">
      <div
        v-if="open"
        class="tb__panel"
        :style="{ top: `${panelPos.top}px`, left: `${panelPos.left}px` }"
        @mousedown.prevent
      >
        <template v-if="props.inTable">
          <p class="tb__group">当前表格 · 行</p>
          <button class="tb__opt" @click="act(() => emit('row', 'above'))">
            在上方插入行
          </button>
          <button class="tb__opt" @click="act(() => emit('row', 'below'))">
            在下方插入行
          </button>
          <button class="tb__opt" @click="act(() => emit('delete-row'))">
            删除当前行
          </button>

          <p class="tb__group tb__group--gap">当前表格 · 列</p>
          <button class="tb__opt" @click="act(() => emit('col', 'left'))">
            在左侧插入列
          </button>
          <button class="tb__opt" @click="act(() => emit('col', 'right'))">
            在右侧插入列
          </button>
          <button class="tb__opt" @click="act(() => emit('delete-col'))">
            删除当前列
          </button>

          <p class="tb__group tb__group--gap">对齐（选中多格可整批设置）</p>
          <div class="tb__align">
            <button
              v-for="opt in ALIGN_OPTS"
              :key="opt.key"
              class="tb__align-btn"
              :class="{ active: props.tableAlign === opt.key }"
              :title="opt.title"
              @click="emit('align', opt.key)"
            >
              {{ opt.label }}
            </button>
          </div>

          <span class="tb__sep"></span>
          <button
            class="tb__opt tb__opt--danger"
            @click="act(() => emit('delete-table'))"
          >
            删除整个表格
          </button>
        </template>

        <template v-else>
          <p class="tb__group">插入表格</p>
          <div class="tb__fields">
            <span class="tb__field-label">行</span>
            <div class="tb__stepper">
              <button
                class="tb__step"
                title="减少一行"
                @mousedown.prevent
                @click="bump(0, -1)"
              >
                −
              </button>
              <span class="tb__num" :title="`行数（当前 ${rows}）`">{{ rows }}</span>
              <button
                class="tb__step"
                title="增加一行"
                @mousedown.prevent
                @click="bump(0, 1)"
              >
                +
              </button>
            </div>
            <span class="tb__field-label">列</span>
            <div class="tb__stepper">
              <button
                class="tb__step"
                title="减少一列"
                @mousedown.prevent
                @click="bump(1, -1)"
              >
                −
              </button>
              <span class="tb__num" :title="`列数（当前 ${cols}）`">{{ cols }}</span>
              <button
                class="tb__step"
                title="增加一列"
                @mousedown.prevent
                @click="bump(1, 1)"
              >
                +
              </button>
            </div>
          </div>
          <p v-if="error" class="tb__err">{{ error }}</p>
          <button class="tb__opt tb__opt--primary" @click="doInsert">
            插入表格
          </button>
          <p class="tb__hint">首行作为表头（可在样式配置里改表头底色）</p>
        </template>
      </div>
    </transition>
  </div>
</template>

<style scoped>
.tb {
  position: relative;
  display: inline-flex;
}

/* 与工具条其它按钮完全一致的尺寸与质感
   （NoteToolbar 的 .btn 是 scoped 的，这里必须自带一份） */
.tb .btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  width: 33px;
  height: 30px;
  padding: 0;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-mid);
  cursor: pointer;
  transition:
    background-color 0.14s ease,
    color 0.14s ease,
    box-shadow 0.14s ease;
}
.tb .btn:hover:not(:active):not(.open) {
  background: rgba(255, 255, 255, 0.32);
  box-shadow: var(--neu-raise-sm);
  color: var(--text-strong);
}
.tb .btn.open {
  background: transparent;
  box-shadow: var(--neu-sink);
  color: var(--accent);
}

/* 浮层：新拟态卡片（fixed 定位，避免被 fmtbar 的 overflow 裁掉） */
.tb__panel {
  position: fixed;
  z-index: 200;
  width: 196px;
  max-height: 70vh;
  overflow-y: auto;
  padding: 10px 8px;
  border-radius: 14px;
  background: var(--bg-canvas);
  box-shadow: var(--shadow-pop);
}

.tb__group {
  margin: 0 0 6px;
  padding: 0 8px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.1em;
  color: var(--text-faint);
  user-select: none;
}
.tb__group--gap {
  margin-top: 12px;
}

.tb__opt {
  display: block;
  width: 100%;
  padding: 7px 10px;
  border: none;
  border-radius: 9px;
  background: transparent;
  color: var(--text-strong);
  font-family: inherit;
  font-size: 12.5px;
  text-align: left;
  cursor: pointer;
  box-shadow: none;
  transition:
    background-color 0.16s ease,
    color 0.16s ease,
    box-shadow 0.2s ease;
}
.tb__opt:hover:not(:active) {
  background: rgba(255, 255, 255, 0.55);
}
.tb__opt:active {
  box-shadow: var(--neu-sink-sm);
}
.tb__opt--primary {
  margin-top: 8px;
  text-align: center;
  font-weight: 600;
  background: rgba(255, 255, 255, 0.5);
  box-shadow: var(--neu-raise-sm);
}
.tb__opt--danger {
  color: #c0392b;
}
.tb__opt--danger:hover:not(:active) {
  background: rgba(192, 57, 43, 0.1);
}

.tb__align {
  display: flex;
  gap: 6px;
  padding: 0 8px;
}
.tb__align-btn {
  flex: 1;
  padding: 6px 0;
  border: none;
  border-radius: 8px;
  background: var(--bg-canvas);
  color: var(--text-mid);
  font-family: inherit;
  font-size: 12px;
  cursor: pointer;
  box-shadow: var(--neu-raise-sm);
  transition:
    background-color 0.16s ease,
    color 0.16s ease,
    box-shadow 0.2s ease;
}
.tb__align-btn:hover:not(:active):not(.active) {
  background: rgba(255, 255, 255, 0.5);
  color: var(--text-strong);
}
.tb__align-btn.active {
  box-shadow: var(--neu-sink-sm);
  color: var(--accent);
  font-weight: 600;
}

.tb__sep {
  display: block;
  height: 1px;
  margin: 8px 8px 6px;
  background: rgba(24, 26, 30, 0.09);
}

.tb__fields {
  display: grid;
  grid-template-columns: auto 1fr;
  align-items: center;
  gap: 6px 8px;
  padding: 2px 8px 0;
}
.tb__field-label {
  font-size: 11px;
  color: var(--text-faint);
  user-select: none;
}

/* 行/列：− 数字 + （三个部件一条） */
.tb__stepper {
  display: flex;
  align-items: center;
  gap: 4px;
}
.tb__step {
  flex: none;
  width: 22px;
  height: 24px;
  padding: 0;
  border: none;
  border-radius: 7px;
  background: var(--bg-canvas);
  color: var(--text-mid);
  font-family: inherit;
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
  box-shadow: var(--neu-raise-sm);
  transition:
    background-color 0.14s ease,
    color 0.14s ease,
    box-shadow 0.18s ease;
}
.tb__step:hover:not(:active) {
  background: rgba(255, 255, 255, 0.5);
  color: var(--text-strong);
}
.tb__step:active {
  box-shadow: var(--neu-sink-sm);
  color: var(--accent);
}
/* 行/列数值：只读展示，调整一律走两侧的 − / + 按钮 */
.tb__num {
  flex: 1;
  min-width: 0;
  padding: 6px 8px;
  border-radius: 8px;
  background: var(--bg-canvas);
  color: var(--text-strong);
  font-size: 12.5px;
  font-variant-numeric: tabular-nums;
  text-align: center;
  box-shadow: var(--neu-sink-sm);
  user-select: none;
  pointer-events: none;
}

.tb__err {
  margin: 8px 8px 0;
  font-size: 11.5px;
  color: #c0392b;
}
.tb__hint {
  margin: 8px 8px 0;
  font-size: 11px;
  line-height: 1.5;
  color: var(--text-faint);
}

.tbpop-enter-active,
.tbpop-leave-active {
  transition:
    opacity 0.16s ease,
    transform 0.16s ease;
}
.tbpop-enter-from,
.tbpop-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
</style>
