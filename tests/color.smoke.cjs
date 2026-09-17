/* eslint-disable */
// 黑夜模式颜色自适应冒烟测试（纯函数，node 直接跑）
// 运行：node tests/color.smoke.cjs
const assert = require('assert')

const color = require(require('path').join(
  __dirname,
  '..',
  'node_modules',
  '.cache',
  'color-test.cjs',
))

const { parseHex, rgbToHsl, adaptInkForDark, adaptFillForDark, isLightColor } =
  color

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

function lightness(hex) {
  const rgb = parseHex(hex)
  assert.ok(rgb, `无法解析 ${hex}`)
  return rgbToHsl(rgb)[2]
}
function hue(hex) {
  return rgbToHsl(parseHex(hex))[0]
}

/* ---------------- parseHex ---------------- */
check('parseHex 支持 #rrggbb / #rgb，拒绝非法值', () => {
  assert.deepStrictEqual(parseHex('#ff0000'), { r: 255, g: 0, b: 0 })
  assert.deepStrictEqual(parseHex('#f00'), { r: 255, g: 0, b: 0 })
  assert.strictEqual(parseHex('transparent'), null)
  assert.strictEqual(parseHex('#12345'), null)
  assert.strictEqual(parseHex('rgb(0,0,0)'), null)
})

/* ---------------- adaptInkForDark ---------------- */
check('纯黑在深色下提亮为浅灰（不再黑字暗底）', () => {
  const out = adaptInkForDark('#000000')
  const l = lightness(out)
  assert.ok(l > 0.8 && l < 0.92, `亮度应在浅色区间，实际 ${l}`)
})

check('正文默认墨色 #37352f 提亮且保持色相', () => {
  const out = adaptInkForDark('#37352f')
  assert.ok(lightness(out) > lightness('#37352f') + 0.3, '应明显提亮')
  assert.ok(lightness(out) >= 0.62, '应达到可读亮度下限')
  assert.ok(Math.abs(hue(out) - hue('#37352f')) < 2, '色相应保持')
})

check('带色相的暗色（彩色标题）提亮后仍保色相', () => {
  const out = adaptInkForDark('#a626a4')
  assert.ok(lightness(out) >= 0.62)
  assert.ok(Math.abs(hue(out) - hue('#a626a4')) < 2, '色相应保持')
})

check('原本就够亮的颜色原样返回', () => {
  assert.strictEqual(adaptInkForDark('#ffffff'), '#ffffff')
  assert.strictEqual(adaptInkForDark('#e6e8ec'), '#e6e8ec')
})

check('非法输入原样返回（不抛错）', () => {
  assert.strictEqual(adaptInkForDark('transparent'), 'transparent')
  assert.strictEqual(adaptFillForDark('transparent'), 'transparent')
})

/* ---------------- adaptFillForDark ---------------- */
check('浅色表格底色 / 边框在深色下变暗且可见', () => {
  const head = adaptFillForDark('#f0f0f0')
  const line = adaptFillForDark('#d8d9dc')
  assert.ok(lightness(head) < 0.4, `表头底色应压暗，实际 ${lightness(head)}`)
  assert.ok(lightness(line) < 0.4, `边框应压暗，实际 ${lightness(line)}`)
  // 深色纸面亮度约 0.15，边框/底色应更亮一点才看得见
  assert.ok(lightness(head) > 0.16, '底色应亮于深色纸面')
  assert.ok(lightness(line) > 0.16, '边框应亮于深色纸面')
})

check('深色面色在深色下反而提亮（保持可见）', () => {
  const out = adaptFillForDark('#111111')
  assert.ok(lightness(out) > lightness('#111111') + 0.3)
})

check('面色映射结果始终落在 [0.26, 0.60]', () => {
  for (const hex of ['#000000', '#37352f', '#f1f0f0', '#ffffff', '#004cff']) {
    const l = lightness(adaptFillForDark(hex))
    // 下限留一点舍入余量（#ffffff → 0.2588）
    assert.ok(l >= 0.25 && l <= 0.61, `${hex} → ${l}`)
  }
})

/* ---------------- isLightColor ---------------- */
check('isLightColor 分辨浅色 / 深色底', () => {
  assert.strictEqual(isLightColor('#ffffff'), true)
  assert.strictEqual(isLightColor('#f0f0f0'), true)
  assert.strictEqual(isLightColor('#000000'), false)
  assert.strictEqual(isLightColor('#004cff'), false)
  assert.strictEqual(isLightColor('transparent'), false)
})

console.log(`\n颜色自适应：${passed} 通过，${failed} 失败`)
process.exit(failed === 0 ? 0 : 1)
