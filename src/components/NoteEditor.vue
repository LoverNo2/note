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
import NoteOutline from "./NoteOutline.vue";
import { bgToCss, useNoteStyles } from "../composables/useNoteStyles";
import type { BlockKind, InlineMark, ToolbarUi } from "../editor/blocks";
import { highlightCodeBlocks, isBlockHighlighted } from "../editor/highlight";
import { formatJavaScript, formatJavaScriptWithRepair } from "../editor/prettierFormat";

/** 去掉代码高亮标记（复制出去的内容保持纯代码） */
function unwrapTokenSpans(root: HTMLElement): void {
  for (const el of Array.from(root.querySelectorAll("span.token"))) {
    const parent = el.parentNode;
    if (!parent) continue;
    while (el.firstChild) parent.insertBefore(el.firstChild, el);
    el.remove();
  }
}
import {
  caretAnchor,
  caretTextIndex,
  codeExitOnArrowDown,
  codeTextToBrDom,
  currentBlockKind,
  deleteFirstEmptyParagraph,
  editorHasContent,
  emptyToolbarUi,
  ensureStartParagraph,
  flattenPreElement,
  focusEditorStart,
  codeBlockText,
  formatCodeText,
  setCodeBlockText,
  getCaretRange,
  healStrayTopLevelText,
  handleEnterKey,
  handleTabKey,
  insertCellLineBreak,
  insertCodeNewline,
  isInsideEditor,
  isMarkActive,
  pasteTextInto,
  paragraphsOnSelection,
  resolveBlock,
  restoreCaretAnchor,
  type CaretAnchor,
  setBlockType,
  setTableCellsAlign,
  deleteTableAt,
  deleteTableColumnAt,
  deleteTableRowAt,
  insertTable,
  insertTableColumnAt,
  insertTableRowAt,
  tableContext,
  tableIndex,
  tableSelectedCells,
  tableEnterNext,
  tableMoveCell,
  tidyBlock,
  toggleCodeComment,
  toggleInlineMark,
  unwrapHighlightSpans,
  unwrapTypographySpans,
  wrapTypographySpans,
} from "../editor/blocks";
import {
  legacyTextToHtml,
  looksLikeHtml,
  normalizeHtml,
  sanitizeHtml,
  textFromHtml,
  trimLineEndSpaces,
} from "../editor/html";
import { useNotes } from "../composables/useNotes";
import { useToast } from "../composables/useToast";

const { currentNote, dirty, markDirty, markEdited } = useNotes();
const { toast } = useToast();
/** 正文与标题的可视化样式（CSS 变量实时注入 .note-content） */
const { cssVars, tableVars, codeStyleClass, state: textStyles } = useNoteStyles();

/** 各块（标签名 → 最终底色 CSS 颜色）映射；全透明时为 'transparent'，不会包裹 */
const bgByTag = computed<Record<string, string>>(() => {
  const css = (k: keyof typeof textStyles) =>
    bgToCss(textStyles[k].bg, textStyles[k].bgAlpha);
  return {
    P: css("paragraph"),
    H1: css("h1"),
    H2: css("h2"),
    H3: css("h3"),
    H4: css("h4"),
    H5: css("h5"),
    LI: css("paragraph"),
  };
});

const titleInput = ref<HTMLInputElement | null>(null);
const contentEl = ref<HTMLDivElement | null>(null);
const pageContentEl = ref<HTMLDivElement | null>(null);
/** 目录树显隐（默认显示） */
const outlineOpen = ref(true);

function toggleOutline(): void {
  outlineOpen.value = !outlineOpen.value;
}

const ui = reactive<ToolbarUi>(emptyToolbarUi());

/* ================= 左侧目录树 ================= */

interface OutlineEntry {
  level: number;
  text: string;
  el: HTMLElement;
}

const outlineEntries = ref<OutlineEntry[]>([]);
const outlineItems = computed(() =>
  outlineEntries.value.map((e) => ({ level: e.level, text: e.text })),
);
const outlineActive = ref(0);

