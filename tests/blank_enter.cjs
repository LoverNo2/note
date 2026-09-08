const { JSDOM } = require('jsdom')
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' })
global.window = dom.window
global.document = dom.window.document
global.Node = dom.window.Node
global.NodeFilter = dom.window.NodeFilter
const blocks = require('/tmp/blocks.cjs')

function editorWith(html) {
  const el = document.createElement('div')
  el.contentEditable = 'true'
  el.innerHTML = html
  document.body.appendChild(el)
  return el
}
function caretBlockText(el) {
  const b = blocks.resolveBlock(el)
  return b ? JSON.stringify(b.textContent) : '(null)'
}
function dump(el) {
  return Array.from(el.children).map((c) => `<${c.tagName.toLowerCase()}>${(c.textContent || '').replace(/\n/g,'⏎')}`).join(' ')
}
// 让光标在块内文本末尾（无文本则块起点）
function caretAtEndOfFirstTextBlock(el) {
  const block = el.querySelector('p')
  const tn = block.firstChild
  const r = document.createRange()
  if (tn && tn.nodeType === Node.TEXT_NODE) { r.setStart(tn, tn.textContent.length) }
  else { r.selectNodeContents(block); }
  r.collapse(true)
  const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r)
}

const el = editorWith('<p>hello</p>')
caretAtEndOfFirstTextBlock(el)
blocks.handleEnterKey(el) // 1st: 行尾回车 → 行2 空
console.log('回车1 =>', dump(el), '| caret块:', caretBlockText(el))
blocks.handleEnterKey(el) // 2nd: 空行回车 → ?
console.log('回车2 =>', dump(el), '| caret块:', caretBlockText(el))
blocks.handleEnterKey(el) // 3rd
console.log('回车3 =>', dump(el), '| caret块:', caretBlockText(el))
