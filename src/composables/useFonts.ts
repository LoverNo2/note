import { reactive } from 'vue'
import { markSettingsDirty } from './settingsFile'

/**
 * 字体管理：自动扫描 asset/fonts/ 下的字体包，注入 @font-face，
 * 并允许「英文 / 数字」与「中文」分别选择字体（选择会持久化）。
 */

interface FontFaceSource {
  url: string
  weight: number
  italic: boolean
}

/** 一个字体族（对应 asset/fonts 下的一个目录，如 Menlo / PingFangSC） */
export interface FontFamily {
  name: string
  files: FontFaceSource[]
}

export type FontKind = 'latin' | 'cjk'

/* ---------------- 自动识别字体包 ---------------- */

// 相对本文件的路径：src/composables → 项目根 asset/fonts
const FONT_MODULES = import.meta.glob(
  '../../asset/fonts/**/*.{woff2,woff,ttf,otf}',
  { query: '?url', import: 'default', eager: true },
) as Record<string, string>

/** 文件名关键词 → 字重（顺序敏感：先匹配更具体的关键词） */
const WEIGHT_RULES: Array<[RegExp, number]> = [
  [/ultra\s*light/i, 100],
  [/extra\s*light/i, 200],
  [/thin/i, 200],
  [/semi\s*bold|demi\s*bold/i, 600],
  [/extra\s*bold|ultra\s*bold/i, 800],
  [/light/i, 300],
  [/medium/i, 500],
  [/bold/i, 700],
  [/heavy|black/i, 900],
]

function detectWeight(base: string): number {
  for (const [re, weight] of WEIGHT_RULES) {
    if (re.test(base)) return weight
  }
  return 400
}

function formatOf(url: string): string {
  if (/\.woff2(\?|#|$)/i.test(url)) return 'woff2'
  if (/\.woff(\?|#|$)/i.test(url)) return 'woff'
  if (/\.otf(\?|#|$)/i.test(url)) return 'opentype'
  return 'truetype'
}

/** 目录名 → 展示/引用用的字体族名（PingFangSC → PingFang SC） */
function prettyName(dir: string): string {
  return dir.replace(/([a-z])(SC|TC)$/, '$1 $2')
}

/** 扫描结果：asset/fonts 下每个目录视为一个字体族 */
export const fontFamilies: FontFamily[] = (() => {
  const map = new Map<string, FontFamily>()
  for (const [path, url] of Object.entries(FONT_MODULES)) {
    const segments = path.split('/')
    const dir = segments[segments.length - 2] ?? ''
    const file = segments[segments.length - 1] ?? ''
    if (!dir || !file) continue
    const name = prettyName(dir)
    if (!map.has(name)) map.set(name, { name, files: [] })
    const base = file.replace(/\.[a-z0-9]+$/i, '')
    map.get(name)!.files.push({
      url,
      weight: detectWeight(base),
      italic: /italic|oblique/i.test(base),
    })
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name))
})()

/* ---------------- 注入 @font-face ---------------- */

let injected = false

function injectFontFaces(): void {
  if (injected || typeof document === 'undefined') return
  injected = true
  const css = fontFamilies
    .map((family) =>
      family.files
        .map(
          (face) =>
            `@font-face{font-family:'${family.name}';src:url(${face.url}) format('${formatOf(
              face.url,
            )}');font-weight:${face.weight};font-style:${
              face.italic ? 'italic' : 'normal'
            };font-display:swap;}`,
        )
        .join('\n'),
    )
    .join('\n')
  const style = document.createElement('style')
  style.id = 'notebook-font-faces'
  style.textContent = css
  document.head.appendChild(style)
}

/* ---------------- 英文 / 中文 分别选择 ---------------- */

const STORAGE_KEY = 'notebook:fonts:v1'
const DEFAULTS: Record<FontKind, string> = { latin: 'Menlo', cjk: 'PingFang SC' }

function readStored(): Record<FontKind, string> {
  const fallback = { ...DEFAULTS }
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return fallback
    const parsed = JSON.parse(raw) as Partial<Record<FontKind, string>>
    return {
      latin: typeof parsed.latin === 'string' && parsed.latin ? parsed.latin : fallback.latin,
      cjk: typeof parsed.cjk === 'string' && parsed.cjk ? parsed.cjk : fallback.cjk,
    }
  } catch {
    return fallback
  }
}

const selected = reactive<Record<FontKind, string>>(readStored())

function applyFontVars(): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  root.style.setProperty('--font-latin', `'${selected.latin}'`)
  root.style.setProperty('--font-cjk', `'${selected.cjk}'`)
}

function persist(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...selected }))
    markSettingsDirty() // 同步到项目文件
  } catch {
    /* 忽略写入失败 */
  }
}

/** 选择字体：latin = 英文/数字，cjk = 中文 */
function setFont(kind: FontKind, name: string): void {
  if (!name || selected[kind] === name) return
  selected[kind] = name
  applyFontVars()
  persist()
  // 主动预加载，避免切换后短暂回退系统字体
  void document.fonts?.load(`16px '${name}'`).catch(() => undefined)
}

/** 启动时调用：注入 @font-face 并应用已保存的选择 */
function initFonts(): void {
  injectFontFaces()
  applyFontVars()
}

export function useFonts() {
  return {
    families: fontFamilies,
    selected,
    setFont,
    initFonts,
    defaults: DEFAULTS,
  }
}