/** 从编辑器内容（H1-H5）重建目录 */
function refreshOutline(): void {
  const el = contentEl.value;
  if (!el) return;
  const entries: OutlineEntry[] = [];
  for (const child of Array.from(el.children) as HTMLElement[]) {
    const m = /^H([1-5])$/.exec(child.tagName);
    if (!m) continue;
    entries.push({
      level: Number(m[1]),
      text: (child.textContent ?? "").trim() || "未命名标题",
      el: child,
    });
  }
  outlineEntries.value = entries;
  updateOutlineActive();
}

let outlineTimer: number | undefined;
function scheduleOutline(): void {
  window.clearTimeout(outlineTimer);
  window.clearTimeout(highlightTimer);
  outlineTimer = window.setTimeout(refreshOutline, 250);
}

/** 点击目录：滚动到对应标题（不抢焦点） */
function jumpToHeading(index: number): void {
  const entry = outlineEntries.value[index];
  if (!entry) return;
  entry.el.scrollIntoView({ block: "start", behavior: "smooth" });
  outlineActive.value = index;
}

/** 滚动时高亮当前可视区的标题 */
function updateOutlineActive(): void {
  const scroller = pageContentEl.value;
  const entries = outlineEntries.value;
  if (!scroller || entries.length === 0) {
    outlineActive.value = 0;
    return;
  }
  const top = scroller.getBoundingClientRect().top;
  let active = 0;
  entries.forEach((e, i) => {
    if (e.el.getBoundingClientRect().top - top <= 16) active = i;
  });
  outlineActive.value = active;
}

function onPageScroll(): void {
  updateOutlineActive();
}

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
  markDirty();
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
  /** 光标锚点（块序号 + 块内偏移），null 表示快照时无法定位 */
  caret: CaretAnchor | null;
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
  hist.stack.push({ html, caret: caretAnchor(el) });
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
  if (item.caret) restoreCaretAnchor(el, item.caret);
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
/** 输入法组合中（此时不重排 DOM，避免打断中文候选词） */
let composing = false;
function onCompositionStart(): void {
  composing = true;
}
function onCompositionEnd(): void {
  composing = false;
  scheduleSync();
}

/** 组件卸载时 currentNote 可能已指向下一条笔记；只在装载的这条笔记上写回 */
const mountedNoteId: string | null = currentNote.value?.id ?? null;

function normalizeEditorHtml(el: HTMLElement): string {
  return normalizeHtml(el.innerHTML);
}

/** 遍历整理所有块：代码块结构拍平、清外来样式、去行尾多余 br/空白
 *  （行尾空白清理会避开光标所在位置，不影响正在输入的内容） */
function tidyEditorDom(el: HTMLElement): void {
  for (const child of Array.from(el.children)) {
    const tag = child.tagName;
    if (tag === "HR") continue;
    if (tag === "PRE") {
      // 编辑期不动代码块（重写文本会打乱光标）；仅在光标不在其中、
      // 且浏览器塞进了块级元素时才拍平（历史脏数据由加载时清理）
      const pre = child as HTMLElement;
      const sel = window.getSelection();
      const caretInside = !!sel?.anchorNode && pre.contains(sel.anchorNode);
      // 注意：高亮用的 span.token 是正常渲染标记，不算“脏结构”，
      // 否则光标离开的代码块会被拍平成纯文本（表现为高亮掉色）
      if (!caretInside && pre.querySelector("p,div,span:not(.token)")) {
        flattenPreElement(pre);
      }
      continue;
    }
    if (tag === "UL" || tag === "OL") {
      for (const li of Array.from(child.querySelectorAll("li"))) {
        tidyBlock(li as HTMLElement, true);
      }
      continue;
    }
    tidyBlock(child as HTMLElement, true);
  }
}

