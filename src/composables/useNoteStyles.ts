import { computed, reactive, ref, watch } from 'vue'

/**
 * 正文与标题（paragraph / h1 / h2 / h3）的可视化样式配置。
 *
 * - 全局生效：所有笔记共用一套，存 localStorage；
 * - 每种块可调：字号 / 字重 / 行高 / 颜色 / 斜体 / 下划线 / 删除线 /
 *   底色 / 字间距 / 对齐 / 首行缩进 / 段间距 / 英文间距；
 * - 另有代码块外观预设（经典 / 内凹 / 强调条 / 深色终端 / 细线稿）；
 * - 通过 CSS 变量输出，.note-content 里的 p / h1 / h2 / h3 实时读取。
 */

export type TextBlockKey =
  | 'paragraph'
  | 'h1'
  | 'h2'
  | 'h3'
  | 'h4'
  | 'h5'

export type TextAlign = 'left' | 'center' | 'right' | 'justify'

export interface TextBlockStyle {
  /** 字号 px */
  fontSize: number
  /** 字重 100-900 */
  fontWeight: number
  /** 行高倍数 */
  lineHeight: number
  /** 文字颜色（hex） */
  color: string
  /** 底色（hex；'transparent' 为兼容旧数据的无底色写法） */
  bg: string
  /** 底色不透明度 0~1（默认 0，即 rgba(255,255,255,0) 全透明） */
  bgAlpha: number
  /** 整块斜体 */
  italic: boolean
  /** 整块下划线 */
  underline: boolean
  /** 整块删除线 */
  strike: boolean
  /** 字间距 em */
  letterSpacing: number
  /** 对齐方式 */
  align: TextAlign
  /** 首行缩进 em */
  textIndent: number
  /** 段间距 px（段落之间的空隙） */
  marginBottom: number
  /** 英文间距 px：英文单词与相邻非拉丁字符（中文/标点）之间的空隙 */
  enGap: number
}

export const TEXT_BLOCK_LABELS: Record<TextBlockKey, string> = {
  paragraph: '正文',
  h1: '标题 1',
  h2: '标题 2',
  h3: '标题 3',
  h4: '标题 4',
  h5: '标题 5',
}

/** 与 style.css 中的 var(--x-*, fallback) 保持一致 */
export const TEXT_STYLE_DEFAULTS: Record<TextBlockKey, TextBlockStyle> = {
  paragraph: {
    fontSize: 16, fontWeight: 400, lineHeight: 1.8, color: '#37352f',
    bg: '#ffffff',
    bgAlpha: 0,
    italic: false, underline: false, strike: false,
    letterSpacing: 0.005, align: 'left', textIndent: 0, marginBottom: 0,
    enGap: 0,
  },
  h1: {
    fontSize: 26, fontWeight: 700, lineHeight: 1.4, color: '#37352f',
    bg: '#ffffff',
    bgAlpha: 0,
    italic: false, underline: false, strike: false,
    letterSpacing: -0.012, align: 'left', textIndent: 0, marginBottom: 10,
    enGap: 0,
  },
  h2: {
    fontSize: 22, fontWeight: 650, lineHeight: 1.4, color: '#37352f',
    bg: '#ffffff',
    bgAlpha: 0,
    italic: false, underline: false, strike: false,
    letterSpacing: -0.012, align: 'left', textIndent: 0, marginBottom: 8,
    enGap: 0,
  },
  h3: {
    fontSize: 19, fontWeight: 620, lineHeight: 1.4, color: '#37352f',
    bg: '#ffffff',
    bgAlpha: 0,
    italic: false, underline: false, strike: false,
    letterSpacing: -0.012, align: 'left', textIndent: 0, marginBottom: 6,
    enGap: 0,
  },
  h4: {
    fontSize: 17, fontWeight: 600, lineHeight: 1.45, color: '#37352f',
    bg: '#ffffff',
    bgAlpha: 0,
    italic: false, underline: false, strike: false,
    letterSpacing: -0.008, align: 'left', textIndent: 0, marginBottom: 5,
    enGap: 0,
  },
  h5: {
    fontSize: 15.5, fontWeight: 560, lineHeight: 1.5, color: '#37352f',
    bg: '#ffffff',
    bgAlpha: 0,
    italic: false, underline: false, strike: false,
    letterSpacing: -0.005, align: 'left', textIndent: 0, marginBottom: 4,
    enGap: 0,
  },
}

/* ---------------- 代码块外观（预设方案） ---------------- */

export type CodeBlockStyleKey = 'now' | 'a' | 'b' | 'c' | 'd'

