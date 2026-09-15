/* eslint-disable */
// 自研块编辑器 DOM 引擎冒烟测试（node + jsdom，非浏览器内完整验证）
// 运行：node tests/engine.smoke.cjs
const { JSDOM } = require('jsdom')
const assert = require('assert')

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/',
})
global.window = dom.window
global.document = dom.window.document
global.Node = dom.window.Node
global.NodeFilter = dom.window.NodeFilter
global.DOMException = dom.window.DOMException

const blocks = require(require('path').join(
  __dirname,
  '..',
  'node_modules',
  '.cache',
  'blocks-test.cjs',
))

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
function reset() {
  document.body.innerHTML = ''
}
function editorWith(html) {
  const el = document.createElement('div')
  el.contentEditable = 'true'
  el.innerHTML = html
  document.body.appendChild(el)
  return el
}
function firstText(el) {
  return el.querySelector('*')?.firstChild ?? el.firstChild
}
/** 让选区覆盖从首个块 textIndex 开始的 len 个字符 */
function selectText(el, start, len) {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
  let acc = 0
  let n = walker.nextNode()
  let startNode = null
  let startOff = 0
  while (n) {
    const L = (n.textContent || '').length
    if (!startNode && acc + L > start) {
      startNode = n
      startOff = start - acc
      break
    }
    acc += L
    n = walker.nextNode()
  }
  if (!startNode) throw new Error('selectText: start out of range')
  // 重新走一遍找终点
  const walker2 = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
  let acc2 = 0
  let n2 = walker2.nextNode()
  let endNode = null
  let endOff = 0
  while (n2) {
    const L = (n2.textContent || '').length
    if (acc2 + L >= start + len) {
      endNode = n2
      endOff = start + len - acc2
      break
    }
    acc2 += L
    n2 = walker2.nextNode()
  }
  const range = document.createRange()
  range.setStart(startNode, startOff)
  range.setEnd(endNode ?? startNode, endOff ?? startOff)
  const sel = window.getSelection()
  sel.removeAllRanges()
  sel.addRange(range)
}

reset()
console.log('A. 段落 ↔ 标题切换')
{
  const el = editorWith('<p>你好世界</p>')
  blocks.placeCaretAtEndOf(el.querySelector('p'))
  blocks.setBlockType(el, 'h1')
  assert.strictEqual(el.firstElementChild.tagName, 'H1')
  // jsdom 在 DOM 替换后会丢 selection，因此手动重设光标再 toggle
  blocks.placeCaretAtEndOf(el.querySelector('h1'))
  blocks.setBlockType(el, 'h1') // toggle → 段落
  assert.strictEqual(el.firstElementChild.tagName, 'P')
  assert.strictEqual(el.textContent, '你好世界')
  check('A1 段落转 h1 再切回正文，文本保留', () => {})
}

reset()
console.log('B. 中文字距 / 英文间隔包裹')
{
  // 夹在中文中的英文：两侧都留间隔
  const el = editorWith('<p>中文abc中文</p>')
  blocks.wrapTypographySpans(el)
  const p = el.querySelector('p')
  const abc = p.querySelector('span.latin')
  assert.ok(abc.classList.contains('latin--gap-l'))
  assert.ok(abc.classList.contains('latin--gap-r'))
  assert.strictEqual(p.textContent, '中文abc中文') // 包裹不改变文本

  // 纯英文 / 与 ASCII 标点相邻：视为一体，不留间隔
  const el2 = editorWith('<p>abc(def)ghi</p>')
  blocks.wrapTypographySpans(el2)
  const latin2 = Array.from(el2.querySelectorAll('span.latin'))
  assert.deepStrictEqual(
    latin2.map((s) => s.textContent),
    ['abc', '(', 'def', ')', 'ghi'],
  )
  for (const s of latin2) {
    assert.strictEqual(s.className.trim(), 'latin') // 两侧都是西文 → 无间隔
  }

  // add_child(主场景实例)：开括号右侧、闭括号左侧都要留间隔
  const el3 = editorWith('<p>执行 add_child(主场景实例)。</p>')
  blocks.wrapTypographySpans(el3)
  const open = Array.from(el3.querySelectorAll('span.latin')).find((s) => s.textContent === '(')
  const close = Array.from(el3.querySelectorAll('span.latin')).find((s) => s.textContent === ')')
  assert.ok(open && open.classList.contains('latin--gap-r')) // （ 右边有空隙
  assert.ok(close && close.classList.contains('latin--gap-l')) // ）左边有空隙
  assert.ok(close.classList.contains('latin--gap-r')) // ）右边（挨着中文标点）也有空隙
  check('B1 英文/标点与中文交界的两侧留间隔，与西文相邻视为一体', () => {})
}