function syncNoteFromDom(): void {
  const note = currentNote.value;
  const el = contentEl.value;
  if (!note || !el) return;
  if (note.id !== mountedNoteId) return; // 卸载期防止把旧 DOM 写进新笔记
  tidyEditorDom(el); // 清理粘贴/合并留下的样式与行尾占位 br
  const html = normalizeEditorHtml(el); // 读取时会剥离中文包裹标记，存储保持干净
  suppressContentWatch = true;
  if (note.content !== html) note.content = html;
  suppressContentWatch = false;
  // 重排中文包裹（只影响渲染层字距，不改变文本），并保持光标位置。
  // 输入法组合期间不动 DOM，避免打断候选词。
  if (!composing) {
    const caret = caretAnchor(el);
    wrapTypographySpans(el, bgByTag.value);
    if (caret) restoreCaretAnchor(el, caret);
  }
  markEdited();
  updateEmptyClass();
  scheduleHighlightPending(); // 粘贴/撤销/增删块之后补齐漏色
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
  // 既有内容迁移：清掉行尾多余空白（只在加载时做，不影响实时输入）
  html = trimLineEndSpaces(html);
  if (!html) html = "<p><br></p>";

  el.innerHTML = html;
  // 代码块内的换行在编辑期用 <br> 表示（光标行为才可靠），存储仍是换行符
  codeTextToBrDom(el);
  wrapTypographySpans(el, bgByTag.value); // 中文字距 + 英文间隔 + 行内底色（只作用于渲染标记）
  highlightCodeBlocks(el); // 代码块语法高亮（只作用于渲染标记）
  suppressContentWatch = true;
  if (note.content !== html) note.content = html;
  suppressContentWatch = false;

  updateEmptyClass();
  snapshotCurrent();
  refreshUi();
  refreshOutline();
  scheduleHighlightPending(); // 兜底：把任何漏色的代码块补齐
}

/** 输入防抖：停顿后同步数据 + 记一次快照 */
/** 代码高亮：输入停顿后只重排光标所在的代码块 */
let highlightTimer = 0;
function scheduleHighlight(): void {
  window.clearTimeout(highlightTimer);
  highlightTimer = window.setTimeout(() => {
    const el = contentEl.value;
    if (!el || composing) return;
    const block = resolveBlock(el);
    if (!block || block.tagName !== "PRE") {
      scheduleHighlightPending(); // 光标不在代码块里，也把漏色的块补上
      return;
    }
    const caret = caretAnchor(el);
    highlightCodeBlocks(el, block);
    if (caret) restoreCaretAnchor(el, caret);
    scheduleHighlightPending(); // 顺带补齐别的漏色块
  }, 350);
}

/**
 * 补漏：把“有内容却还没着色”的代码块补上高亮。
 * 输入时的即时高亮只处理光标所在块，新增/粘贴/撤销产生的其它块可能一直是灰的，
 * 这里在安静下来后统一补齐（跳过光标所在块，避免干扰正在输入的地方）。
 */
let highlightPendingTimer: number | undefined;
let highlightPendingToken = 0;

function scheduleHighlightPending(delay = 400): void {
  window.clearTimeout(highlightPendingTimer);
  const token = ++highlightPendingToken;
  highlightPendingTimer = window.setTimeout(() => {
    if (token !== highlightPendingToken) return;
    const el = contentEl.value;
    if (!el || composing) return;
    const pending = Array.from(el.querySelectorAll("pre")).filter(
      (pre) =>
        (pre.textContent ?? "").trim() !== "" &&
        !isBlockHighlighted(pre as HTMLElement),
    );
    if (!pending.length) return;
    const caret = caretAnchor(el);
    for (const pre of pending) highlightCodeBlocks(el, pre as HTMLElement);
    if (caret) restoreCaretAnchor(el, caret);
  }, delay);
}

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
    const prevCaret = caretAnchor(el);
    if (import.meta.env?.DEV) {
      console.info("[editor] reload note content, caret:", prevCaret);
    }
    el.innerHTML = incoming || "<p><br></p>";
    codeTextToBrDom(el);
    if (prevCaret) restoreCaretAnchor(el, prevCaret);
    updateEmptyClass();
    snapshotCurrent();
    refreshUi();
    refreshOutline();
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
  const marks = [
    "bold",
    "italic",
    "underline",
    "strike",
    "inlineCode",
  ] as const;
  for (const m of marks) {
    ui.marks[m] = isMarkActive(el, m);
  }
  ui.collapsed = !hasTextSelection(el);
  ui.inCode = ui.kind === "codeblock";
  ui.inList = ui.kind === "bulletList" || ui.kind === "orderedList";
  const tctx = tableContext(el);
  ui.inTable = tctx !== null;
  if (tctx) {
    lastTableCtx = { table: tctx.table, row: tctx.rowIndex, col: tctx.colIndex };
    ui.tableAlign = tctx.align;
    rememberTableSelection();
  }
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
  "underline",
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
    case "paragraph": {
      // 有选中区域时：把选区内触碰到的块全部强制转成正文段落
      if (paragraphsOnSelection(el)) {
        afterDomChange();
        return;
      }
      setBlockType(el, "paragraph");
      break;
    }
    case "h1":
    case "h2":
    case "h3":
    case "h4":
    case "h5":
    case "codeblock":
    case "bulletList":
    case "orderedList":
      setBlockType(el, action as BlockKind);
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
  scheduleOutline();
}

