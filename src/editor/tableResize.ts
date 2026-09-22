/**
 * 表格列宽：拖拽调整 + 列宽存取。
 *
 * 列宽以 `<colgroup><col style="width: 120px">` 的形式存在表格内部，随笔记
 * HTML 一起存储（打印 / 换机器都跟着走）。表格是 `table-layout: fixed` +
 * `width: 100%`，col 上的 px 相当于“各列之间的比例”：拖拽时保持各列之和
 * 不变，纸宽变化时列宽按同一比例缩放，不会撑破纸张、也不会出现横向滚动。
 *
 * 这里只放纯函数与 DOM 读写，指针事件与 UI 反馈在 NoteEditor.vue 里。
 */

/** 拖拽时的最小列宽（px） */
export const MIN_COL_WIDTH = 56

/** 边界命中容差（px）：指针落在列右边界 ± 该范围内即视为要拖这一列 */
export const EDGE_TOLERANCE = 6

/** 未渲染（jsdom / 尚未布局）时的兜底表格宽度，用于退化成等分 */
const FALLBACK_TABLE_WIDTH = 600

/** 一行里的单元格（忽略杂散节点，与 blocks.ts 的 rowCells 同一规则） */
function rowCells(row: Element): HTMLTableCellElement[] {
  return Array.from(row.children).filter(
    (c) => c.tagName === 'TD' || c.tagName === 'TH',
  ) as HTMLTableCellElement[]
}

/** 表格自己的 colgroup（没有则返回 null；只认直接子元素） */
function colgroupOf(table: HTMLTableElement): HTMLElement | null {
  for (const child of Array.from(table.children)) {
    if (child.tagName === 'COLGROUP') return child as HTMLElement
  }
  return null
}

/** colgroup 里的 col 元素 */
function colsOf(table: HTMLTableElement): HTMLTableColElement[] {
  const group = colgroupOf(table)
  if (!group) return []
  return Array.from(group.children).filter(
    (c) => c.tagName === 'COL',
  ) as HTMLTableColElement[]
}

/** 列数：以第一行为准（表格至少有 1 行） */
export function columnCount(table: HTMLTableElement): number {
  const first = table.querySelector('tr')
  return first ? rowCells(first).length : 0
}

/** 已存下来的列宽（colgroup 里有完整合法的 px 宽度时返回，否则 null） */
function storedWidths(table: HTMLTableElement): number[] | null {
  const widths = colsOf(table).map((col) => Number.parseFloat(col.style.width))
  if (widths.length === 0) return null
  return widths.every((w) => Number.isFinite(w) && w > 0) ? widths : null
}

/**
 * 当前实际列宽（px）：优先真实渲染宽度（拖拽起点必须与眼睛看到的一致），
 * 测量不到时用已存的列宽，再退化为等分。
 */
export function currentColumnWidths(table: HTMLTableElement): number[] {
  const count = columnCount(table)
  if (count <= 0) return []

  const first = table.querySelector('tr')
  const measured = first
    ? rowCells(first).map((cell) => cell.getBoundingClientRect().width)
    : []
  if (measured.length === count && measured.every((w) => w > 0)) return measured

  const stored = storedWidths(table)
  if (stored && stored.length === count) return stored

  const total = table.getBoundingClientRect().width || FALLBACK_TABLE_WIDTH
  return new Array<number>(count).fill(total / count)
}

/** 写列宽：必要时创建 colgroup，并按数量补齐 / 裁掉 col 后逐个落 px */
export function applyColumnWidths(
  table: HTMLTableElement,
  widths: number[],
): void {
  if (widths.length === 0) return

  let group = colgroupOf(table)
  if (!group) {
    group = document.createElement('colgroup')
    table.insertBefore(group, table.firstChild)
  }

  const cols = Array.from(group.children).filter(
    (c) => c.tagName === 'COL',
  ) as HTMLTableColElement[]
  while (cols.length < widths.length) {
    const col = document.createElement('col')
    group.appendChild(col)
    cols.push(col)
  }
  while (cols.length > widths.length) {
    const extra = cols.pop()
    extra?.remove()
  }

  widths.forEach((w, i) => {
    cols[i].style.width = `${Math.max(1, Math.round(w))}px`
  })
}

/**
 * 纯计算：把 delta 加到第 col 列，右邻列等量反向补偿 ——
 * 两列之和不变（表格总宽因此不变），且两列都不小于 min。
 * col 是“左边那一列”的索引（拖的是它与右邻列之间的分界线）。
 */
export function resizeNeighbors(
  widths: number[],
  col: number,
  delta: number,
  min = MIN_COL_WIDTH,
): number[] {
  const next = widths.slice()
  if (col < 0 || col + 1 >= next.length) return next
  const pair = (next[col] ?? 0) + (next[col + 1] ?? 0)
  if (pair < min * 2) return next
  const left = Math.min(Math.max((next[col] ?? 0) + delta, min), pair - min)
  next[col] = left
  next[col + 1] = pair - left
  return next
}

/**
 * 命中测试：指针是否落在「第 i 列 / 第 i+1 列」的分界线上。
 * 返回可拖动的列索引 i；不在任何分界线上返回 null。
 * 最后一列的右边界不参与（表格总宽由纸宽决定，拖它没有意义）。
 */
export function columnEdgeAt(
  table: HTMLTableElement,
  clientX: number,
  clientY: number,
  tolerance = EDGE_TOLERANCE,
): number | null {
  for (const row of Array.from(table.querySelectorAll('tr'))) {
    const rect = row.getBoundingClientRect()
    if (clientY < rect.top || clientY > rect.bottom) continue
    const cells = rowCells(row)
    for (let i = 0; i < cells.length - 1; i++) {
      const cellRect = cells[i].getBoundingClientRect()
      if (Math.abs(clientX - cellRect.right) <= tolerance) return i
    }
    return null
  }
  return null
}

/**
 * 插入列后同步列宽：新列取参考列的一半（两列之和不变）。
 * 没有列宽记录（没拖过）时什么都不做 —— 保持均分最干净。
 */
export function insertColumnWidth(
  table: HTMLTableElement,
  colIndex: number,
): void {
  const widths = storedWidths(table)
  if (!widths) return
  const at = Math.max(0, Math.min(colIndex, widths.length - 1))
  const half = (widths[at] ?? 0) / 2
  widths[at] = half
  widths.splice(at, 0, half)
  applyColumnWidths(table, widths)
}

/**
 * 删除列后同步列宽：剩下的列按比例补满（表格总宽不变）。
 * 没有列宽记录时什么都不做。
 */
export function removeColumnWidth(
  table: HTMLTableElement,
  colIndex: number,
): void {
  const widths = storedWidths(table)
  if (!widths || widths.length <= 1) return
  const total = widths.reduce((sum, w) => sum + w, 0)
  const at = Math.max(0, Math.min(colIndex, widths.length - 1))
  const removed = widths[at] ?? 0
  widths.splice(at, 1)
  if (widths.length === 0 || total - removed <= 0) return
  const scale = total / (total - removed)
  applyColumnWidths(
    table,
    widths.map((w) => w * scale),
  )
}

/** 给某一列的所有单元格加 / 去类名（拖拽高亮用） */
export function markColumnCells(
  table: HTMLTableElement,
  colIndex: number,
  className: string,
  on: boolean,
): void {
  for (const row of Array.from(table.querySelectorAll('tr'))) {
    const cell = rowCells(row)[colIndex]
    if (!cell) continue
    cell.classList.toggle(className, on)
  }
}