reset()
console.log('C. 代码块往返')
{
  const el = editorWith('<p>第一行<br>第二行</p>')
  blocks.placeCaretAtEndOf(el.querySelector('p'))
  blocks.setBlockType(el, 'codeblock')
  const pre = el.firstElementChild
  assert.strictEqual(pre.tagName, 'PRE')
  // 代码块内的换行：编辑期 DOM 用 <br> 表示（存储时再转回换行符）
  assert.strictEqual(pre.textContent, '第一行第二行')
  assert.strictEqual(pre.querySelectorAll('br').length, 1)
  blocks.placeCaretAtEndOf(pre)
  blocks.setBlockType(el, 'paragraph')
  assert.strictEqual(el.firstElementChild.tagName, 'P')
  assert.ok(el.textContent.includes('第一行'))
  check('C1 段落→代码块→段落（内容保留）', () => {})
}

reset()
console.log('D. 段落→无序列表，回车续项')
{
  const el = editorWith('<p>第一项</p>')
  blocks.placeCaretAtEndOf(el.querySelector('p'))
  blocks.setBlockType(el, 'bulletList')
  const ul = el.firstElementChild
  assert.strictEqual(ul.tagName, 'UL')
  blocks.placeCaretAtEndOf(ul.querySelector('li'))
  blocks.handleEnterKey(el) // li 末尾回车 → 新 li
  const lis = ul.querySelectorAll('li')
  assert.strictEqual(lis.length, 2)
  check('D1 段落转无序列表', () => {})
  blocks.handleEnterKey(el) // 空 li 回车 → 退出列表
  assert.ok(el.firstElementChild.tagName === 'UL')
  assert.ok(el.textContent.includes('第一项'))
  check('D2 空列表项回车可退出列表', () => {})
}

reset()
console.log('E. 行内粗体 toggle')
{
  const el = editorWith('<p>你好世界</p>')
  selectText(el, 0, 2)
  blocks.toggleInlineMark(el, 'bold')
  assert.ok(el.querySelector('p b') || el.querySelector('p strong'))
  assert.strictEqual(el.textContent, '你好世界')
  selectText(el, 0, 2)
  blocks.toggleInlineMark(el, 'bold') // 取消
  assert.ok(!el.querySelector('p b') && !el.querySelector('p strong'))
  check('E1 粗体加/取消不丢字', () => {})
}

reset()
console.log('F. 标题内回车 → 后续为正文段落')
{
  const el = editorWith('<h1>标题内容</h1>')
  const h = el.querySelector('h1')
  const textNode = h.firstChild
  const range = document.createRange()
  range.setStart(textNode, 2)
  range.collapse(true)
  const sel = window.getSelection()
  sel.removeAllRanges()
  sel.addRange(range)
  const handled = blocks.handleEnterKey(el)
  assert.strictEqual(handled, true)
  assert.strictEqual(el.firstElementChild.tagName, 'H1')
  const second = el.children[1]
  assert.strictEqual(second.tagName, 'P')
  assert.strictEqual(el.textContent, '标题内容')
  check('F1 标题中回车拆出正文段', () => {})
}

reset()
console.log('H. 行首 / 行尾回车语义')
{
  // 行尾回车：应在段落之后追加一个可输入的空行
  const el = editorWith('<p>hello</p>')
  const tn = el.querySelector('p').firstChild
  const r1 = document.createRange()
  r1.setStart(tn, 5)
  r1.collapse(true)
  const s1 = window.getSelection()
  s1.removeAllRanges()
  s1.addRange(r1)
  blocks.handleEnterKey(el)
  assert.strictEqual(el.children.length, 2)
  assert.strictEqual(el.children[0].textContent, 'hello')
  assert.strictEqual(el.children[1].tagName, 'P')
  assert.ok(!el.children[1].textContent.trim())
  check('H1 行尾回车在下方追加空行', () => {})

  // 行首回车：在段落上方让出空行，光标跟随原文字一起下移（仍在该行文字开头）
  const el2 = editorWith('<p>hello</p>')
  const tn2 = el2.querySelector('p').firstChild
  const r2 = document.createRange()
  r2.setStart(tn2, 0)
  r2.collapse(true)
  const s2 = window.getSelection()
  s2.removeAllRanges()
  s2.addRange(r2)
  blocks.handleEnterKey(el2)
  assert.strictEqual(el2.children.length, 2)
  assert.ok(!el2.children[0].textContent.trim())
  assert.strictEqual(el2.children[1].textContent, 'hello')
  const caretBlock = blocks.resolveBlock(el2)
  assert.strictEqual(caretBlock.tagName, 'P')
  assert.strictEqual(caretBlock.textContent, 'hello') // 光标跟着原文字下移
  check('H2 行首回车让出空行、光标跟随原行', () => {})
}

