import { computed, reactive, watch } from 'vue'

/**
 * 正文与标题（paragraph / h1 / h2 / h3）的可视化样式配置。
 *
 * - 全局生效：所有笔记共用一套，存 localStorage；
 * - 每种块可调：字号 / 字重 / 行高 / 颜色 / 斜体 / 下划线 / 删除线 /
 *   字间距 / 对齐 / 首行缩进 / 段间距；
 * - 通过 CSS 变量输出，.note-content 里的 p / h1 / h2 / h3 实时读取。
 */

export type TextBlockKey = 'paragraph' | 'h1' | 'h2' | 'h3'

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
}

export const TEXT_BLOCK_LABELS: Record<TextBlockKey, string> = {
  paragraph: '正文',
  h1: '标题 1',
  h2: '标题 2',
  h3: '标题 3',
}

/** 与 style.css 中的 var(--x-*, fallback) 保持一致 */
export const TEXT_STYLE_DEFAULTS: Record<TextBlockKey, TextBlockStyle> = {
  paragraph: {
    fontSize: 16, fontWeight: 400, lineHeight: 1.8, color: '#37352f',
    italic: false, underline: false, strike: false,
    letterSpacing: 0.005, align: 'left', textIndent: 0, marginBottom: 6,
  },
  h1: {
    fontSize: 26, fontWeight: 700, lineHeight: 1.4, color: '#37352f',
    italic: false, underline: false, strike: false,
    letterSpacing: -0.012, align: 'left', textIndent: 0, marginBottom: 0,
  },
  h2: {
    fontSize: 22, fontWeight: 650, lineHeight: 1.4, color: '#37352f',
    italic: false, underline: false, strike: false,
    letterSpacing: -0.012, align: 'left', textIndent: 0, marginBottom: 0,
  },
  h3: {
    fontSize: 19, fontWeight: 620, lineHeight: 1.4, color: '#37352f',
    italic: false, underline: false, strike: false,
    letterSpacing: -0.012, align: 'left', textIndent: 0, marginBottom: 0,
  },
}

const STORAGE_KEY = 'notebook:textStyles:v1'

/** 变量名后缀：paragraph → p，其余同 kind */
const VAR_SUFFIX: Record<TextBlockKey, string> = {
  paragraph: 'p',
  h1: 'h1',
  h2: 'h2',
  h3: 'h3',
}

const ALIGNS: TextAlign[] = ['left', 'center', 'right', 'justify']

function cloneDefaults(): Record<TextBlockKey, TextBlockStyle> {
  return {
    paragraph: { ...TEXT_STYLE_DEFAULTS.paragraph },
    h1: { ...TEXT_STYLE_DEFAULTS.h1 },
    h2: { ...TEXT_STYLE_DEFAULTS.h2 },
    h3: { ...TEXT_STYLE_DEFAULTS.h3 },
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
    if (!raw) return base
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
      b.textIndent = num(s.textIndent, 0, 3.5, b.textIndent)
      b.marginBottom = Math.round(num(s.marginBottom, 0, 48, b.marginBottom))
    }
  } catch {
    /* 读取失败用默认 */
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
  }
}
