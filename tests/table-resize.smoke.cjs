/* eslint-disable */
// 表格列宽拖拽冒烟测试（node + jsdom）
// 运行：node tests/table-resize.smoke.cjs
const { JSDOM } = require('jsdom')
const assert = require('assert')
const path = require('path')

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/',
})
global.window = dom.window
global.document = dom.window.document
global.Node = dom.window.Node
global.NodeFilter = dom.window.NodeFilter
global.DOMParser = dom.window.DOMParser

const cache = (name) =>
  require(path.join(__dirname, '..', 'node_modules', '.cache', name))

const tr = cache('table-resize-test.cjs')
const blocks = cache('blocks-test.cjs')
const html = cache('html-test.cjs')

let passed = 0
let failed = 0
function check(name, fn) {
  try {
    fn()
    passed++
    console.log(`  ✔ ${name}`)
  } catch (err) {
    failed++
    console.log(`  ✘ ${name}\n    ${err.message}`)
  }
}

/** 造一张 cols 列的表格（首行 th） */
function makeTable(rows, cols) {
  const table = document.createElement('table')
  const tbody = document.createElement('tbody')
  for (let r = 0; r < rows; r++) {
    const trow = document.createElement('tr')
    for (let c = 0; c < cols; c++) {
      const cell = document.createElement(r === 0 ? 'th' : 'td')
      cell.appendChild(document.createElement('br'))
      trow.appendChild(cell)
    }
    tbody.appendChild(trow)
  }
  table.appendChild(tbody)
  return table
}

/** 给元素挂一个假的 getBoundingClientRect（jsdom 不做布局） */
function mockRect(el, left, top, width, height) {
  el.getBoundingClientRect = () => ({
    left,
    top,
    right: left + width,
    bottom: top + height,
    width,
    height,
    x: left,
    y: top,
    toJSON() {},
  })
}

const colWidths = (table) => {
  const group = table.querySelector('colgroup')
  if (!group) return null
  return Array.from(group.querySelectorAll('col')).map((c) =>
    Math.round(Number.parseFloat(c.style.width)),
  )
}
const sum = (list) => list.reduce((a, b) => a + b, 0)

/* ---------------- 纯计算：相邻列补偿 ---------------- */
check('拖动某列 → 右邻列等量反向补偿，总和不变', () => {
  const next = tr.resizeNeighbors([100, 100, 100], 0, 30)
  assert.deepStrictEqual(next, [130, 70, 100])
  assert.strictEqual(sum(next), 300)
})

check('拖到极限时两列都不小于最小列宽', () => {
  const wide = tr.resizeNeighbors([100, 100], 0, 999)
  assert.deepStrictEqual(wide, [144, 56])
  const narrow = tr.resizeNeighbors([100, 100], 0, -999)
  assert.deepStrictEqual(narrow, [56, 144])
})

check('最后一列的右边界不可拖（索引越界时原样返回）', () => {
  const widths = [100, 100, 100]
  assert.deepStrictEqual(tr.resizeNeighbors(widths, 2, 50), widths)
  assert.deepStrictEqual(tr.resizeNeighbors(widths, -1, 50), widths)
})

check('两列之和不足最小列宽时不折腾', () => {
  const widths = [30, 20]
  assert.deepStrictEqual(tr.resizeNeighbors(widths, 0, 10), widths)
})

/* ---------------- colgroup 读写 ---------------- */
check('applyColumnWidths 建出 colgroup，并按列数补齐 / 裁掉 col', () => {
  const table = makeTable(2, 3)
  tr.applyColumnWidths(table, [120, 180, 300])
  assert.deepStrictEqual(colWidths(table), [120, 180, 300])

  tr.applyColumnWidths(table, [120, 180])
  assert.deepStrictEqual(colWidths(table), [120, 180])

  tr.applyColumnWidths(table, [10, 20, 30, 40])
  assert.deepStrictEqual(colWidths(table), [10, 20, 30, 40])
})

check('currentColumnWidths：测不到布局时用已存列宽，再退化为等分', () => {
  const bare = makeTable(2, 4)
  // jsdom 没有布局：宽度全为 0 → 等分兜底（600 / 4）
  assert.deepStrictEqual(tr.currentColumnWidths(bare), [150, 150, 150, 150])

  tr.applyColumnWidths(bare, [100, 200, 300, 400])
  assert.deepStrictEqual(tr.currentColumnWidths(bare), [100, 200, 300, 400])
})

check('currentColumnWidths：优先真实渲染宽度（拖拽起点与视觉一致）', () => {
  const table = makeTable(1, 2)
  tr.applyColumnWidths(table, [100, 100])
  const cells = table.querySelectorAll('th')
  mockRect(cells[0], 0, 0, 260, 30)
  mockRect(cells[1], 260, 0, 140, 30)
  mockRect(table, 0, 0, 400, 30)
  assert.deepStrictEqual(tr.currentColumnWidths(table), [260, 140])
})

