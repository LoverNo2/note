/**
 * 颜色工具：为「黑夜模式」做墨色 / 面色自适应。
 *
 * 背景：正文、标题的颜色来自用户样式里的绝对 hex（默认近黑），表格底色 / 边框
 * 同样是绝对 hex（默认浅灰）。只把界面变暗的话，深色纸面上会出现「黑字黑底」
 * 和「浅灰线浅灰底」这类不可读的组合。这里提供两个纯函数，在深色主题下把用户
 * 颜色映射成深色下可读的近似色：只调亮度（HSL 的 L），色相不变。
 *
 *  - adaptInkForDark：墨色（正文 / 标题文字）——深色下把暗色提亮到 L∈[0.62, 0.86]，
 *    本来就已经够亮的颜色原样返回；
 *  - adaptFillForDark：面色（表格底色 / 边框线）——统一压到 L∈[0.26, 0.60]，
 *    浅色变暗、深色变亮，保证在深色纸面上看得见。
 *
 * 只在深色主题下使用；浅色主题与打印（导出 PDF）始终用原色，所以这两支函数
 * 的输出只走 CSS 变量的「深色版」，不影响用户保存的样式配置。
 */

export interface Rgb {
  r: number
  g: number
  b: number
}

/** 墨色下限亮度：亮于此值的颜色视为「已经是浅色」，深色下保持原样 */
const INK_MIN_L = 0.62
/** 纯黑在深色下的目标亮度 */
const INK_CEIL_L = 0.86
/** 面色（底 / 线）在深色下的亮度区间 */
const FILL_MIN_L = 0.26
const FILL_MAX_L = 0.6

/** 解析 #rgb / #rrggbb；非法输入返回 null */
export function parseHex(hex: string): Rgb | null {
  if (typeof hex !== 'string') return null
  const m = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(hex.trim())
  if (!m) return null
  let h = m[1]
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2]
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  }
}

export function toHex({ r, g, b }: Rgb): string {
  const part = (n: number): string =>
    Math.round(Math.min(255, Math.max(0, n)))
      .toString(16)
      .padStart(2, '0')
  return `#${part(r)}${part(g)}${part(b)}`
}

/** RGB → HSL：h∈[0,360)，s / l∈[0,1] */
export function rgbToHsl({ r, g, b }: Rgb): [number, number, number] {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const l = (max + min) / 2
  const d = max - min
  if (d === 0) return [0, 0, l]
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h: number
  if (max === rn) h = ((gn - bn) / d) % 6
  else if (max === gn) h = (bn - rn) / d + 2
  else h = (rn - gn) / d + 4
  h *= 60
  if (h < 0) h += 360
  return [h, s, l]
}

/** HSL → RGB */
export function hslToRgb(h: number, s: number, l: number): Rgb {
  const c = (1 - Math.abs(2 * l - 1)) * s
  const hp = (((h % 360) + 360) % 360) / 60
  const x = c * (1 - Math.abs((hp % 2) - 1))
  let rgb: [number, number, number]
  if (hp < 1) rgb = [c, x, 0]
  else if (hp < 2) rgb = [x, c, 0]
  else if (hp < 3) rgb = [0, c, x]
  else if (hp < 4) rgb = [0, x, c]
  else if (hp < 5) rgb = [x, 0, c]
  else rgb = [c, 0, x]
  const m = l - c / 2
  return {
    r: (rgb[0] + m) * 255,
    g: (rgb[1] + m) * 255,
    b: (rgb[2] + m) * 255,
  }
}

/** 只改亮度、保留色相与饱和度；非法颜色原样返回 */
function withLightness(hex: string, lightness: number): string {
  const rgb = parseHex(hex)
  if (!rgb) return hex
  const [h, s] = rgbToHsl(rgb)
  return toHex(hslToRgb(h, s, lightness))
}

/**
 * 墨色（正文 / 标题文字）的深色适配。
 * 亮度 L ≥ 0.62 原样返回；更暗的颜色线性提亮到 [0.62, 0.86]（越暗提得越亮）。
 */
export function adaptInkForDark(hex: string): string {
  const rgb = parseHex(hex)
  if (!rgb) return hex
  const [, , l] = rgbToHsl(rgb)
  if (l >= INK_MIN_L) return hex
  const ratio = (INK_CEIL_L - INK_MIN_L) / (0 - INK_MIN_L)
  return withLightness(hex, INK_MIN_L + (l - INK_MIN_L) * ratio)
}

/**
 * 面色（表格底色 / 边框线）的深色适配：统一压进 [0.26, 0.60]，
 * 浅色变暗、深色变亮，保证在深色纸面上可见。
 */
export function adaptFillForDark(hex: string): string {
  const rgb = parseHex(hex)
  if (!rgb) return hex
  const [, , l] = rgbToHsl(rgb)
  return withLightness(hex, FILL_MIN_L + (1 - l) * (FILL_MAX_L - FILL_MIN_L))
}

/** 是否属于浅色（用于判断「块自带浅色底」时，文字不该再提亮） */
export function isLightColor(hex: string): boolean {
  const rgb = parseHex(hex)
  if (!rgb) return false
  // 严格大于 0.5：中亮度（如饱和蓝 #004cff）不算浅底
  return rgbToHsl(rgb)[2] > 0.5
}