export interface CodeBlockStyleOption {
  key: CodeBlockStyleKey
  name: string
  desc: string
}

/** 代码块外观预设：与 style.css 里的 .code-* 类一一对应 */
export const CODE_BLOCK_STYLES: readonly CodeBlockStyleOption[] = [
  { key: 'now', name: '经典', desc: '浅灰底 + 1px 细边框（原始样式）' },
  { key: 'a', name: '内凹', desc: '无边框，内侧阴影压入纸面（与整体新拟态一致）' },
  { key: 'b', name: '强调条', desc: '极浅底 + 左侧 3px 竖条，右侧大圆角' },
  { key: 'c', name: '深色终端', desc: '深色底 + 浅色等宽字（打印时自动转浅色）' },
  { key: 'd', name: '细线稿', desc: '透明底 + 1px 细边框，最克制、最省墨' },
]

const CODE_BLOCK_STORAGE_KEY = 'notebook:codeBlockStyle:v1'

function loadCodeStyle(): CodeBlockStyleKey {
  try {
    const raw = localStorage.getItem(CODE_BLOCK_STORAGE_KEY)
    return CODE_BLOCK_STYLES.some((o) => o.key === raw)
      ? (raw as CodeBlockStyleKey)
      : 'now'
  } catch {
    return 'now'
  }
}

/** 当前代码块外观（全局共用，与正文样式配置一起持久化） */
const codeStyle = ref<CodeBlockStyleKey>(loadCodeStyle())

watch(codeStyle, (v) => {
  try {
    localStorage.setItem(CODE_BLOCK_STORAGE_KEY, v)
  } catch {
    /* 存储不可用时忽略 */
  }
})

/** 挂到 .note-content 上的外观类名（style.css 据此切换代码块样式） */
const codeStyleClass = computed(() => `code-${codeStyle.value}`)

/** 底色 hex + 不透明度 → CSS 颜色（alpha = 1 时输出 hex，否则输出 rgba） */
export function bgToCss(hex: string, alpha: number): string {
  const m = /^#([0-9a-fA-F]{6})$/.exec(hex || '')
  if (!m) return 'transparent'
  const a = Math.min(1, Math.max(0, alpha))
  if (a <= 0) return 'transparent'
  if (a >= 1) return hex
  const n = parseInt(m[1], 16)
  const r = (n >> 16) & 255
  const g = (n >> 8) & 255
  const b = n & 255
  return `rgba(${r}, ${g}, ${b}, ${a})`
}

const STORAGE_KEY = 'notebook:textStyles:v1'
/** 正文段间距默认值迁移标记（6 → 0） */
export const SEG_GAP_MIGRATED_KEY = 'notebook:textStyles:segGapMigrated'

/** 变量名后缀：paragraph → p，其余同 kind */
const VAR_SUFFIX: Record<TextBlockKey, string> = {
  paragraph: 'p',
  h1: 'h1',
  h2: 'h2',
  h3: 'h3',
  h4: 'h4',
  h5: 'h5',
}

const ALIGNS: TextAlign[] = ['left', 'center', 'right', 'justify']

function cloneDefaults(): Record<TextBlockKey, TextBlockStyle> {
  return {
    paragraph: { ...TEXT_STYLE_DEFAULTS.paragraph },
    h1: { ...TEXT_STYLE_DEFAULTS.h1 },
    h2: { ...TEXT_STYLE_DEFAULTS.h2 },
    h3: { ...TEXT_STYLE_DEFAULTS.h3 },
    h4: { ...TEXT_STYLE_DEFAULTS.h4 },
    h5: { ...TEXT_STYLE_DEFAULTS.h5 },
  }
}

/** 旧数据兼容：只校验「核心四字段」，缺失/非法的新字段回退默认 */
function isBlockStyle(v: unknown): v is TextBlockStyle {
  if (typeof v !== 'object' || v === null) return false
  const s = v as Record<string, unknown>
  return (
    typeof s.fontSize === 'number' &&
    typeof s.fontWeight === 'number' &&
    typeof s.lineHeight === 'number' &&
    typeof s.color === 'string'
  )
}

function num(v: unknown, min: number, max: number, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v)
    ? Math.min(max, Math.max(min, v))
    : fallback
}

