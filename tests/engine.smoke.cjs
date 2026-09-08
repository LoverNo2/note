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
console.log('B. 引用包裹与展开')
{
  const el = editorWith('<p>引用文字</p>')
  blocks.placeCaretAtEndOf(el.querySelector('p'))
  blocks.setBlockType(el, 'blockquote')
  assert.strictEqual(el.firstElementChild.tagName, 'BLOCKQUOTE')
  blocks.placeCaretAtEndOf(el.querySelector('blockquote'))
  blocks.setBlockType(el, 'paragraph')
  assert.strictEqual(el.firstElementChild.tagName, 'P')
  check('B1 段落→引用→正文', () => {})
}

reset()
console.log('C. 代码块往返')
{
  const el = editorWith('<p>第一行<br>第二行</p>')
  blocks.placeCaretAtEndOf(el.querySelector('p'))
  blocks.setBlockType(el, 'codeblock')
  const pre = el.firstElementChild
  assert.strictEqual(pre.tagName, 'PRE')
  assert.strictEqual(pre.textContent, '第一行第二行')
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
console.log('G. 分割线插入')
{
  const el = editorWith('<p>前文</p><p>后文</p>')
  const p0 = el.querySelector('p')
  blocks.placeCaretAtEndOf(p0)
  blocks.insertDivider(el)
  assert.ok(Array.from(el.children).some((c) => c.tagName === 'HR'))
  check('G1 段后插入分割线', () => {})
}

console.log(`\n结果：通过 ${passed} 项，失败 ${failed} 项`)
process.exit(failed > 0 ? 1 : 0)