/**
 * 保存前整理代码块格式（⌘S / 点保存时触发）：
 * 行首 Tab → 4 空格、去掉行尾分号、连续 3 行以上空行折成 1 行。
 * 内容被重建后重新高亮，并用锚点把光标放回原处。
 */
/**
 * 保存前整理代码块格式：
 * - JavaScript（能被 babel 解析）交给 Prettier（4 空格缩进、不写行尾分号、按 120 列折行）；
 * - 其它语言/语法不合法时退回简单规则（Tab→4 空格、去行尾分号、折叠多余空行）。
 */
async function formatCodeOnSave(): Promise<void> {
  const el = contentEl.value;
  if (!el) return;
  const caret = caretAnchor(el);
  let changed = false;
  for (const pre of Array.from(el.querySelectorAll("pre")) as HTMLElement[]) {
    const text = codeBlockText(pre);
    if (!text.trim()) continue;
    // 先直接交给 Prettier；整段因“缺分号”类错误解析不了时，按报错位置补分号重试
    let pretty = await formatJavaScript(text);
    if (pretty === null) pretty = await formatJavaScriptWithRepair(text);
    const next = pretty ?? formatCodeText(text);
    if (next === text) continue;
    setCodeBlockText(pre, next);
    changed = true;
  }
  if (!changed) return;
  highlightCodeBlocks(el);
  if (caret) restoreCaretAnchor(el, caret);
  syncNoteFromDom();
}

/* ================= 表格 ================= */

/** 最近一次“光标在表格内”的位置：点击工具条按钮会让编辑器失焦、光标可能丢失，
 *  行列增删据此定位，保证按钮点击始终生效 */
let lastTableCtx: { table: HTMLTableElement; row: number; col: number } | null = null;
let lastTableSel: { table: HTMLTableElement; cells: { row: number; col: number }[] } | null = null;

/** 记住“最近一次跨多格的选区”：点按钮后 DOM 重排会让选区失效，
 *  退化成单格光标，因此多格选区必须单独记着。 */
function rememberTableSelection(): void {
  const el = contentEl.value;
  if (!el) return;
  const sel = tableSelectedCells(el);
  if (sel && sel.cells.length > 1) lastTableSel = sel;
}

/** 用户在编辑器里开始新的一次选择动作 → 作废旧的“多格记忆” */
function onEditorPointerDown(): void {
  lastTableSel = null;
}

/** 方向键改选之后重新评估多格选区（键盘选择也要能更新/作废记忆） */
function onEditorKeyUp(e: KeyboardEvent): void {
  if (e.key.startsWith("Arrow") || e.key === "Shift") {
    const el = contentEl.value;
    const sel = el ? tableSelectedCells(el) : null;
    lastTableSel = sel && sel.cells.length > 1 ? sel : null;
  }
  refreshUi();
}

/** 对齐要作用的单元格：多格记忆优先（它代表用户最近一次明确的多格选择），
 *  没有多格记忆时用实时选区，最后才退化到单格记忆 */
