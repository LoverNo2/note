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

check('表格作为顶层块保留，不被塞进段落', () => {
  const out = html.normalizeHtml(
    '<table><tr><td>甲</td><td>乙</td></tr><tr><td>丙</td><td>丁</td></tr></table><p>后文</p>',
  )
  assert.ok(out.startsWith('<table'), `实际：${out}`)
  assert.ok(!out.includes('<p><table'), '表格不应被包进 <p>')
  assert.ok(out.includes('<td>甲</td>'))
  assert.ok(out.endsWith('<p>后文</p>'))
})

check('单元格内的块级内容压平为 <br> 换行', () => {
  const out = html.normalizeHtml(
    '<table><tr><td><p>第一行</p><p>第二行</p></td><td><div>x</div></td></tr></table>',
  )
  assert.ok(!/<td>\s*<(p|div)/.test(out), `单元格内不应留块级：${out}`)
  assert.ok(out.includes('<br>'), `换行应折成 <br>：${out}`)
  assert.ok(out.includes('第一行'))
  assert.ok(out.includes('第二行'))
})

check('空单元格补一个 <br> 落脚点', () => {
  const out = html.normalizeHtml('<table><tr><td></td><td>有字</td></tr></table>')
  assert.ok(/<td><br><\/td>|<td><br \/>/.test(out.replace(/<br>\s*/g, '<br>')), `实际：${out}`)
})

check('空表与空行被移除', () => {
  assert.strictEqual(html.normalizeHtml('<table><tr></tr></table>'), '')
  const out = html.normalizeHtml(
    '<table><tr><td>甲</td></tr><tr></tr><tr><td>乙</td></tr></table>',
  )
  assert.strictEqual((out.match(/<tr>/g) || []).length, 2, `实际：${out}`)
})

check('表格 normalize 幂等', () => {
  const once = html.normalizeHtml(
    '<table><tr><td><p>甲</p></td><td></td></tr></table><p>尾</p>',
  )
  assert.strictEqual(html.normalizeHtml(once), once)
})

check('textFromHtml 表格按行分列', () => {
  const out = html.textFromHtml('<table><tr><td>甲</td><td>乙</td></tr><tr><td>丙</td><td>丁</td></tr></table>')
  assert.strictEqual(out, '甲\t乙\n丙\t丁')
})

check('单元格对齐可落库且 normalize 幂等', () => {
  const once = html.normalizeHtml(
    '<table><tr><td style="text-align:center">甲</td><td>乙</td></tr></table>',
  )
  assert.ok(/text-align:\s*center/.test(once), `实际：${once}`)
  assert.strictEqual(html.normalizeHtml(once), once)
  // 其它外来样式仍应被清掉
  const cleaned = html.normalizeHtml(
    '<table><tr><td style="text-align:right;color:red">甲</td></tr></table>',
  )
  assert.ok(!/color/.test(cleaned), `外来样式应被清除：${cleaned}`)
})

check('复制粘贴保留单元格对齐', () => {
  const out = html.sanitizeHtml('<table><tr><td style="text-align:right">甲</td></tr></table>')
  assert.ok(/text-align:\s*right/.test(out), `实际：${out}`)
})

console.log(`\n结果：通过 ${passed} 项，失败 ${failed} 项`)
process.exit(failed > 0 ? 1 : 0)