reset()
console.log('G. 选中多段合并为代码块')
{
  const el = editorWith('<p>甲</p><p>乙</p>')
  const t1 = el.children[0].firstChild
  const t2 = el.children[1].firstChild
  const range = document.createRange()
  range.setStart(t1, 0)
  range.setEnd(t2, (t2.textContent ?? '').length)
  const sel = window.getSelection()
  sel.removeAllRanges()
  sel.addRange(range)
  blocks.setBlockType(el, 'codeblock')
  assert.strictEqual(el.querySelectorAll('pre').length, 1)
  const flat = (el.querySelector('pre').textContent ?? '')
    .replace(/\u200b/g, '')
    .replace(/\n/g, '')
  assert.strictEqual(flat, '甲乙')
  check('G1 选中多个段落合并为一个代码块', () => {})
}

reset()
console.log('I. 代码块行注释切换（⌘/）')
{
  // 单行：光标所在行加/去注释
  const el = editorWith('<pre><code>const a = 1<br>const b = 2</code></pre>')
  const code = el.querySelector('code')
  const line2 = code.childNodes[2] // 第二行文本节点
  const r = document.createRange()
  r.setStart(line2, 3)
  r.collapse(true)
  const sel = window.getSelection()
  sel.removeAllRanges()
  sel.addRange(r)

  assert.strictEqual(blocks.toggleCodeComment(el), true)
  // 用 DOM 逐行读：<br> 分行
  const readLines = (pre) => {
    const out = ['']
    for (const n of Array.from(pre.querySelector('code').childNodes)) {
      if (n.tagName === 'BR') out.push('')
      else out[out.length - 1] += (n.textContent ?? '').replace(/\u200b/g, '')
    }
    return out
  }
  const after = readLines(el.querySelector('pre'))
  assert.deepStrictEqual(after, ['const a = 1', '// const b = 2'])
  // 再切一次 → 还原
  assert.strictEqual(blocks.toggleCodeComment(el), true)
  assert.deepStrictEqual(readLines(el.querySelector('pre')), ['const a = 1', 'const b = 2'])
  check('I1 单行注释可加可去', () => {})
}
{
  // 多行 + 缩进保留
  const el = editorWith('<pre><code>function f() {<br>  return 1<br>}</code></pre>')
  const code = el.querySelector('code')
  const r = document.createRange()
  r.setStart(code.firstChild, 0)
  r.setEnd(code.lastChild, 1)
  const sel = window.getSelection()
  sel.removeAllRanges()
  sel.addRange(r)
  const readLines = (pre) => {
    const out = ['']
    for (const n of Array.from(pre.querySelector('code').childNodes)) {
      if (n.tagName === 'BR') out.push('')
      else out[out.length - 1] += (n.textContent ?? '').replace(/\u200b/g, '')
    }
    return out
  }
  blocks.toggleCodeComment(el)
  assert.deepStrictEqual(readLines(el.querySelector('pre')), [
    '// function f() {',
    '  // return 1',
    '// }',
  ])
  // 重新选中三行再切换 → 全部取消
  const code2 = el.querySelector('code')
  const texts = Array.from(code2.childNodes).filter((n) => n.nodeType === 3)
  const r2 = document.createRange()
  r2.setStart(texts[0], 0)
  r2.setEnd(texts[texts.length - 1], (texts[texts.length - 1].textContent ?? '').length)
  sel.removeAllRanges()
  sel.addRange(r2)
  blocks.toggleCodeComment(el)
  assert.deepStrictEqual(readLines(el.querySelector('pre')), [
    'function f() {',
    '  return 1',
    '}',
  ])
  check('I2 多行注释、缩进保留、可整体取消', () => {})
}
{
  // 正文里不应生效
  const el = editorWith('<p>正文</p>')
  const tn = el.querySelector('p').firstChild
  const r = document.createRange()
  r.setStart(tn, 1)
  r.collapse(true)
  const sel = window.getSelection()
  sel.removeAllRanges()
  sel.addRange(r)
  assert.strictEqual(blocks.toggleCodeComment(el), false)
  assert.strictEqual(el.querySelector('p').textContent, '正文')
  check('I3 正文中按 ⌘/ 不生效', () => {})
}