function alignTargetCells() {
  const el = contentEl.value;
  if (!el) return null;
  const live = tableSelectedCells(el);
  const remembered =
    lastTableSel && lastTableSel.table.isConnected ? lastTableSel : null;
  if (remembered && remembered.cells.length > 1) return remembered;
  return live ?? remembered;
}

function currentTableContext() {
  const el = contentEl.value;
  if (!el) return null;
  const live = tableContext(el);
  if (live) {
    lastTableCtx = { table: live.table, row: live.rowIndex, col: live.colIndex };
    return live;
  }
  if (lastTableCtx && lastTableCtx.table.isConnected) {
    const restored = tableIndex(lastTableCtx.table, lastTableCtx.row, lastTableCtx.col);
    if (restored) {
      lastTableCtx = { table: restored.table, row: restored.rowIndex, col: restored.colIndex };
      return restored;
    }
  }
  return null;
}

function insertNewTable(rows: number, cols: number): void {
  const el = contentEl.value;
  if (!el) return;
  if (!insertTable(el, rows, cols)) return;
  lastTableCtx = null; // 新表格：下一次 refreshUi 会重新记录
  afterDomChange();
  toast(`已插入 ${rows} × ${cols} 表格`);
}

function tableRowAction(where: "above" | "below"): void {
  const ctx = currentTableContext();
  if (!ctx) return;
  if (!insertTableRowAt(ctx, where)) return;
  afterDomChange();
  toast(where === "above" ? "已在上方插入行" : "已在下方插入行");
}

function tableColumnAction(where: "left" | "right"): void {
  const ctx = currentTableContext();
  if (!ctx) return;
  if (!insertTableColumnAt(ctx, where)) return;
  afterDomChange();
  toast(where === "left" ? "已在左侧插入列" : "已在右侧插入列");
}

function tableDeleteRow(): void {
  const ctx = currentTableContext();
  if (!ctx) return;
  const onlyRow = ctx.table.querySelectorAll("tr").length <= 1;
  if (!deleteTableRowAt(ctx)) return;
  lastTableCtx = null;
  afterDomChange();
  toast(onlyRow ? "表格已删除" : "已删除该行");
}

function tableDeleteCol(): void {
  const ctx = currentTableContext();
  if (!ctx) return;
  const onlyCol = ctx.table.querySelector("tr")!.children.length <= 1;
  if (!deleteTableColumnAt(ctx)) return;
  lastTableCtx = null;
  afterDomChange();
  toast(onlyCol ? "表格已删除" : "已删除该列");
}

function tableAlignAction(align: "left" | "center" | "right"): void {
  const el = contentEl.value;
  if (!el) return;
  const target = alignTargetCells();
  if (!target) return;
  if (!setTableCellsAlign(target.table, target.cells, align)) return;
  refreshUi();
  afterDomChange();
  toast(align === "center" ? "已居中" : align === "right" ? "已右对齐" : "已左对齐");
}

function tableDelete(): void {
  const ctx = currentTableContext();
  if (!ctx) return;
  if (!deleteTableAt(ctx)) return;
  lastTableCtx = null;
  afterDomChange();
  toast("已删除表格");
}

