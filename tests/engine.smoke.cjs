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
  // 代码块内的换行：编辑期用 <br> / 换行符表示，文本内容保留换行
  assert.strictEqual(pre.textContent, '第一行\n第二行')
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

console.log(`\n结果：通过 ${passed} 项，失败 ${failed} 项`)
process.exit(failed > 0 ? 1 : 0)