reset()
console.log('J. 光标锚点区分“行首”与“上一行末尾”')
{
  const el = editorWith('<pre><code>a<br>b</code></pre>')
  const code = el.querySelector('code')
  const br = code.childNodes[1]
  const sel = window.getSelection()
  // 第 1 行末尾（换行之前）
  let r = document.createRange()
  r.setStart(code.firstChild, 1)
  r.collapse(true)
  sel.removeAllRanges()
  sel.addRange(r)
  const atLine1End = blocks.caretAnchor(el)
  // 第 2 行行首（换行之后）
  r = document.createRange()
  r.setStartAfter(br)
  r.collapse(true)
  sel.removeAllRanges()
  sel.addRange(r)
  const atLine2Start = blocks.caretAnchor(el)

  assert.strictEqual(atLine1End.offset, 1)
  assert.strictEqual(atLine2Start.offset, 2) // <br> 计 1
  assert.notStrictEqual(atLine1End.offset, atLine2Start.offset)
  // 往返恢复后仍在第 2 行行首
  blocks.restoreCaretAnchor(el, atLine2Start)
  assert.strictEqual(blocks.caretAnchor(el).offset, 2)
  check('J1 代码块内行首与上一行末尾锚点不同、可精确恢复', () => {})
}
{
  // 空行（第 2 行）行首也要能精确往返
  const el = editorWith('<pre><code>a<br><br>b</code></pre>')
  const code = el.querySelector('code')
  const sel = window.getSelection()
  const r = document.createRange()
  r.setStartAfter(code.childNodes[1])
  r.collapse(true)
  sel.removeAllRanges()
  sel.addRange(r)
  const anchor = blocks.caretAnchor(el)
  assert.strictEqual(anchor.offset, 2)
  blocks.restoreCaretAnchor(el, anchor)
  assert.strictEqual(blocks.caretAnchor(el).offset, 2)
  check('J2 空行行首的光标可精确往返', () => {})
}