defineExpose({ formatCodeOnSave });

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
  // ⌘E / Ctrl+E：快速创建行内代码（需先选中文字；toggle）
  if (mod && (e.key === "e" || e.key === "E")) {
    e.preventDefault();
    exec("inlineCode");
    return;
  }
  // ⌘/ · Ctrl+/：代码块内切换行注释（`// `），支持多行
  if (mod && (e.key === "/" || e.key === "?")) {
    e.preventDefault();
    if (toggleCodeComment(el)) {
      afterDomChange();
      scheduleHighlight(); // 注释后立刻按新内容重新着色
    }
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

  if (e.key === "Backspace") {
    if (deleteFirstEmptyParagraph(el)) {
      e.preventDefault();
      afterDomChange();
    }
    return;
  }

  if (e.key === "Enter") {
    // 输入法组合中按回车是确认候选词，交给浏览器，不做块拆分
    if (e.isComposing || e.keyCode === 229) return;
    // 表格：Enter 跳到下一行同一列（最后一行则新建一行）；Shift+Enter 单元格内换行
    if (tableContext(el)) {
      e.preventDefault();
      if (e.shiftKey) insertCellLineBreak(el);
      else tableEnterNext(el);
      afterDomChange();
      return;
    }
    // 代码块内：自己插入换行（浏览器默认会生成多余的 <br>，导致空行与光标错位）
    if (insertCodeNewline(el)) {
      e.preventDefault();
      afterDomChange();
      return;
    }
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
    // 表格内：Tab / Shift+Tab 在单元格之间走，走到最后一格再 Tab 会新增一行
    if (tableContext(el)) {
      e.preventDefault();
      tableMoveCell(el, e.shiftKey);
      afterDomChange();
      return;
    }
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
  // 只有从本笔记本内部复制（onCopy 写入的自定义标记）才带样式；外部一律纯文本
  const internal = e.clipboardData?.getData("text/notebook-internal") === "1";
  let inserted = false;

  // 光标在代码块内：一律按纯文本粘贴（保留换行/缩进，绝不插入块标签）
  const inCode = currentBlockKind(el) === "codeblock";

  // 仅内部复制且不在代码块内时，才保留样式以 HTML 插入
  if (!inCode && internal && rawHtml && looksLikeHtml(rawHtml)) {
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

  // 外部富文本 / 无可保留样式：降级为纯文本粘贴，
  // 结果只有两种形态——代码块内（多行原样）或正文段落
  if (!inserted) {
    const text = plain !== "" ? plain : textFromHtml(rawHtml);
    if (text) {
      pasteTextInto(el, text);
      inserted = true;
    }
  }

  // 自愈：任何被浏览器顶到块外的游离文本收回到相邻块（尤其 <pre>）
  healStrayTopLevelText(el);
  tidyEditorDom(el); // 去掉粘贴后残留在行尾的占位 br / 样式 span

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
  unwrapTypographySpans(box); // 复制出去的内容不带排版包裹标记
  unwrapHighlightSpans(box); // 也不带行内底色标记
  unwrapTokenSpans(box); // 也不带代码高亮标记
  const cleaned = sanitizeHtml(box.innerHTML);
  if (!cleaned) return;

  e.clipboardData?.setData("text/html", cleaned.replace(/\u200b/g, ""));
  e.clipboardData?.setData("text/plain", sel.toString().replace(/\u200b/g, ""));
  // 内部标记：粘贴回本笔记时据此保留样式；外部应用可忽略
  e.clipboardData?.setData("text/notebook-internal", "1");
  e.preventDefault();
}

function onContentInput(): void {
  // 输入后立即整理当前块：清掉浏览器产生的 span[style] 样式残留，
  // 并移除“已有内容却仍带占位 <br>”造成的行尾空行
  const el = contentEl.value;
  if (el) {
    const block = resolveBlock(el);
    if (block) tidyBlock(block);
  }
  scheduleSync();
  scheduleOutline();
  scheduleHighlight();
  updateEmptyClass();
  markDirty();
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

/** 底色配置变化：立刻重排行内底色包裹，并保持光标 */
watch(
  () => Object.values(bgByTag.value).join("|"),
  () => {
    const el = contentEl.value;
    if (!el) return;
    const anchor = caretAnchor(el);
    wrapTypographySpans(el, bgByTag.value);
    if (anchor) restoreCaretAnchor(el, anchor);
  },
);

onBeforeUnmount(() => {
  window.clearTimeout(syncTimer);
  window.clearTimeout(selTimer);
  window.clearTimeout(outlineTimer);
  flushSync();
  document.removeEventListener("selectionchange", onDocSelectionChange);
});
</script>

<template>
  <div class="editor">
    <!-- 顶部格式工具条（同一行右侧：保存状态 + 时间） -->
    <div class="fmtline">
      <NoteToolbar
        :ui="ui"
        :dirty="dirty"
        :outline-open="outlineOpen"
        @exec="exec"
        @toggle-outline="toggleOutline"
        @table-insert="insertNewTable"
        @table-row="(w) => tableRowAction(w)"
        @table-col="(w) => tableColumnAction(w)"
        @table-delete-row="tableDeleteRow"
        @table-delete-col="tableDeleteCol"
        @table-delete="tableDelete"
        @table-align="(a: 'left' | 'center' | 'right') => tableAlignAction(a)"
      />
    </div>

    <div class="editor__body" :class="{ 'is-outline-hidden': !outlineOpen }">
      <div class="outline-slot" :class="{ 'is-hidden': !outlineOpen }">
        <NoteOutline
          :items="outlineItems"
          :active-index="outlineActive"
          @jump="jumpToHeading"
        />
      </div>
      <div class="page">
        <!-- 滚动区：内容只在 padding 内侧可见，超出即裁切 -->
        <div ref="pageContentEl" class="page__content" @scroll="onPageScroll">
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
            :class="codeStyleClass"
            contenteditable="true"
            spellcheck="false"
            role="textbox"
            aria-multiline="true"
            :style="[cssVars, tableVars]"
            @input="onContentInput"
            @compositionstart="onCompositionStart"
            @compositionend="onCompositionEnd"
            @keydown="onKeydown"
            @paste="onPaste"
            @copy="onCopy"
            @click="refreshUi"
            @keyup="onEditorKeyUp"
            @mousedown="onEditorPointerDown"
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
/* 注册为长度类型：--page-max 才能在切换时平滑插值（不支持时退化为直接切换） */
@property --page-max {
  syntax: "<length>";
  inherits: true;
  initial-value: 1060px;
}

.editor {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-width: 0;
  position: relative; /* 供右上角样式设置悬浮定位 */
}

/* ---------- 格式条行：工具条占满一整行 ---------- */
.fmtline {
  flex: none;
}
.fmtline :deep(.fmtbar) {
  width: 100%;
  min-width: 0;
}

/* ---------- 页面视口 ---------- */
/* editor__body 不再自身滚动：滚动被限制在 .page__content（padding 内侧），
   内容滚出 padding 内侧可视区即被裁剪隐藏；上下左右留白始终干净。 */
.editor__body {
  /* 显示目录树时：卡片宽度 = 视口 − 左右留白 − 目录树 − 间距。
     关键：上限与“可用宽度”同步变化，动画全程线性，不会出现“先变宽再变窄”的速度反转 */
  --page-max: calc(100vw - 260px);
  /* 260 = 左右留白 20×2 + 目录树 200 + 间距 20 */
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: stretch;
  overflow: hidden;
  padding: 0 20px; /* 左右留白一致：目录树距左边框 = 卡片距右边框 */
  transition: --page-max 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

/* 目录树隐藏时：页面卡片恢复居中限宽 */
.editor__body.is-outline-hidden {
  --page-max: 1060px;
}

/* 目录树槽位：宽度收起动画驱动编辑器平滑位移 */
.outline-slot {
  flex: none;
  width: 200px;
  height: calc(100% - 28px);
  margin: 14px 20px 14px 0;
  overflow: hidden;
  transition:
    width 0.3s cubic-bezier(0.4, 0, 0.2, 1),
    margin-right 0.3s cubic-bezier(0.4, 0, 0.2, 1),
    opacity 0.2s ease,
    visibility 0s;
}
.outline-slot.is-hidden {
  width: 0;
  margin-right: 0;
  opacity: 0;
  visibility: hidden;
  transition:
    width 0.3s cubic-bezier(0.4, 0, 0.2, 1),
    margin-right 0.3s cubic-bezier(0.4, 0, 0.2, 1),
    opacity 0.15s ease,
    visibility 0s linear 0.3s;
}

.page {
  flex: 1;
  min-width: 0;
  margin: 14px auto; /* 左右 auto：无目录树时卡片水平居中 */
  max-width: var(--page-max, 100vw); /* 由变量平滑过渡驱动宽度变化 */
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
  scrollbar-gutter: stable; /* 宽度动画时不因滚动条出现/消失而跳动 */
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