function load(): Record<TextBlockKey, TextBlockStyle> {
  const base = cloneDefaults()
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      // 没有旧数据：无需迁移，直接打标记，避免以后误改用户新设的值
      localStorage.setItem(SEG_GAP_MIGRATED_KEY, '1')
      return base
    }
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return base
    const obj = parsed as Record<string, unknown>
    for (const key of Object.keys(base) as TextBlockKey[]) {
      const s = obj[key] as Record<string, unknown> | undefined
      if (!isBlockStyle(s)) continue
      const b = base[key]
      b.fontSize = Math.round(num(s.fontSize, 10, 60, b.fontSize))
      b.fontWeight = Math.round(num(s.fontWeight, 100, 900, b.fontWeight))
      b.lineHeight = num(s.lineHeight, 1, 3, b.lineHeight)
      b.color = /^#[0-9a-fA-F]{6}$/.test(s.color as string)
        ? (s.color as string)
        : b.color
      // —— 以下为新增字段，逐个读取（旧数据缺失时保留默认）——
      b.italic = typeof s.italic === 'boolean' ? s.italic : b.italic
      b.underline = typeof s.underline === 'boolean' ? s.underline : b.underline
      b.strike = typeof s.strike === 'boolean' ? s.strike : b.strike
      b.letterSpacing = num(s.letterSpacing, -0.1, 0.5, b.letterSpacing)
      b.align = ALIGNS.includes(s.align as TextAlign)
        ? (s.align as TextAlign)
        : b.align
      b.bg =
        s.bg === 'transparent' || /^#[0-9a-fA-F]{6}$/.test(s.bg as string)
          ? (s.bg as string)
          : b.bg
      b.bgAlpha = num(s.bgAlpha, 0, 1, b.bgAlpha)
      b.textIndent = num(s.textIndent, 0, 3.5, b.textIndent)
      b.enGap = num(s.enGap, 0, 16, b.enGap)
      if (key === 'paragraph') {
        // 正文段间距：旧默认值是 6px，会让「回车分段」比「自动换行」多出空隙；
        // 现在统一为 0（两种换行的行距都等于行高），旧数据一次性迁移
        const migrated = localStorage.getItem(SEG_GAP_MIGRATED_KEY) === '1'
        const stored = Math.round(num(s.marginBottom, 0, 48, b.marginBottom))
        b.marginBottom = !migrated && stored === 6 ? 0 : stored
      }
      // 标题：旧版本 marginBottom 字段未接入 CSS（一直不生效），
      // 由新版视觉默认接管，避免旧存的 0 压扁标题与正文的间距
    }
  } catch {
    /* 读取失败用默认 */
  }
  try {
    localStorage.setItem(SEG_GAP_MIGRATED_KEY, '1')
  } catch {
    /* 忽略 */
  }
  return base
}

/* ---------------- 单例状态 ---------------- */

const state = reactive<Record<TextBlockKey, TextBlockStyle>>(load())

watch(
  state,
  (val) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(val))
    } catch {
      /* 存储不可用时忽略 */
    }
  },
  { deep: true },
)

/** 渲染给 .note-content 的 CSS 变量对象 */
const cssVars = computed<Record<string, string | number>>(() => {
  const vars: Record<string, string | number> = {}
  for (const key of Object.keys(state) as TextBlockKey[]) {
    const s = state[key]
    const suf = VAR_SUFFIX[key]
    const decorations: string[] = []
    if (s.underline) decorations.push('underline')
    if (s.strike) decorations.push('line-through')
    vars[`--${suf}-fs`] = `${s.fontSize}px`
    vars[`--${suf}-bg`] = bgToCss(s.bg, s.bgAlpha)
    vars[`--${suf}-en-gap`] = `${s.enGap}px`
    vars[`--${suf}-fw`] = s.fontWeight
    vars[`--${suf}-lh`] = s.lineHeight
    vars[`--${suf}-color`] = s.color
    vars[`--${suf}-italic`] = s.italic ? 'italic' : 'normal'
    vars[`--${suf}-dec`] = decorations.length > 0 ? decorations.join(' ') : 'none'
    vars[`--${suf}-ls`] = `${s.letterSpacing}em`
    vars[`--${suf}-align`] = s.align
    vars[`--${suf}-indent`] = `${s.textIndent}em`
    vars[`--${suf}-mb`] = `${s.marginBottom}px`
  }
  return vars
})

/** 局部更新某个块的样式 */
function update(key: TextBlockKey, patch: Partial<TextBlockStyle>): void {
  const block = state[key]
  if (!block) return
  Object.assign(block, patch)
}

function resetBlock(key: TextBlockKey): void {
  state[key] = { ...TEXT_STYLE_DEFAULTS[key] }
}

export function useNoteStyles() {
  return {
    state,
    cssVars,
    update,
    resetBlock,
    labels: TEXT_BLOCK_LABELS,
    defaults: TEXT_STYLE_DEFAULTS,
    codeStyle,
    codeStyleClass,
    codeStyles: CODE_BLOCK_STYLES,
  }
}
