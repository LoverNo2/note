// Prettier 容错（“补分号”）的插入位置边界测试（node，纯函数，不加载 Prettier 运行时）
// 运行：node tests/prettier.smoke.cjs
const assert = require('assert')
const path = require('path')

const pf = require(
  path.join(__dirname, '..', 'node_modules', '.cache', 'prettier-test.cjs'),
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

console.log('S. 补分号容错的插入位置')
check('S1 不在标识符中间补分号（super → s;uper 的情形）', () => {
  // 报错列落在 super 的 s|uper 之间时，不能把关键字拆成两条语句
  assert.strictEqual(
    pf.insertSemicolonAt('    super._set_tree(t)', 1, 5),
    '    super._set_tree(t)',
  )
})
check('S2 不在成员访问点（.）之后补分号', () => {
  assert.strictEqual(pf.insertSemicolonAt('    a.b', 1, 6), '    a.b')
})
check('S3 正常行尾补分号', () => {
  assert.strictEqual(pf.insertSemicolonAt('    a = 1', 1, 9), '    a = 1;')
})
check('S4 已有行尾分号不重复插', () => {
  assert.strictEqual(pf.insertSemicolonAt('    a = 1;', 1, 10), '    a = 1;')
})
check('S5 越界行列安全返回', () => {
  assert.strictEqual(pf.insertSemicolonAt('a = 1', 9, 0), 'a = 1')
})

console.log(`\n结果：通过 ${passed} 项，失败 ${failed} 项`)
process.exit(failed > 0 ? 1 : 0)