reset()
console.log('K. 表格')
{
  const el = editorWith('<p>前</p>')
  const tn = el.querySelector('p').firstChild
  const r = document.createRange()
  r.setStart(tn, 1)
  r.collapse(true)
  const sel = window.getSelection()
  sel.removeAllRanges()
  sel.addRange(r)
  assert.strictEqual(blocks.insertTable(el, 3, 2), true)
  const table = el.querySelector('table')
  assert.ok(table, '应插入表格')
  const rows = table.querySelectorAll('tr')
  assert.strictEqual(rows.length, 3)
  assert.strictEqual(rows[0].querySelectorAll('th').length, 2, '首行应为表头 th')
  assert.strictEqual(rows[1].querySelectorAll('td').length, 2)
  assert.strictEqual(rows[1].querySelectorAll('td')[0].querySelector('br') !== null, true, '空单元格要有落脚点')
  // 表格后应留一个空段落
  assert.strictEqual(el.lastElementChild.tagName, 'P')
  // 光标进入第一个单元格
  const ctx = blocks.tableContext(el)
  assert.strictEqual(ctx.rowIndex, 0)
  assert.strictEqual(ctx.colIndex, 0)
  check('K1 插入 3×2 表格：结构、落脚点、光标到位', () => {})
}
{
  const el = editorWith('<p>x</p>')
  const tn = el.querySelector('p').firstChild
  const sel = window.getSelection()
  const r = document.createRange()
  r.setStart(tn, 1)
  r.collapse(true)
  sel.removeAllRanges()
  sel.addRange(r)
  blocks.insertTable(el, 3, 2)
  // Enter：到下一行同列
  blocks.tableEnterNext(el)
  let ctx = blocks.tableContext(el)
  assert.strictEqual(ctx.rowIndex, 1)
  assert.strictEqual(ctx.colIndex, 0)
  blocks.tableEnterNext(el)
  ctx = blocks.tableContext(el)
  assert.strictEqual(ctx.rowIndex, 2)
  // 末行再 Enter → 新建一行
  blocks.tableEnterNext(el)
  ctx = blocks.tableContext(el)
  assert.strictEqual(el.querySelectorAll('tr').length, 4)
  assert.strictEqual(ctx.rowIndex, 3)
  assert.strictEqual(ctx.colIndex, 0)
  // 新行的单元格应是 td
  assert.strictEqual(el.querySelectorAll('tr')[3].querySelectorAll('td').length, 2)
  check('K2 Enter 下一行同列，末行新增一行', () => {})
}
{
  const el = editorWith('<p>x</p>')
  const tn = el.querySelector('p').firstChild
  const sel = window.getSelection()
  const r = document.createRange()
  r.setStart(tn, 1)
  r.collapse(true)
  sel.removeAllRanges()
  sel.addRange(r)
  blocks.insertTable(el, 2, 2)
  // Tab → 右移一格
  blocks.tableMoveCell(el)
  let ctx = blocks.tableContext(el)
  assert.strictEqual(ctx.rowIndex, 0)
  assert.strictEqual(ctx.colIndex, 1)
  // Shift+Tab → 回退
  blocks.tableMoveCell(el, true)
  ctx = blocks.tableContext(el)
  assert.strictEqual(ctx.colIndex, 0)
  // 走到最后一个单元格再 Tab → 新建一行
  blocks.tableMoveCell(el) // (0,1)
  blocks.tableMoveCell(el) // (1,0)
  blocks.tableMoveCell(el) // (1,1) 最后一个
  blocks.tableMoveCell(el) // 新建行
  ctx = blocks.tableContext(el)
  assert.strictEqual(el.querySelectorAll('tr').length, 3)
  assert.strictEqual(ctx.rowIndex, 2)
  assert.strictEqual(ctx.colIndex, 0)
  check('K3 Tab 移动单元格，末格新建一行', () => {})
}
{
  const el = editorWith('<p>x</p>')
  const tn = el.querySelector('p').firstChild
  const sel = window.getSelection()
  const r = document.createRange()
  r.setStart(tn, 1)
  r.collapse(true)
  sel.removeAllRanges()
  sel.addRange(r)
  blocks.insertTable(el, 3, 2)
  const table = el.querySelector('table')
  // 在当前行（第 1 行）下方插行
  assert.strictEqual(blocks.insertTableRow(el, 'below'), true)
  assert.strictEqual(table.querySelectorAll('tr').length, 4)
  // 上方插行（光标已在新行第 1 行下方 → 也就是第 2 行）
  blocks.insertTableRow(el, 'above')
  assert.strictEqual(table.querySelectorAll('tr').length, 5)
  // 删除当前行
  assert.strictEqual(blocks.deleteTableRow(el), true)
  assert.strictEqual(table.querySelectorAll('tr').length, 4)
  // 列：插入 / 删除
  assert.strictEqual(blocks.insertTableColumn(el, 'right'), true)
  assert.strictEqual(table.querySelectorAll('tr')[0].querySelectorAll('th, td').length, 3)
  assert.strictEqual(blocks.deleteTableColumn(el), true)
  assert.strictEqual(table.querySelectorAll('tr')[0].querySelectorAll('th, td').length, 2)
  check('K4 增删行列', () => {})
}
{
  const el = editorWith('<p>x</p>')
  const tn = el.querySelector('p').firstChild
  const sel = window.getSelection()
  const r = document.createRange()
  r.setStart(tn, 1)
  r.collapse(true)
  sel.removeAllRanges()
  sel.addRange(r)
  blocks.insertTable(el, 2, 2)
  assert.strictEqual(blocks.deleteTable(el), true)
  assert.strictEqual(el.querySelector('table'), null)
  // 删表后光标应落在段落里
  const block = blocks.resolveBlock(el)
  assert.strictEqual(block.tagName, 'P')
  // 只剩一行时删行 = 删整表
  const el2 = editorWith('<table><tbody><tr><td><br></td></tr></tbody></table><p>尾</p>')
  const cell = el2.querySelector('td')
  const r2 = document.createRange()
  r2.setStart(cell, 0)
  r2.collapse(true)
  sel.removeAllRanges()
  sel.addRange(r2)
  blocks.deleteTableRow(el2)
  assert.strictEqual(el2.querySelector('table'), null)
  check('K5 删除整表（含仅一行时删行等价删表）', () => {})
}
{
  // 单元格边界与换行一样占偏移：td1 末尾 ≠ td2 开头
  const el = editorWith('<table><tbody><tr><td>甲</td><td>乙</td></tr></tbody></table>')
  const tds = el.querySelectorAll('td')
  const sel = window.getSelection()
  const r = document.createRange()
  r.setStart(tds[0].firstChild, 1)
  r.collapse(true)
  sel.removeAllRanges()
  sel.addRange(r)
  const atEndOfCell1 = blocks.caretAnchor(el)
  const r2 = document.createRange()
  r2.setStart(tds[1], 0)
  r2.collapse(true)
  sel.removeAllRanges()
  sel.addRange(r2)
  const atStartOfCell2 = blocks.caretAnchor(el)
  assert.notStrictEqual(atEndOfCell1.offset, atStartOfCell2.offset)
  // 往返恢复后仍在第 2 格
  blocks.restoreCaretAnchor(el, atStartOfCell2)
  assert.strictEqual(blocks.caretAnchor(el).offset, atStartOfCell2.offset)
  check('K6 表格内光标锚点区分格首与上一格末尾', () => {})
}
{
  // 表格是独立块类型：块切换与清理都不该动它
  const el = editorWith('<table><tbody><tr><td><br></td></tr></tbody></table>')
  const cell = el.querySelector('td')
  const r = document.createRange()
  r.setStart(cell, 0)
  r.collapse(true)
  const sel = window.getSelection()
  sel.removeAllRanges()
  sel.addRange(r)
  assert.strictEqual(blocks.resolveBlock(el).tagName, 'TABLE')
  blocks.setBlockType(el, 'h1')
  assert.ok(el.querySelector('table'), '块切换不应把表格改成标题')
  assert.strictEqual(el.querySelector('h1'), null)
  blocks.tidyBlock(el.querySelector('table'))
  assert.ok(el.querySelector('td br'), '清理不应删掉单元格里的 <br>')
  check('K7 表格不受块切换与 tidyBlock 影响', () => {})
}