/* ---------------- 边界命中 ---------------- */
check('columnEdgeAt：只在列分界线上命中，且最后一列右边界不算', () => {
  const table = makeTable(2, 3)
  const row = table.querySelector('tr')
  const cells = row.querySelectorAll('th')
  mockRect(table, 0, 0, 400, 60)
  mockRect(row, 0, 0, 400, 30)
  mockRect(cells[0], 0, 0, 100, 30)
  mockRect(cells[1], 100, 0, 100, 30)
  mockRect(cells[2], 200, 0, 200, 30)

  assert.strictEqual(tr.columnEdgeAt(table, 100, 10), 0)
  assert.strictEqual(tr.columnEdgeAt(table, 104, 10), 0) // 容差内
  assert.strictEqual(tr.columnEdgeAt(table, 200, 10), 1)
  assert.strictEqual(tr.columnEdgeAt(table, 400, 10), null) // 最后一列右侧
  assert.strictEqual(tr.columnEdgeAt(table, 150, 10), null) // 列中间
  assert.strictEqual(tr.columnEdgeAt(table, 100, 100), null) // 行外
})

/* ---------------- 插入 / 删除列的列宽同步 ---------------- */
check('insertColumnWidth：新列取相邻列一半，总和不变', () => {
  const table = makeTable(2, 2)
  tr.applyColumnWidths(table, [100, 300])
  tr.insertColumnWidth(table, 1)
  assert.deepStrictEqual(colWidths(table), [100, 150, 150])
})

check('removeColumnWidth：其余列按比例补满，总和不变', () => {
  const table = makeTable(2, 3)
  tr.applyColumnWidths(table, [100, 100, 200])
  tr.removeColumnWidth(table, 0)
  const widths = colWidths(table)
  assert.strictEqual(widths.length, 2)
  assert.strictEqual(sum(widths), 400)
})

check('没有 colgroup 的表格（没拖过）插入 / 删除列时保持均分', () => {
  const table = makeTable(2, 2)
  tr.insertColumnWidth(table, 1)
  assert.strictEqual(table.querySelector('colgroup'), null)
  tr.removeColumnWidth(table, 0)
  assert.strictEqual(table.querySelector('colgroup'), null)
})

check('blocks.ts 插入 / 删除列会同步 colgroup（列数与 col 数一致）', () => {
  const table = makeTable(2, 2)
  tr.applyColumnWidths(table, [100, 100])
  const row = table.querySelector('tr')
  const ctx = {
    table,
    row,
    cell: row.querySelector('th'),
    rowIndex: 0,
    colIndex: 0,
    align: 'left',
  }
  blocks.insertTableColumnAt(ctx, 'right')
  assert.strictEqual(tr.columnCount(table), 3)
  assert.strictEqual(colWidths(table).length, 3)

  blocks.deleteTableColumnAt(ctx)
  assert.strictEqual(tr.columnCount(table), 2)
  assert.strictEqual(colWidths(table).length, 2)
})

/* ---------------- 拖拽高亮的类名 ---------------- */
check('markColumnCells 给整列单元格加 / 去类名', () => {
  const table = makeTable(3, 3)
  tr.markColumnCells(table, 1, 'is-col-dragging', true)
  const marked = table.querySelectorAll('.is-col-dragging')
  assert.strictEqual(marked.length, 3)
  tr.markColumnCells(table, 1, 'is-col-dragging', false)
  assert.strictEqual(table.querySelectorAll('.is-col-dragging').length, 0)
})

/* ---------------- 持久化契约：列宽随内容 HTML 一起保留 ---------------- */
check('normalizeHtml 不会剥掉 colgroup 与 col 的宽度（列宽可持久化）', () => {
  const table = makeTable(2, 2)
  tr.applyColumnWidths(table, [120, 280])
  const out = html.normalizeHtml(`<div></div><p>x</p>${table.outerHTML}`)
  assert.ok(out.includes('<colgroup>'), `colgroup 应保留：${out}`)
  assert.ok(out.includes('width: 120px'), `列宽应保留：${out}`)
  assert.ok(out.includes('width: 280px'), `列宽应保留：${out}`)
})

check('落库链路：tidyBlock + normalizeHtml 之后列宽仍在（拖拽结果会写进正文 HTML）', () => {
  const table = makeTable(2, 3)
  tr.applyColumnWidths(table, [140, 180, 280])
  // NoteEditor.syncNoteFromDom 的真实顺序：先 tidyEditorDom（TABLE 直接跳过），再 normalizeHtml
  blocks.tidyBlock(table, true)
  const out = html.normalizeHtml(table.outerHTML)
  assert.ok(out.includes('<colgroup>'), `colgroup 应保留：${out}`)
  assert.ok(out.includes('width: 140px'), `列宽应保留：${out}`)
  assert.ok(out.includes('width: 180px'), `列宽应保留：${out}`)
  assert.ok(out.includes('width: 280px'), `列宽应保留：${out}`)
})

check('sanitizeHtml（粘贴清洗）整段丢弃列宽，表格结构仍在', () => {
  const table = makeTable(2, 2)
  tr.applyColumnWidths(table, [120, 280])
  const out = html.sanitizeHtml(table.outerHTML)
  assert.ok(out.includes('<table>'))
  assert.ok(!out.includes('colgroup'))
  assert.ok(!/<col[\s>]/.test(out), `不应残留孤立的 col：${out}`)
})

console.log(`\n表格列宽：${passed} 通过，${failed} 失败`)
process.exit(failed === 0 ? 0 : 1)
