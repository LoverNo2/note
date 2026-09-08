/* eslint-disable */
// html.ts 工具冒烟测试
// 运行：node tests/html.smoke.cjs
const { JSDOM } = require('jsdom')
const assert = require('assert')

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/',
})
global.window = dom.window
global.document = dom.window.document
global.Node = dom.window.Node
global.NodeFilter = dom.window.NodeFilter
global.DOMParser = dom.window.DOMParser

const html = require(
  process.env.HTML_BUNDLE ||
    require('path').join(__dirname, '..', 'node_modules', '.cache', 'html-test.cjs'),
)

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

check('legacyTextToHtml 空行分段、单换行转 br', () => {
  const out = html.legacyTextToHtml('第一段\n第二行\n\n第三段')
  assert.strictEqual(out, '<p>第一段<br>第二行</p><p>第三段</p>')
})

check('legacyTextToHtml 特殊字符转义', () => {
  const out = html.legacyTextToHtml('a < b & c')
  assert.ok(out.includes('a &lt; b &amp; c'))
})

check('normalizeHtml 顶层裸文本收拢为段落', () => {
  const out = html.normalizeHtml('裸文本')
  assert.strictEqual(out, '<p>裸文本</p>')
})

check('normalizeHtml 顶层 div 转 p', () => {
  const out = html.normalizeHtml('<div>甲</div><p>乙</p>')
  assert.strictEqual(out, '<p>甲</p><p>乙</p>')
})

check('normalizeHtml 空内容返回空串', () => {
  assert.strictEqual(html.normalizeHtml('<p></p>'), '')
})

check('normalizeHtml 保留中间空段落结构', () => {
  const out = html.normalizeHtml('<p>甲</p><p><br></p><p>乙</p>')
  assert.strictEqual(out, '<p>甲</p><p><br></p><p>乙</p>')
})

check('normalizeHtml 幂等', () => {
  const once = html.normalizeHtml('<div>a<br>b</div><h1>x</h1>')
  assert.strictEqual(html.normalizeHtml(once), once)
})

check('textFromHtml 块间换行分隔、忽略行内标签', () => {
  const out = html.textFromHtml('<h1>标题</h1><p>正文<b>加粗</b></p>')
  assert.ok(out.includes('标题'))
  assert.ok(out.includes('正文加粗'))
})

check('looksLikeHtml 判定', () => {
  assert.strictEqual(html.looksLikeHtml('纯文本'), false)
  assert.strictEqual(html.looksLikeHtml('<p>x</p>'), true)
})

console.log(`\n结果：通过 ${passed} 项，失败 ${failed} 项`)
process.exit(failed > 0 ? 1 : 0)