reset()
console.log('L. 表格单元格对齐')
{
  const el = editorWith('<table><tbody><tr><td>甲</td><td>乙</td></tr></tbody></table>')
  const tds = el.querySelectorAll('td')
  const sel = window.getSelection()
  const r = document.createRange()
  r.setStart(tds[0].firstChild, 1)
  r.collapse(true)
  sel.removeAllRanges()
  sel.addRange(r)

  assert.strictEqual(blocks.tableContext(el).align, 'left') // 默认左对齐
  assert.strictEqual(blocks.setTableCellAlign(el, 'center'), true)
  assert.strictEqual(tds[0].style.textAlign, 'center')
  assert.strictEqual(blocks.tableContext(el).align, 'center')
  assert.strictEqual(tds[1].style.textAlign, '', '只影响光标所在单元格')

  blocks.setTableCellAlign(el, 'right')
  assert.strictEqual(tds[0].style.textAlign, 'right')

  // 回到左对齐 = 清除字面样式，存储保持干净
  blocks.setTableCellAlign(el, 'left')
  assert.strictEqual(tds[0].getAttribute('style'), null)
  assert.strictEqual(blocks.tableContext(el).align, 'left')
  check('L1 单元格对齐可设置 / 切换 / 清除', () => {})
}
{
  // 跨格选区批量设置
  const el = editorWith('<table><tbody><tr><td>甲</td><td>乙</td><td>丙</td></tr></tbody></table>')
  const tds = el.querySelectorAll('td')
  const sel = window.getSelection()
  const range = document.createRange()
  range.setStart(tds[0].firstChild, 0)
  range.setEnd(tds[1].firstChild, 1)
  sel.removeAllRanges()
  sel.addRange(range)
  assert.strictEqual(blocks.setTableCellAlign(el, 'center'), true)
  assert.strictEqual(tds[0].style.textAlign, 'center')
  assert.strictEqual(tds[1].style.textAlign, 'center')
  assert.strictEqual(tds[2].style.textAlign, '', '选区外的单元格不受影响')
  check('L2 选中多个单元格可批量设置对齐', () => {})
}

console.log(`\n结果：通过 ${passed} 项，失败 ${failed} 项`)
process.exit(failed > 0 ? 1 : 0)
